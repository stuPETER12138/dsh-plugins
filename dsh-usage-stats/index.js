/**
 * Host half of `@local/dsh-usage-stats`.
 *
 * Folds this machine's own session logs into token and cost figures and answers
 * one loopback-only JSON route with a single range. Sources, all public Services:
 *
 *  - `sessionPersistence.list()` names every stored session and its revision; a
 *    stored summary is read again only when that revision moved.
 *  - `sessionPersistence.open(id, 'read')` reads one stored log without taking
 *    write ownership; `sessionQuery.readSession()` is the fallback for a log the
 *    persistence backend cannot open before migrating it.
 *  - `sessions` yields the live in-memory sessions, folded forward from the last
 *    event already counted, so a poll only pays for the events that arrived.
 *
 * Usage is `assistant/message.usage`; cost prices it with `PRICES` (USD per 1M
 * tokens) and `FALLBACK` for models the table does not name.
 *
 * @module @local/dsh-usage-stats
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROUTE = '/dsh-usage-stats'
const DAY_MS = 86_400_000
/** Dense timeline rows; a longer history is listed by its active days only. */
const MAX_TIMELINE_DAYS = 1100
/** Sessions listed per response; the rest still count in the totals. */
const MAX_SESSIONS = 100
/** Stored-log reads in flight; decompression is the expensive part. */
const READ_CONCURRENCY = 8
/** One unreadable log may not stall a scan. */
const READ_TIMEOUT_MS = 60_000
/** Re-enumeration interval while the panel polls. */
const LIST_INTERVAL_MS = 15_000
const CACHE_VERSION = 1

/**
 * Shipped price table, USD per 1M tokens (input / output / cache read / cache
 * write). Sources, checked 2026-11-06:
 *  - DeepSeek API pricing: https://api-docs.deepseek.com/quick_start/pricing
 *  - OpenCode Console: https://opencode.ai/v2/docs/console/models/
 *  - OpenCode Go passes the same rates through: https://opencode.ai/docs/go/
 *
 * Entries named `peak`/`offPeak` are billed by the UTC hour of each call (peak
 * 01:00-04:00 and 06:00-10:00, Mon-Fri; off-peak is exactly half). A config
 * entry replaces the shipped entry with the same key.
 */
