/**
 * Disk footprint of this machine's DSH data, and the cleanup plan for archived
 * session logs.
 *
 * The panel shows two different questions from one scan:
 *
 *  - how much space DSH keeps on this machine (`treeSize` over the session root,
 *    the attachment store, the domain storage and the cache);
 *  - which archived sessions are old enough to remove (`selectCleanup`), and
 *    how many bytes that would give back.
 *
 * Nothing here deletes anything implicitly: `deleteSessionDirs` takes the
 * explicit id list a caller already validated against a fresh plan, re-checks
 * every directory against the scanned root, and removes only session-owned
 * directories whose basename is exactly the requested id.
 *
 * @module @local/dsh-usage-stats/storage
 */

import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/** One local day. */
export const DAY_MS = 86_400_000

/** Directory levels a DSH data tree can nest; deeper entries are ignored. */
const MAX_DEPTH = 3

/** Hard cap on one delete request, so one call cannot walk a whole home. */
export const MAX_DELETE_BATCH = 500

/** `readdir` that answers `null` instead of throwing: an unreadable subtree is not a crash. */
async function readDirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (_error) {
    return null
  }
}

/**
 * Sum every regular file below `dir`.
 *
 * @param {string} dir - absolute directory to measure.
 * @param {number} [depth] - current nesting level (internal).
 * @returns {Promise<{bytes: number, files: number, lastWrite: number|null}|null>}
 *   `null` when the directory cannot be read at all.
 */
export async function treeSize(dir, depth = 0) {
  const entries = await readDirSafe(dir)
  if (entries === null) return null
  let bytes = 0
  let files = 0
  let lastWrite = null
  for (const entry of entries) {
    const child = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth >= MAX_DEPTH) continue
      const nested = await treeSize(child, depth + 1)
      if (nested === null) continue
      bytes += nested.bytes
      files += nested.files
      if (nested.lastWrite !== null && (lastWrite === null || nested.lastWrite > lastWrite)) lastWrite = nested.lastWrite
      continue
    }
    let info
    try {
      info = await stat(child)
    } catch (_error) {
      continue
    }
    if (!info.isFile()) continue
    bytes += info.size
    files += 1
    if (lastWrite === null || info.mtimeMs > lastWrite) lastWrite = info.mtimeMs
  }
  return { bytes, files, lastWrite }
}

/**
 * Measure one session root: `<root>/<project group>/<session id>/<log>`.
 *
 * The directory basename is the session id, which is what the archive set and
 * the Session list both name; a group directory without session directories
 * contributes nothing. Sizes include every retained format generation and the
 * writer lock, so the figure is what the directory really occupies.
 *
 * @param {string} root - the persistence root (`<home>/sessions` by default).
 * @returns {Promise<{root: string, at: number, sessions: Array<object>}>}
 * @throws when the root itself cannot be read.
 */
export async function scanSessions(root) {
  const groups = await readDirSafe(root)
  if (groups === null) throw new Error('cannot read the sessions directory: ' + root)

  const sessions = []
  for (const group of groups) {
    if (!group.isDirectory()) continue
    const groupDir = path.join(root, group.name)
    const entries = await readDirSafe(groupDir)
    if (entries === null) continue
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(groupDir, entry.name)
      const size = await treeSize(dir)
      if (size === null) continue
      sessions.push({
        id: entry.name,
        group: group.name,
        dir,
        bytes: size.bytes,
        files: size.files,
        lastWrite: size.lastWrite,
      })
    }
  }
  return { root, at: Date.now(), sessions }
}

/** Data trees beside the session root that also belong to DSH. */
const EXTRA_DIRECTORIES = [
  ['attachments', 'attachments'],
  ['storage', 'storages'],
  ['cache', 'cache'],
]

/**
 * Measure the non-session data trees under the Harness home.
 *
 * @param {string|null} home - absolute Harness home, or `null` when unknown.
 * @returns {Promise<Array<{key: string, bytes: number, files: number}>>}
 *   one row per tree that exists; missing trees are omitted.
 */
export async function scanExtras(home) {
  if (home === null) return []
  const rows = []
  for (const [key, name] of EXTRA_DIRECTORIES) {
    const size = await treeSize(path.join(home, name))
    if (size === null) continue
    rows.push({ key, bytes: size.bytes, files: size.files })
  }
  return rows
}

