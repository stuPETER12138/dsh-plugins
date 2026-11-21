/**
 * CPU and memory figures for the Host process and the machine it runs on.
 *
 * Two numbers are worth distinguishing and this module keeps both:
 *
 *  - the Host process itself (`process.cpuUsage` deltas, `process.memoryUsage`),
 *    which every plugin shares and which is cheap and exact;
 *  - the whole Desktop application, whose renderer, GPU and utility processes
 *    are separate processes. Electron gives no plugin-facing API for that tree,
 *    so on Windows the sampler sums the working set of every process running the
 *    same executable through `tasklist`, at most once per half minute.
 *
 * Every call is fail-soft: a missing `tasklist`, a restricted platform or an
 * unreadable counter leaves the field `null` rather than breaking the panel.
 *
 * @module @local/dsh-usage-stats/resources
 */

import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

/** How often the whole-application figure is refreshed. */
const APP_REFRESH_MS = 30_000
/** `tasklist` may not stall the Host. */
const APP_TIMEOUT_MS = 8_000
/** One CPU interval must be long enough to mean something. */
const MIN_SAMPLE_MS = 1_000

/**
 * Sum the working set of every process named `exeName`.
 *
 * `tasklist /FO CSV /NH` prints one line per process:
 * `"DeepSeek Harness.exe","1234","Console","1","345,678 K"`.
 *
 * @param {string} exeName - executable basename, spaces allowed.
 * @returns {Promise<{processes: number, bytes: number}|{error: string}>}
 */
function runTasklist(exeName) {
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq ' + exeName, '/FO', 'CSV', '/NH'],
      { timeout: APP_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout) => {
        if (error !== null) {
          resolve({ error: String(error.message) })
          return
        }
        let processes = 0
        let bytes = 0
        for (const line of String(stdout).split(/\r?\n/)) {
          const match = /^\s*"([^"]*)","(\d+)","[^"]*","[^"]*","([^"]*)"/.exec(line)
          if (match === null) continue
          const kib = Number.parseInt(match[3].replace(/[^\d]/g, ''), 10)
          processes += 1
          bytes += (Number.isFinite(kib) ? kib : 0) * 1024
        }
        resolve({ processes, bytes })
      },
    )
  })
}

/**
 * Build the sampler the Host half keeps for its lifetime.
 *
 * @param {object} [options]
 * @param {boolean} [options.appProcesses] - sum the whole application; default true.
 * @returns {{sample: () => object, refresh: () => Promise<void>, trackApp: boolean}}
 */
export function createResourceSampler(options = {}) {
  const cores = Math.max(1, os.cpus()?.length ?? 1)
  const exeName = path.basename(process.execPath)
  // A dev launch under plain node would match every node process on the
  // machine, so the tree figure is only taken when the executable is the app's.
  const trackApp =
    options.appProcesses !== false &&
    process.platform === 'win32' &&
    process.versions?.electron !== undefined &&
    /\.exe$/i.test(exeName) &&
    !/^node(\.exe)?$/i.test(exeName)

  let lastCpu = process.cpuUsage()
  let lastAt = Date.now()
  let intervalPercent = null
  let app = null
  let appAt = 0
  let appError = null
  let appPending = false

  /** Read the counters now; the returned object is plain JSON. */
  function sample() {
    const at = Date.now()
    const cpu = process.cpuUsage()
    const elapsed = at - lastAt
    if (elapsed >= MIN_SAMPLE_MS) {
      const micros = cpu.user - lastCpu.user + (cpu.system - lastCpu.system)
      intervalPercent = Math.max(0, (micros / 1000 / elapsed) * 100)
      lastCpu = cpu
      lastAt = at
    }
    const uptime = process.uptime()
    const total = (cpu.user + cpu.system) / 1000
    const memory = process.memoryUsage()
    return {
      at,
      process: {
        pid: process.pid,
        uptimeSec: Math.round(uptime),
        cpu: {
          // Percent of one core: the sum of every thread, so it can pass 100.
          intervalPercent,
          sinceStartPercent: uptime > 0 ? (total / (uptime * 1000)) * 100 : 0,
          // Percent of the whole machine, which is what a task manager shows.
          machinePercent: intervalPercent === null ? null : intervalPercent / cores,
          cores,
        },
        memory: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers,
        },
      },
      app: trackApp ? app : null,
      appError: trackApp ? appError : null,
      system: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
        usedBytes: os.totalmem() - os.freemem(),
        cores,
        uptimeSec: Math.round(os.uptime()),
        platform: process.platform,
        arch: process.arch,
      },
    }
  }

  /** Refresh the whole-application figure at most once per interval. */
  async function refresh() {
    if (!trackApp || appPending) return
    if (Date.now() - appAt < APP_REFRESH_MS) return
    appPending = true
    try {
      const result = await runTasklist(exeName)
      if (result.error !== undefined) {
        appError = result.error
      } else {
        app = { processes: result.processes, memoryBytes: result.bytes, at: Date.now() }
        appError = null
      }
    } catch (error) {
      appError = String(error?.message ?? error)
    } finally {
      // Failures cool down as well: a broken tasklist must not be spawned on
      // every poll.
      appAt = Date.now()
      appPending = false
    }
  }

  return { sample, refresh, trackApp }
}