const DEEPSEEK_PEAK = { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }
const DEEPSEEK_OFF_PEAK = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 }
const PRICES = {
  'deepseek-account/deepseek-flash': { peak: DEEPSEEK_PEAK, offPeak: DEEPSEEK_OFF_PEAK },
  'deepseek-official/deepseek-flash': { peak: DEEPSEEK_PEAK, offPeak: DEEPSEEK_OFF_PEAK },
  'intern/deepseek-v4.1-flash-1017': { peak: DEEPSEEK_PEAK, offPeak: DEEPSEEK_OFF_PEAK },
  'opencode-go/deepseek-v4.1-flash': { peak: DEEPSEEK_PEAK, offPeak: DEEPSEEK_OFF_PEAK },
  'opencode-go/kimi-k3': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
  'opencode-go/qwen3.8-max': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
  'opencode-go/claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'opencode-go/gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'bailian/qwen3.8-max-0902': { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
  'bailian/kimi-k3': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
  'openasi/gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'openasi/claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'stepfun/step-5-preview': { input: 0.55, output: 2.2, cacheRead: 0.055, cacheWrite: 0.55 },
  'intern/Agents-A1': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
  'intern/Sage-A1.5': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
  'intern/Atria-Dawn-Preview': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
}

/** Rate for a model no entry names; the panel marks such a model. */
const FALLBACK = { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 0.1 }

// ── helpers ────────────────────────────────────────────────────────────────

const isObject = (value) => value !== null && typeof value === 'object'

/** A finite number, or 0. */
function num(value) {
  return Number.isFinite(value) ? value : 0
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

/** Local calendar day key (`YYYY-MM-DD`). */
function dayKey(time) {
  return DAY_FORMAT.format(new Date(time))
}

/** Local start of the day containing `time`. */
function startOfDay(time) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** `provider/model` -> its two halves; a key without a slash has no provider. */
function splitKey(key) {
  const cut = key.indexOf('/')
  return cut === -1 ? ['', key] : [key.slice(0, cut), key.slice(cut + 1)]
}

const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

/** Add one usage report's counts into a token accumulator. */
function addTokens(target, usage) {
  target.input += usage.input
  target.output += usage.output
  target.cacheRead += usage.cacheRead
  target.cacheWrite += usage.cacheWrite
  target.total += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
}

/** Price table lookup: exact `provider/model`, then bare `model`, then fallback. */
function makePriceResolver(table, fallback) {
  const byModel = {}
  for (const [key, rate] of Object.entries(table)) {
    const model = splitKey(key)[1]
    if (byModel[model] === undefined) byModel[model] = rate
  }
  return (key) => {
    const rate = table[key] ?? byModel[splitKey(key)[1]]
    return rate === undefined ? { rate: fallback, priced: false } : { rate, priced: true }
  }
}

const EMPTY_RATE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** True inside the 01:00-04:00 / 06:00-10:00 UTC weekday peak windows. */
function isPeak(time) {
  if (!(time > 0)) return false
  const moment = new Date(time)
  const day = moment.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = moment.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

/** The flat rate that applies at `time`, for either price shape. */
function rateAt(rate, time) {
  if (!isObject(rate)) return EMPTY_RATE
  if (rate.peak === undefined && rate.offPeak === undefined) return rate
  return (isPeak(time) ? rate.peak : rate.offPeak) ?? EMPTY_RATE
}

/** Price one usage report in US dollars (rates are per 1M tokens). */
function priceUsage(rate, usage) {
  return (
    (usage.input * num(rate.input) +
      usage.output * num(rate.output) +
      usage.cacheRead * num(rate.cacheRead) +
      usage.cacheWrite * num(rate.cacheWrite)) /
    1e6
  )
}

// ── per-session fold ───────────────────────────────────────────────────────

/** A folded session: plain JSON, so the cache is a `JSON.stringify` away. */
function createSummary(id) {
  return {
    id,
    title: '',
    lastActivity: null,
    requests: 0,
    costUsd: 0,
    tokens: emptyTokens(),
    models: {},
    days: {},
  }
}

/** One model bucket, so the panel can price a range per model. */
function modelBucket(summary, key) {
  return (summary.models[key] ??= { calls: 0, costUsd: 0, tokens: emptyTokens() })
}

/** One local-day bucket inside a session. */
function dayBucket(summary, time) {
  const key = dayKey(time)
  return (summary.days[key] ??= { requests: 0, costUsd: 0, tokens: emptyTokens(), models: {} })
}

/** Fold one committed event into `summary`, in place. */
function foldEvent(summary, event, priceFor) {
  const time = num(event.time)
  if (time > 0 && (summary.lastActivity === null || time > summary.lastActivity)) summary.lastActivity = time
  if (event.type === 'session/title') {
    const title = typeof event.data?.title === 'string' ? event.data.title.trim() : ''
    if (title !== '') summary.title = title
    return
  }
  const usage = event.type === 'assistant/message' ? event.data?.usage : null
  if (!isObject(usage)) return

  const tokens = {
    input: num(usage.inputTokens),
    output: num(usage.outputTokens),
    cacheRead: num(usage.cacheReadTokens),
    cacheWrite: num(usage.cacheWriteTokens),
  }
  const source = event.data.message?.source
  const key = (typeof source?.provider === 'string' ? source.provider : 'unknown') + '/' + (typeof source?.model === 'string' ? source.model : 'unknown')
  const { rate, priced } = priceFor(key)
  // A peak/off-peak entry is priced by this call's own start time.
  const cost = priceUsage(rateAt(rate, time), tokens)

  summary.requests += 1
  summary.costUsd += cost
  addTokens(summary.tokens, tokens)

  const model = modelBucket(summary, key)
  model.calls += 1
  model.costUsd += cost
  addTokens(model.tokens, tokens)

  if (time <= 0) return
  const day = dayBucket(summary, time)
  day.requests += 1
  day.costUsd += cost
  addTokens(day.tokens, tokens)
  const dayModel = (day.models[key] ??= { calls: 0, costUsd: 0, tokens: emptyTokens() })
  dayModel.calls += 1
  dayModel.costUsd += cost
  addTokens(dayModel.tokens, tokens)
}

/** Fold a complete event slice into a fresh summary. */
function foldEvents(id, events, priceFor) {
  const summary = createSummary(id)
  for (const event of events) foldEvent(summary, event, priceFor)
  return summary
}

// ── the durable summary cache ──────────────────────────────────────────────

/** Cache location inside the Harness home; null disables persistence. */
function cachePath() {
  const profileDir = process.env.DSH_PROFILE_DIR
  const home =
    process.env.DSH_HOME ||
    // The profile directory is `<home>/profiles/<name>`.
    (profileDir ? path.dirname(path.dirname(profileDir)) : '') ||
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  return path.isAbsolute(home) ? path.join(home, 'cache', 'dsh-usage-stats', 'summaries.json') : null
}

/** Fingerprint of the costing rules a cached summary was priced with. */
function pricesFingerprint(config) {
  return JSON.stringify({ prices: config.prices, fallback: config.fallback })
}

/** Cheap shape check: the cache is ours, but a truncated file must not poison a number. */
function isSummary(value) {
  return isObject(value) && typeof value.id === 'string' && isObject(value.tokens) && isObject(value.models) && isObject(value.days)
}

/** Hydrate `state.stored` before the first request, so a restart paints at once. */
async function loadCache(state) {
  if (state.cacheFile === null) return
  try {
    const raw = JSON.parse(await readFile(state.cacheFile, 'utf8'))
    if (raw?.v !== CACHE_VERSION || raw.prices !== pricesFingerprint(state.config)) return
    for (const [id, entry] of Object.entries(raw.sessions ?? {})) {
      if (state.stored.has(id) || !isSummary(entry?.summary)) continue
      state.stored.set(id, { revision: entry.revision ?? null, summary: entry.summary })
    }
  } catch (_error) {
    // Absent, corrupt, or from another version: one cold scan, never a wrong number.
  }
}

async function saveCache(state) {
  if (state.cacheFile === null || state.stored.size === 0) return
  const sessions = {}
  for (const [id, entry] of state.stored) {
    // A live fold kept after its session closed has no revision; the next scan
    // replaces it, so persisting it could only freeze a stale restart value.
    if (entry.revision !== null) sessions[id] = entry
  }
  const payload = JSON.stringify({ v: CACHE_VERSION, prices: pricesFingerprint(state.config), sessions })
  try {
    await mkdir(path.dirname(state.cacheFile), { recursive: true })
    const temporary = state.cacheFile + '.tmp'
    await writeFile(temporary, payload, 'utf8')
    await rename(temporary, state.cacheFile)
  } catch (_error) {
    // An unwritable cache costs one cold scan on the next start, never correctness.
  }
}

// ── scan ───────────────────────────────────────────────────────────────────

/** Run `worker` over `items` with at most `limit` in flight. */
async function runPool(items, limit, worker) {
  let cursor = 0
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

/**
 * Read one stored log through the persistence backend, falling back to
 * `sessionQuery.readSession`. An inherited fork prefix is skipped so a fork
 * never counts its parent's tokens twice.
 */
async function readStored(ctx, state, id, viaQuery) {
  const query = ctx.get('sessionQuery')
  const readViaQuery = async () => {
    if (query === undefined) return null
    try {
      const snapshot = await query.readSession(id)
      return foldEvents(id, snapshot.events.slice(num(snapshot.inheritedEventCount)), state.priceFor)
    } catch (_error) {
      return null
    }
  }

  if (viaQuery) {
    const migrated = await readViaQuery()
    if (migrated !== null) return migrated
  }

  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined) {
    let handle
    try {
      const signal = AbortSignal.timeout(READ_TIMEOUT_MS)
      handle = await persistence.open(id, 'read', { signal })
      const result = await handle.read(undefined, undefined, { signal })
      const start = num(handle.inheritedEventCount)
      return foldEvents(id, result.events.slice(start), state.priceFor)
    } catch (_error) {
      /* fall through to the query service */
    } finally {
      if (handle !== undefined) {
        try {
          await handle.close()
        } catch (_closeError) {
          /* a failed close leaves no resource this plugin owns */
        }
      }
    }
  }

  return readViaQuery()
}

/**
 * Re-enumerate stored sessions and read only the logs whose revision moved. A
 * session live in this process is skipped: its in-memory log is the fresher
 * source, and the next scan after it closes picks it up.
 */
async function scanStored(ctx, state) {
  if (state.scanning) return
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    state.error = 'sessionPersistence is not available in this profile'
    return
  }

  state.scanning = true
  state.scanned = 0
  state.failed = 0
  try {
    const snapshots = await persistence.list()
    const liveIds = new Set(ctx.sessions.list().map((session) => String(session.id)))
    state.total = snapshots.length

    const jobs = []
    const present = new Set()
    for (const snapshot of snapshots) {
      const id = String(snapshot.header.id)
      present.add(id)
      if (liveIds.has(id)) continue
      if (state.stored.get(id)?.revision === snapshot.revision) continue
      // An older log format needs a migration to be read, which is several times
      // slower, so current-format sessions go first and the panel fills with
      // today's numbers while the old tail is still working.
      jobs.push({ id, revision: snapshot.revision, createdAt: num(snapshot.header.createdAt), viaQuery: snapshot.formatStatus === 'migration-required' })
    }
    for (const id of state.stored.keys()) {
      if (!present.has(id) && !liveIds.has(id)) state.stored.delete(id)
    }

    jobs.sort((left, right) => (left.viaQuery === right.viaQuery ? right.createdAt - left.createdAt : left.viaQuery ? 1 : -1))
    state.scanned = state.total - jobs.length
    await runPool(jobs, READ_CONCURRENCY, async (job) => {
      const summary = await readStored(ctx, state, job.id, job.viaQuery)
      if (summary === null) state.failed += 1
      else state.stored.set(job.id, { revision: job.revision, summary })
      state.scanned += 1
    })
    state.error = null
  } catch (error) {
    state.error = messageOf(error)
  } finally {
    state.scanning = false
    state.lastScanAt = Date.now()
  }
  void saveCache(state)
}

/** Fold a live session forward from the last sequence already accounted for. */
function summarizeLive(state, session) {
  const id = String(session.id)
  const seq = num(session.seq)
  const inherited = num(session.inheritedEventCount)
  let entry = state.live.get(id)
  if (entry === undefined || entry.seq > seq || entry.seq < inherited) {
    entry = { seq: inherited, summary: createSummary(id) }
  }
  for (let cursor = entry.seq; cursor < seq; cursor += 1) {
    const event = session.eventAt(cursor)
    if (event !== undefined) foldEvent(entry.summary, event, state.priceFor)
  }
  entry.seq = seq
  state.live.set(id, entry)
  return entry.summary
}

// ── aggregate ──────────────────────────────────────────────────────────────

/** Add one model bucket into a model-total table. */
function addBucket(map, key, bucket) {
  const entry = (map[key] ??= { calls: 0, costUsd: 0, tokens: emptyTokens() })
  entry.calls += bucket.calls
  entry.costUsd += bucket.costUsd
  addTokens(entry.tokens, bucket.tokens)
}

/** One timeline row; a day without usage is a real, empty row. */
function timelineRow(day, bucket) {
  return {
    day,
    input: bucket?.tokens.input ?? 0,
    output: bucket?.tokens.output ?? 0,
    cacheRead: bucket?.tokens.cacheRead ?? 0,
    cacheWrite: bucket?.tokens.cacheWrite ?? 0,
    total: bucket?.tokens.total ?? 0,
    costUsd: bucket?.costUsd ?? 0,
    requests: bucket?.requests ?? 0,
  }
}

/**
 * Build the response body: the totals, timeline, model composition and session
 * list of one range, derived on demand from the summary maps.
 */
function buildPayload(ctx, state, days) {
  const now = Date.now()
  const liveSessions = ctx.sessions.list()
  const liveIds = new Set(liveSessions.map((session) => String(session.id)))

  for (const [id, entry] of state.live) {
    if (liveIds.has(id)) continue
    // Keep the last fold of a closed session rather than dropping it from the
    // totals until the next scan reads its log.
    state.stored.set(id, { revision: null, summary: entry.summary })
    state.live.delete(id)
  }

  const summaries = liveSessions.map((session) => summarizeLive(state, session))
  for (const [id, entry] of state.stored) if (!liveIds.has(id)) summaries.push(entry.summary)

  const from = days > 0 ? startOfDay(now - (days - 1) * DAY_MS) : 0
  const totals = { sessions: 0, requests: 0, costUsd: 0, tokens: emptyTokens() }
  const dayTotals = {}
  const modelTotals = {}
  const sessions = []

  for (const summary of summaries) {
    const figures = { requests: 0, costUsd: 0, tokens: emptyTokens() }
    if (from === 0) {
      // All time: the summary totals are exact, including timestamp-less events.
      figures.requests = summary.requests
      figures.costUsd = summary.costUsd
      figures.tokens = { ...summary.tokens }
      for (const [key, bucket] of Object.entries(summary.models)) addBucket(modelTotals, key, bucket)
    }
    for (const [day, bucket] of Object.entries(summary.days)) {
      const time = Date.parse(day + 'T00:00:00')
      if (!Number.isFinite(time)) continue
      if (from > 0 && time >= from) {
        figures.requests += bucket.requests
        figures.costUsd += bucket.costUsd
        addTokens(figures.tokens, bucket.tokens)
        for (const [key, model] of Object.entries(bucket.models)) addBucket(modelTotals, key, model)
      }
      const total = (dayTotals[day] ??= { requests: 0, costUsd: 0, tokens: emptyTokens() })
      total.requests += bucket.requests
      total.costUsd += bucket.costUsd
      addTokens(total.tokens, bucket.tokens)
    }

    totals.requests += figures.requests
    totals.costUsd += figures.costUsd
    addTokens(totals.tokens, figures.tokens)
    if (figures.tokens.total > 0) {
      sessions.push({
        id: summary.id,
        title: summary.title,
        live: liveIds.has(summary.id),
        lastActivity: summary.lastActivity,
        requests: figures.requests,
        tokens: figures.tokens,
        costUsd: figures.costUsd,
      })
    }
  }
  totals.sessions = sessions.length

  const activeDays = Object.keys(dayTotals).sort()
  const start = from > 0 ? from : activeDays.length > 0 ? startOfDay(Date.parse(activeDays[0] + 'T00:00:00')) : startOfDay(now)
  const end = startOfDay(now)
  const span = Math.round((end - start) / DAY_MS) + 1
  const timeline = []
  if (span > 0 && span <= MAX_TIMELINE_DAYS) {
    // An idle day is information: it keeps its own column instead of vanishing.
    const cursor = new Date(start)
    for (let guard = 0; cursor.getTime() <= end && guard < MAX_TIMELINE_DAYS; guard += 1) {
      const day = dayKey(cursor.getTime())
      timeline.push(timelineRow(day, dayTotals[day]))
      cursor.setDate(cursor.getDate() + 1)
    }
  } else {
    for (const day of activeDays) timeline.push(timelineRow(day, dayTotals[day]))
  }

  const models = Object.entries(modelTotals)
    .map(([key, bucket]) => {
      const [provider, model] = splitKey(key)
      return {
        key,
        provider,
        model,
        calls: bucket.calls,
        tokens: bucket.tokens,
        costUsd: bucket.costUsd,
        priced: state.priceFor(key).priced,
      }
    })
    .sort((left, right) => right.tokens.total - left.tokens.total)

  sessions.sort((left, right) => (right.lastActivity ?? 0) - (left.lastActivity ?? 0))

  return {
    generatedAt: now,
    days,
    scan: {
      state: state.scanning ? 'scanning' : 'idle',
      scanned: state.scanned,
      total: state.total,
      failed: state.failed,
      error: state.error,
    },
    totals,
    timeline,
    models,
    sessions: sessions.slice(0, MAX_SESSIONS),
  }
}

// ── HTTP ───────────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } })
}

/** True for a `host[:port]` naming this machine's loopback interface. */
function isLoopbackHost(value) {
  if (typeof value !== 'string' || value === '') return false
  const raw = value.startsWith('[') ? value.slice(1, value.indexOf(']')) : value.split(':')[0]
  const host = raw.toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  // A literal IPv4 in 127/8 only: a name such as `127.0.0.1.attacker.com` also
  // starts with "127." and would let a rebinding page through.
  const parts = host.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Answer only loopback callers. A loopback peer is not enough on its own: a page
 * on a rebinding domain also connects to 127.0.0.1, so the `Host` header and a
 * present `Origin` must be loopback too.
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress
  if (typeof address !== 'string') return false
  const peer = (address.startsWith('::ffff:') ? address.slice(7) : address).split('%')[0]
  if (!(peer === '::1' || peer.startsWith('127.'))) return false
  if (!isLoopbackHost(req.headers.host)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return isLoopbackHost(new URL(origin).host)
  } catch (_error) {
    return false
  }
}

/** `?days=` as a range; `0` means all time. */
function readDays(url) {
  const value = Number.parseInt(url.searchParams.get('days') ?? '', 10)
  if (!Number.isFinite(value)) return 7
  if (value <= 0) return 0
  return Math.min(3660, value)
}

// ── plugin ─────────────────────────────────────────────────────────────────

/** Services this Host half needs before it activates. */
export const inject = ['webServer', 'sessions', 'sessionPersistence']

/** Merge the user's config over the shipped prices and fallback rates. */
function resolveConfig(config) {
  const input = isObject(config) ? config : {}
  return {
    prices: { ...PRICES, ...(isObject(input.prices) ? input.prices : {}) },
    fallback: { ...FALLBACK, ...(isObject(input.fallback) ? input.fallback : {}) },
  }
}

/**
 * Serve the panel. The first read request starts the first scan, so a profile
 * that never opens the panel pays nothing.
 */
export function apply(ctx, config) {
  const state = {
    config: resolveConfig(config),
    stored: new Map(), // sessionId -> { revision, summary }
    live: new Map(), // sessionId -> { seq, summary }
    scanning: false,
    scanned: 0,
    total: 0,
    failed: 0,
    error: null,
    lastScanAt: 0,
    cacheFile: cachePath(),
  }
  state.priceFor = makePriceResolver(state.config.prices, state.config.fallback)
  const cacheReady = loadCache(state)

  const handler = async (req, res) => {
    if (!isLoopback(req)) {
      sendError(res, 403, 'forbidden', 'usage-stats is only reachable from this machine')
      return
    }
    if (req.method !== 'GET') {
      sendError(res, 405, 'method-not-allowed', 'GET required')
      return
    }
    try {
      await cacheReady
      if (!state.scanning && Date.now() - state.lastScanAt > LIST_INTERVAL_MS) void scanStored(ctx, state)
      sendJson(res, 200, buildPayload(ctx, state, readDays(new URL(req.url ?? ROUTE, 'http://localhost'))))
    } catch (error) {
      sendError(res, 500, 'internal-error', messageOf(error))
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }), 'usage-stats: route')
  ctx.effect(
    () => () => {
      // Flush the most recent fold on reload; never before the first scan, so an
      // empty instance cannot replace a populated cache.
      if (state.lastScanAt > 0) void saveCache(state)
    },
    'usage-stats: cache',
  )
}