/**
 * Pick the sessions that are archived, not running, and untouched for `days`.
 *
 * "Last write" is the newest file mtime in the session directory, not the last
 * event timestamp: it answers "when did DSH last write this log", so resuming a
 * session moves it out of the candidate set even when its events are older.
 *
 * @param {object} options
 * @param {Array<object>} options.sessions - rows from {@link scanSessions}.
 * @param {Iterable<string>} options.archivedIds - the registry's archive set.
 * @param {Iterable<string>} options.liveIds - sessions running in this process.
 * @param {number} options.days - minimum age in days.
 * @param {number} options.now - epoch milliseconds used as "today".
 * @returns {object} candidates (largest first) plus the totals the panel shows.
 */
export function selectCleanup(options) {
  const { sessions, archivedIds, liveIds, days, now } = options
  const span = Math.max(1, Math.trunc(days))
  const cutoff = now - span * DAY_MS
  const archived = new Set(archivedIds ?? [])
  const live = new Set(liveIds ?? [])

  const candidates = []
  const skipped = { recent: 0, recentBytes: 0, live: 0, liveBytes: 0 }
  let archivedSessions = 0
  let archivedBytes = 0

  for (const session of sessions) {
    if (!archived.has(session.id)) continue
    archivedSessions += 1
    archivedBytes += session.bytes
    if (live.has(session.id)) {
      skipped.live += 1
      skipped.liveBytes += session.bytes
      continue
    }
    if (session.bytes <= 0) continue
    if (session.lastWrite === null || session.lastWrite > cutoff) {
      skipped.recent += 1
      skipped.recentBytes += session.bytes
      continue
    }
    candidates.push({
      id: session.id,
      group: session.group,
      bytes: session.bytes,
      files: session.files,
      lastWrite: session.lastWrite,
      ageDays: Math.floor((now - session.lastWrite) / DAY_MS),
    })
  }

  candidates.sort((left, right) => right.bytes - left.bytes)
  const bytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0)
  return {
    days: span,
    cutoff,
    candidates,
    total: { count: candidates.length, bytes },
    archived: { sessions: archivedSessions, bytes: archivedBytes },
    skipped,
  }
}

/**
 * Remove the session directories of `ids`.
 *
 * The scanned rows are the only source of paths, so a caller cannot aim this at
 * an arbitrary directory: every target must be a known session row, sit exactly
 * two levels below the scanned root, and be named after the id it was found
 * under. Anything else is reported as a failure instead of being touched.
 *
 * @param {object} options
 * @param {string} options.root - the scanned session root.
 * @param {Array<object>} options.sessions - rows from {@link scanSessions}.
 * @param {string[]} options.ids - session ids to remove.
 * @returns {Promise<{deleted: Array<{id: string, bytes: number}>, failed: Array<{id: string, error: string}>, freedBytes: number}>}
 */
export async function deleteSessionDirs(options) {
  const { root, sessions, ids } = options
  const resolvedRoot = path.resolve(root)
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const deleted = []
  const failed = []
  const seen = new Set()
  let freedBytes = 0

  for (const raw of ids) {
    if (typeof raw !== 'string' || raw === '' || seen.has(raw)) continue
    seen.add(raw)
    if (seen.size > MAX_DELETE_BATCH) {
      failed.push({ id: raw, error: 'batch-too-large' })
      continue
    }
    const session = byId.get(raw)
    if (session === undefined) {
      failed.push({ id: raw, error: 'unknown-session' })
      continue
    }
    const dir = path.resolve(session.dir)
    const contained = dir.startsWith(resolvedRoot + path.sep) && path.dirname(path.dirname(dir)) === resolvedRoot
    if (!contained || path.basename(dir) !== raw) {
      failed.push({ id: raw, error: 'outside-root' })
      continue
    }
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 2 })
      deleted.push({ id: raw, bytes: session.bytes })
      freedBytes += session.bytes
    } catch (error) {
      failed.push({ id: raw, error: String(error?.code ?? error?.message ?? error) })
    }
  }

  return { deleted, failed, freedBytes }
}
