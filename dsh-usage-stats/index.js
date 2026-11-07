/**
 * Host half of the Usage Stats bundle: `@local/dsh-usage-stats`.
 *
 * The plugin answers two questions from this machine's own durable session
 * logs — how many tokens the Harness has spent and what that costs — and serves
 * them to the browser half over three loopback-only HTTP routes (see `API.md`).
 *
 * Data comes from public Services, never from files:
 *  - `sessionPersistence.list()` gives one cheap snapshot (revision, event
 *    count) per stored session; a matching revision means the derived summary
 *    is still valid, so a warm scan reads only what changed.
 *  - `sessionPersistence.open(id, 'read')` reads one stored log without taking
 *    write ownership, and `readSession` is the fallback when the persistence
 *    backend cannot open a session directly.
 *  - `sessions.list()` yields the live in-memory sessions; their events are
 *    folded incrementally from the last sequence already accounted for, so a
 *    3-second poll costs only the events committed since the previous poll.
 *
 * Token usage is read from `assistant/message.usage`, which every successful
 * model call logs. Cost is that usage priced by `config.prices` (USD per 1M
 * tokens); anything the table does not name is priced by `config.fallback` and
 * flagged, so the panel can say an estimate mixed in a fallback rate.
 *
 * @module @local/dsh-usage-stats
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROUTE_FULL = '/dsh-usage-stats'
const ROUTE_LIVE = '/dsh-usage-stats/live'
const ROUTE_REFRESH = '/dsh-usage-stats/refresh'

/** Upper bound on dense timeline rows; longer all-time histories stay sparse. */
const MAX_TIMELINE_DAYS = 1100

/**
 * Shipped price table, USD per 1M tokens (input / output / cache read / cache write).
 *
 * Sources, checked 2026-11-06:
 *  - DeepSeek official API pricing: https://api-docs.deepseek.com/quick_start/pricing
 *    (deepseek-flash = DeepSeek-V4.1-Flash-1017; peak 0.30 / 1.20 / 0.006, off-peak half)
 *  - OpenCode Console pricing: https://opencode.ai/v2/docs/console/models/
 *    (DeepSeek V4.1 Flash 0.30 / 1.20 / 0.006, Kimi K3 3.00 / 15.00 / 0.30 / 3.00,
 *     Qwen3.8 Max 2.00 / 6.00 / 0.25 / 2.50, Claude Opus 5.5 4.00 / 20.00 / 0.20 / 5.00,
 *     GPT 6 Astra 10.00 / 50.00 / 1.00 / 12.50)
 *  - OpenCode Go passes the same token rates through and bills DeepSeek peak/off-peak:
 *    https://opencode.ai/docs/go/
 *
 * A model present under several providers shares the model's vendor rates. Anything
 * else is priced by `DEFAULT_FALLBACK_PRICE` and flagged in the panel.
 * DeepSeek and OpenCode Go bill `peak` (01:00-04:00 and 06:00-10:00 UTC, Mon-Fri) and
 * `offPeak` (everything else, exactly half); entries without those two blocks are flat.
 */
const DEEPSEEK_PEAK = { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 }
const DEEPSEEK_OFF_PEAK = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 }
const DEFAULT_PRICES = {
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
  // No public rate sheet found for these; kept as the previous estimate.
  'stepfun/step-5-preview': { input: 0.55, output: 2.2, cacheRead: 0.055, cacheWrite: 0.55 },
  'intern/Agents-A1': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
  'intern/Sage-A1.5': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
  'intern/Atria-Dawn-Preview': { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
}

const DEFAULT_FALLBACK_PRICE = { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 0.1 }

/** Tunables a user may override from the bundle's patch row. */
const DEFAULTS = {
  /**
   * Automatic re-read of the stored logs while the panel is open. A list call
   * is cheap, a full read is not, so the interval only gates how often the
   * store is re-enumerated.
   */
  listIntervalMs: 15000,
  /** Concurrency of stored-log reads; decompression bounds a scan. */
  readConcurrency: 8,
  /** One stored log may not stall a scan forever. */
  readTimeoutMs: 60000,
  /** A scan that runs longer than this stops and reports what it has. */
  maxScanMs: 240000,
  /** Sessions listed per full response; the panel pages what it receives. */
  maxSessions: 2000,
  prices: {},
  fallback: {},
}

/** Accepted bounds for the tunables a user may override. */
const CLAMP = {
  listIntervalMs: [2000, 3600000],
  readConcurrency: [1, 8],
  readTimeoutMs: [1000, 600000],
  maxScanMs: [5000, 3600000],
  maxSessions: [1, 100000],
}

/** One integer config value, clamped to its bounds, or the default. */
function clampInt(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

// ── small helpers ──────────────────────────────────────────────────────────

/** Read a finite number, treating anything else as zero. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

/** Local calendar day key (`YYYY-MM-DD`) for one epoch millisecond. */
function dayKey(time) {
  return DAY_FORMATTER.format(new Date(time))
}

/** Local start of the day containing `time`. */
function startOfDay(time) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Price table lookup: exact `provider/model`, then `model`, then a fallback. */
function makePriceResolver(table, fallback) {
  const byModel = new Map()
  for (const [key, price] of Object.entries(table)) {
    const model = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key
    if (!byModel.has(model)) byModel.set(model, price)
  }
  return (providerModel) => {
    const exact = table[providerModel]
    if (exact !== undefined) return { price: exact, priced: true }
    const model = providerModel.includes('/') ? providerModel.slice(providerModel.indexOf('/') + 1) : providerModel
    const loose = byModel.get(model)
    if (loose !== undefined) return { price: loose, priced: true }
    return { price: fallback, priced: false }
  }
}

/** Price one usage report in US dollars (rates are per 1M tokens). */
function priceUsage(price, usage) {
  return (
    (usage.input * num(price.input)) / 1e6 +
    (usage.output * num(price.output)) / 1e6 +
    (usage.cacheRead * num(price.cacheRead)) / 1e6 +
    (usage.cacheWrite * num(price.cacheWrite)) / 1e6
  )
}

const EMPTY_RATE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Peak window for the models billed with two rate blocks: 01:00-04:00 and
 * 06:00-10:00 UTC, Monday to Friday. Every other hour, including the weekend, is
 * off-peak at half the peak rate. DeepSeek additionally treats Chinese public
 * holidays as off-peak; that calendar is not modelled here, so a holiday weekday
 * is billed at the higher peak rate (a small overestimate).
 */
function isPeakRateTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return false
  const moment = new Date(time)
  const day = moment.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = moment.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

/** The flat rate that applies at `time`, for either price shape. */
function rateAt(price, time) {
  if (price === null || typeof price !== 'object') return EMPTY_RATE
  if (price.peak !== undefined || price.offPeak !== undefined) {
    return (isPeakRateTime(time) ? price.peak : price.offPeak) ?? EMPTY_RATE
  }
  return price
}

const EMPTY_TOKENS = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 })

/** Add one usage report's token counts into a token accumulator. */
function addTokens(target, usage) {
  target.input += usage.input
  target.output += usage.output
  target.cacheRead += usage.cacheRead
  target.cacheWrite += usage.cacheWrite
  target.reasoning += usage.reasoning
  target.total += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
}

/** Normalize one provider usage report; `total` is derived, never trusted raw. */
function readUsage(raw) {
  const usage = {
    input: num(raw.inputTokens),
    output: num(raw.outputTokens),
    cacheRead: num(raw.cacheReadTokens),
    cacheWrite: num(raw.cacheWriteTokens),
    reasoning: num(raw.reasoningTokens),
  }
  return usage
}

function addTokenViews(a, b) {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheWrite += b.cacheWrite
  a.reasoning += b.reasoning
  a.total += b.total
}

/** Fold one model bucket into a model-total Map, creating it on first sight. */
function addModelBucket(map, key, bucket) {
  let entry = map.get(key)
  if (entry === undefined) {
    map.set(key, { calls: bucket.calls, costUsd: bucket.costUsd, unpricedCalls: bucket.unpricedCalls, tokens: { ...bucket.tokens } })
    return
  }
  entry.calls += bucket.calls
  entry.costUsd += bucket.costUsd
  entry.unpricedCalls += bucket.unpricedCalls
  addTokenViews(entry.tokens, bucket.tokens)
}

// ── per-session fold ───────────────────────────────────────────────────────

/**
 * A session summary is a pure fold over that session's own events. `models`
 * and `days` stay as Maps while folding and are converted once per response.
 */
function createSummary(header, id) {
  return {
    id,
    title: '',
    cwd: typeof header?.cwd === 'string' ? header.cwd : null,
    agentPreset: typeof header?.agentPreset === 'string' ? header.agentPreset : null,
    origin: header?.origin === 'subagent' ? 'subagent' : null,
    parentSession: typeof header?.parentSession === 'string' ? header.parentSession : null,
    createdAt: num(header?.createdAt) || null,
    firstActivity: null,
    lastActivity: null,
    turns: 0,
    requests: 0,
    userMessages: 0,
    toolCalls: 0,
    tokens: EMPTY_TOKENS(),
    costUsd: 0,
    unpricedCalls: 0,
    models: new Map(),
    days: new Map(),
    seq: 0,
  }
}

/** One day bucket inside a session summary. */
function dayBucket(summary, time) {
  const key = dayKey(time)
  let bucket = summary.days.get(key)
  if (bucket === undefined) {
    bucket = {
      requests: 0,
      turns: 0,
      userMessages: 0,
      toolCalls: 0,
      costUsd: 0,
      tokens: EMPTY_TOKENS(),
      models: new Map(),
    }
    summary.days.set(key, bucket)
  }
  return bucket
}

/** One model bucket inside a day bucket, so a date range can be priced per model. */
function dayModelBucket(bucket, key) {
  let entry = bucket.models.get(key)
  if (entry === undefined) {
    entry = { calls: 0, costUsd: 0, unpricedCalls: 0, tokens: EMPTY_TOKENS() }
    bucket.models.set(key, entry)
  }
  return entry
}

/** One model bucket inside a session summary. */
function modelBucket(summary, key) {
  let bucket = summary.models.get(key)
  if (bucket === undefined) {
    bucket = { calls: 0, costUsd: 0, unpricedCalls: 0, tokens: EMPTY_TOKENS() }
    summary.models.set(key, bucket)
  }
  return bucket
}

/**
 * Fold one committed event into `summary` (mutating it). Returning early for
 * uninteresting event types is deliberate: a long session logs far more tool
 * traffic than model calls.
 */
function foldEvent(summary, event, resolvePrice) {
  const type = event.type
  const time = num(event.time)

  if (time > 0) {
    if (summary.firstActivity === null || time < summary.firstActivity) summary.firstActivity = time
    if (summary.lastActivity === null || time > summary.lastActivity) summary.lastActivity = time
  }

  switch (type) {
    case 'assistant/message': {
      const data = event.data
      if (data === null || typeof data !== 'object') return
      if (data.usage === null || typeof data.usage !== 'object') return
      const usage = readUsage(data.usage)
      const source = data.message?.source
      const provider = typeof source?.provider === 'string' ? source.provider : 'unknown'
      const model = typeof source?.model === 'string' ? source.model : 'unknown'
      const key = provider + '/' + model
      const { price, priced } = resolvePrice(key)
      // Peak/off-peak entries are priced by the event's own UTC start time.
      const cost = priceUsage(rateAt(price, time), usage)

      summary.requests += 1
      if (!priced) summary.unpricedCalls += 1
      summary.costUsd += cost
      addTokens(summary.tokens, usage)

      const modelEntry = modelBucket(summary, key)
      modelEntry.calls += 1
      modelEntry.costUsd += cost
      if (!priced) modelEntry.unpricedCalls += 1
      addTokens(modelEntry.tokens, usage)

      const bucket = time > 0 ? dayBucket(summary, time) : null
      if (bucket !== null) {
        bucket.requests += 1
        bucket.costUsd += cost
        addTokens(bucket.tokens, usage)
        const dayModel = dayModelBucket(bucket, key)
        dayModel.calls += 1
        dayModel.costUsd += cost
        if (!priced) dayModel.unpricedCalls += 1
        addTokens(dayModel.tokens, usage)
      }
      return
    }
    case 'turn/start':
      summary.turns += 1
      if (time > 0) dayBucket(summary, time).turns += 1
      return
    case 'user/message':
      summary.userMessages += 1
      if (time > 0) dayBucket(summary, time).userMessages += 1
      return
    case 'tool/call':
      summary.toolCalls += 1
      if (time > 0) dayBucket(summary, time).toolCalls += 1
      return
    case 'session/title': {
      const title = event.data?.title
      if (typeof title === 'string' && title.trim() !== '') summary.title = title.trim()
      return
    }
    default:
      return
  }
}

/** Fold a complete event slice, starting from an empty summary. */
function foldEvents(header, id, events, resolvePrice) {
  const summary = createSummary(header, id)
  for (const event of events) foldEvent(summary, event, resolvePrice)
  return summary
}

// ── the durable summary cache ──────────────────────────────────────────────

/**
 * A cold scan is the only slow thing this plugin does: it decompresses and parses
 * every stored log once (hundreds of megabytes for a few hundred sessions). The
 * fold it produces is a pure function of (session events, price table), so the
 * summaries are cached on disk and revalidated against each session's persistence
 * revision on every start — a mismatched revision simply re-reads that one
 * session, so a stale cache can never change a number, and the price fingerprint
 * discards the whole cache when costing changes.
 */
const CACHE_VERSION = 5

/** Cache location inside the Harness home; null disables persistence. */
function dshHomeDir() {
  const explicit = process.env.DSH_HOME
  if (typeof explicit === 'string' && explicit !== '') return explicit
  const profileDir = process.env.DSH_PROFILE_DIR
  // The profile directory is `<home>/profiles/<name>`, so its grandparent is the home.
  if (typeof profileDir === 'string' && profileDir !== '') return path.dirname(path.dirname(profileDir))
  const userHome = process.env.USERPROFILE ?? process.env.HOME
  if (typeof userHome === 'string' && userHome !== '') return path.join(userHome, '.dsh')
  return null
}

function cacheFilePath() {
  const home = dshHomeDir()
  return home === null ? null : path.join(home, 'cache', 'dsh-usage-stats', 'summaries.v' + CACHE_VERSION + '.json')
}

/** Fingerprint of the costing rules a cached summary was priced with. */
function pricesFingerprint(config) {
  return createHash('sha256').update(JSON.stringify({ prices: config.prices, fallback: config.fallback })).digest('hex').slice(0, 16)
}

/**
 * Cache JSON for one token accumulator, and its inverse. The cache is written by
 * this plugin alone, so the reader only has to survive a partial or older file.
 */
function tokensFromJson(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const tokens = { input: num(source.input), output: num(source.output), cacheRead: num(source.cacheRead), cacheWrite: num(source.cacheWrite), reasoning: num(source.reasoning), total: num(source.total) }
  return tokens
}

/** One model bucket out of a `[key, bucket]` entry array, or undefined if malformed. */
function modelEntryFromJson(entry) {
  if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[1] === null || typeof entry[1] !== 'object') return null
  const bucket = entry[1]
  return [entry[0], { calls: num(bucket.calls), costUsd: num(bucket.costUsd), unpricedCalls: num(bucket.unpricedCalls), tokens: tokensFromJson(bucket.tokens) }]
}

/** A Map of model buckets from its cache array. */
function modelMapFromJson(raw) {
  const map = new Map()
  for (const entry of Array.isArray(raw) ? raw : []) {
    const parsed = modelEntryFromJson(entry)
    if (parsed !== null) map.set(parsed[0], parsed[1])
  }
  return map
}

/** One day bucket as cache JSON; its per-model Map becomes an entry array. */
function dayBucketToJson(bucket) {
  return {
    requests: bucket.requests,
    turns: bucket.turns,
    userMessages: bucket.userMessages,
    toolCalls: bucket.toolCalls,
    costUsd: bucket.costUsd,
    tokens: bucket.tokens,
    models: [...bucket.models],
  }
}

/** Rebuild one day bucket from cached JSON, tolerating an older shape. */
function dayBucketFromJson(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    requests: num(source.requests),
    turns: num(source.turns),
    userMessages: num(source.userMessages),
    toolCalls: num(source.toolCalls),
    costUsd: num(source.costUsd),
    tokens: tokensFromJson(source.tokens),
    models: modelMapFromJson(source.models),
  }
}

/**
 * Scalar summary fields, each with the coercion its cached value needs. Keeping the
 * two directions on one table is what stops a field from being written but not read.
 */
const SUMMARY_FIELDS = {
  title: (value) => (typeof value === 'string' ? value : ''),
  cwd: (value) => (typeof value === 'string' ? value : null),
  agentPreset: (value) => (typeof value === 'string' ? value : null),
  origin: (value) => (value === 'subagent' ? 'subagent' : null),
  parentSession: (value) => (typeof value === 'string' ? value : null),
  createdAt: (value) => num(value) || null,
  firstActivity: (value) => (Number.isFinite(value) ? value : null),
  lastActivity: (value) => (Number.isFinite(value) ? value : null),
  turns: num,
  requests: num,
  userMessages: num,
  toolCalls: num,
  costUsd: num,
  unpricedCalls: num,
}

/** Summaries carry Maps while folding; the cache stores them as entry arrays. */
function summaryToJson(summary) {
  const out = { id: summary.id, tokens: summary.tokens, models: [...summary.models], days: [...summary.days].map(([day, bucket]) => [day, dayBucketToJson(bucket)]) }
  for (const key of Object.keys(SUMMARY_FIELDS)) out[key] = summary[key]
  return out
}

/** Rebuild one folded summary from its cached JSON, rejecting a malformed entry. */
function summaryFromJson(raw) {
  if (raw === null || typeof raw !== 'object' || typeof raw.id !== 'string') return null
  const summary = createSummary(undefined, raw.id)
  for (const [key, coerce] of Object.entries(SUMMARY_FIELDS)) summary[key] = coerce(raw[key])
  summary.tokens = tokensFromJson(raw.tokens)
  summary.models = modelMapFromJson(raw.models)
  summary.days = new Map()
  for (const entry of Array.isArray(raw.days) ? raw.days : []) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue
    summary.days.set(entry[0], dayBucketFromJson(entry[1]))
  }
  return summary
}

/**
 * Hydrate `state.stored` from the cache before the first request so a restart
 * paints the previous numbers instantly; every entry stays subject to the
 * revision check that the next scan performs.
 */
async function loadCache(state) {
  const file = cacheFilePath()
  if (file === null) {
    state.cacheNote = 'disabled: no Harness home directory'
    return
  }
  state.cacheFile = file
  try {
    // Writes go through a rename, so a reader always sees a complete file.
    const raw = JSON.parse(await readFile(file, 'utf8'))
    if (raw === null || typeof raw !== 'object' || raw.version !== CACHE_VERSION) {
      state.cacheNote = 'skipped: version ' + (raw === null ? 'null' : raw.version)
      return
    }
    if (raw.prices !== pricesFingerprint(state.config)) {
      state.cacheNote = 'skipped: price table changed'
      return
    }
    const entries = raw.entries !== null && typeof raw.entries === 'object' ? raw.entries : {}
    const names = Object.keys(entries)
    let restored = 0
    for (const [id, entry] of Object.entries(entries)) {
      if (entry === null || typeof entry !== 'object' || state.stored.has(id)) continue
      const revision = entry.revision
      if (typeof revision !== 'string' && typeof revision !== 'number') continue
      const summary = summaryFromJson(entry.summary)
      if (summary === null) continue
      state.stored.set(id, {
        revision,
        eventCount: typeof entry.eventCount === 'number' ? entry.eventCount : undefined,
        sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : undefined,
        formatStatus: typeof entry.formatStatus === 'string' ? entry.formatStatus : undefined,
        summary,
      })
      restored += 1
    }
    state.cacheNote = 'entries ' + names.length + ', restored ' + restored
    state.cacheLoadedAt = Date.now()
    if (restored > 0) {
      state.cacheRestored = restored
      state.revision += 1
    }
  } catch (error) {
    // Absent, corrupt, or unreadable: exactly one cold scan, never a wrong number.
    state.cacheNote = 'error: ' + (error instanceof Error ? error.message : String(error))
  }
}

async function saveCache(state) {
  const file = state.cacheFile
  if (file === null) return
  // Nothing learned yet (a fresh instance disposed before its first scan): never
  // overwrite a populated cache with an empty table, or the next start is cold.
  if (state.stored.size === 0) return
  const entries = {}
  for (const [id, entry] of state.stored) {
    // An entry without a revision is a live fold kept after its session closed; the
    // next scan replaces it, so persisting it would only risk a stale restart value.
    if (typeof entry.revision !== 'string' && typeof entry.revision !== 'number') continue
    entries[id] = {
      revision: entry.revision,
      eventCount: entry.eventCount,
      sizeBytes: entry.sizeBytes,
      formatStatus: entry.formatStatus,
      summary: summaryToJson(entry.summary),
    }
  }
  const payload = JSON.stringify({ version: CACHE_VERSION, prices: pricesFingerprint(state.config), savedAt: Date.now(), entries })
  try {
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = file + '.tmp'
    await writeFile(temporary, payload, 'utf8')
    await rename(temporary, file)
    state.cacheSavedAt = Date.now()
    state.cacheError = null
  } catch (error) {
    // An unwritable cache costs one cold scan on the next start, never correctness;
    // the failure is reported in the payload so it can be diagnosed.
    state.cacheError = error instanceof Error ? error.message : String(error)
  }
}

// ── the scan and its caches ────────────────────────────────────────────────

/**
 * Create the plugin state. `stored` holds summaries validated against a
 * persistence revision; `live` holds fold state for in-memory sessions, which
 * is extended event by event between polls.
 */
function createState(config) {
  return {
    config,
    stored: new Map(), // sessionId -> { revision, summary }
    live: new Map(), // sessionId -> summary (with `seq` = next unread event)
    revision: 1,
    liveSignature: null,
    scanning: false,
    scanStartedAt: null,
    scanFinishedAt: null,
    scanElapsedMs: null,
    scanTotal: 0,
    scanScanned: 0,
    scanUnreadable: 0,
    scanError: null,
    scanReadMs: 0,
    scanMigrated: 0,
    lastListAt: 0,
    listing: false,
    cacheFile: null,
    cacheRestored: 0,
    cacheSavedAt: null,
    cacheLoadedAt: null,
    cacheError: null,
    cacheNote: null,
    cacheReady: null,
  }
}

/**
 * True while a stored summary still describes the log a list() snapshot names.
 *
 * A matching revision is definitive. When it differs, the log may only have been
 * rewritten by a format migration — the same events under a new revision — so an
 * identical event count and byte size are accepted as unchanged. A legacy log
 * that still reports `migration-required` and is not live has no writer at all:
 * this machine's own migration is the only thing that can touch it, and migration
 * preserves every event, so its cached fold stays authoritative.
 */
function isFresh(entry, snapshot) {
  if (entry === undefined) return false
  if (snapshot.revision !== undefined && entry.revision === snapshot.revision) return true
  if (
    typeof entry.eventCount === 'number' &&
    typeof entry.sizeBytes === 'number' &&
    entry.eventCount === snapshot.eventCount &&
    entry.sizeBytes === snapshot.sizeBytes
  ) {
    return true
  }
  return snapshot.formatStatus === 'migration-required' && entry.formatStatus === 'migration-required'
}

/**
 * Re-enumerate stored sessions and read only the logs whose revision changed.
 * A session that is live in this process is skipped: its in-memory log is the
 * fresher source and the next scan after it closes will pick it up.
 */
async function scanStored(ctx, state) {
  if (state.scanning) return false
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    state.scanError = 'sessionPersistence is not available in this profile'
    return false
  }

  state.scanning = true
  state.scanStartedAt = Date.now()
  state.scanFinishedAt = null
  state.scanElapsedMs = null
  state.scanUnreadable = 0
  state.scanError = null
  state.scanReadMs = 0
  state.scanMigrated = 0

  try {
    const snapshots = await persistence.list()
    const liveIds = new Set(ctx.sessions.list().map((session) => String(session.id)))
    state.scanTotal = snapshots.length

    const queue = []
    const present = new Set()
    for (const snapshot of snapshots) {
      const id = String(snapshot.header.id)
      present.add(id)
      if (liveIds.has(id)) continue
      if (isFresh(state.stored.get(id), snapshot)) continue
      // An older log format cannot be opened by the persistence backend until it
      // migrates, and migrating one is several times slower than reading a current
      // log. Current-format sessions are therefore read first (recent ones first), so
      // the panel fills with today's numbers while the old tail is still working.
      queue.push({
        id,
        revision: snapshot.revision,
        eventCount: snapshot.eventCount,
        sizeBytes: snapshot.sizeBytes,
        formatStatus: snapshot.formatStatus,
        viaQuery: snapshot.formatStatus === 'migration-required',
        createdAt: num(snapshot.header.createdAt),
      })
    }

    queue.sort((left, right) => {
      if (left.viaQuery !== right.viaQuery) return left.viaQuery ? 1 : -1
      return right.createdAt - left.createdAt
    })

    // Drop sessions the store no longer lists; they were deleted or archived away.
    for (const id of [...state.stored.keys()]) {
      if (!present.has(id) && !liveIds.has(id)) state.stored.delete(id)
    }

    state.scanScanned = state.scanTotal - queue.length
    const deadline = state.scanStartedAt + state.config.maxScanMs
    await runPool(queue, state.config.readConcurrency, async (job) => {
      if (Date.now() > deadline) {
        state.scanError = 'scan stopped after ' + state.config.maxScanMs + ' ms; some sessions are not indexed yet'
        return
      }
      const startedReadAt = Date.now()
      const summary = await readStoredSession(ctx, state, job.id, job.viaQuery)
      state.scanReadMs += Date.now() - startedReadAt
      if (summary !== null) {
        state.stored.set(job.id, {
          revision: job.revision,
          eventCount: job.eventCount,
          sizeBytes: job.sizeBytes,
          formatStatus: job.formatStatus,
          summary,
        })
        if (job.viaQuery) state.scanMigrated += 1
      } else {
        state.scanUnreadable += 1
      }
      state.scanScanned += 1
    })

    state.revision += 1
  } catch (error) {
    state.scanError = error instanceof Error ? error.message : String(error)
  } finally {
    state.scanElapsedMs = Date.now() - state.scanStartedAt
    state.scanFinishedAt = Date.now()
    state.scanning = false
    state.lastListAt = Date.now()
    if (state.scanUnreadable > 0 && state.scanError === null) {
      // A skipped log silently lowers every total, so it must surface once.
      state.scanError = state.scanUnreadable + ' session log(s) could not be read; totals exclude them'
    }
    // Persist right away: a debounce window is exactly when a restart can race the
    // write and find no cache, which costs a full re-read.
    void saveCache(state)
  }
  return true
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function runPool(items, limit, worker) {
  let cursor = 0
  const width = Math.max(1, Math.min(limit, items.length))
  const runners = new Array(width).fill(null).map(async () => {
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
 * Read one stored log through the persistence backend (no replay validation),
 * falling back to `sessionQuery.readSession`. Inherited fork prefixes are
 * skipped so a fork never double-counts its parent's tokens.
 *
 * `viaQuery` starts with the query service, which is the only reader that
 * migrates an older log format.
 */
async function readStoredSession(ctx, state, id, viaQuery) {
  const signal = AbortSignal.timeout(state.config.readTimeoutMs)
  const persistence = ctx.get('sessionPersistence')
  const query = ctx.get('sessionQuery')

  const readViaQuery = async () => {
    if (query === undefined) return null
    try {
      const snapshot = await query.readSession(id)
      const start = num(snapshot.inheritedEventCount)
      return foldEvents(snapshot.session, id, snapshot.events.slice(start), state.priceFor)
    } catch (_error) {
      return null
    }
  }

  if (viaQuery) {
    const migrated = await readViaQuery()
    if (migrated !== null) return migrated
  }

  if (persistence !== undefined) {
    let handle
    try {
      handle = await persistence.open(id, 'read', { signal })
      const result = await handle.read(undefined, undefined, { signal })
      const start = num(handle.inheritedEventCount)
      return foldEvents(handle.header, id, result.events.slice(start), state.priceFor)
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
 * Fold a live in-memory session forward from the last accounted sequence.
 * The first pass over a long session costs O(events); every later poll costs
 * only the events that arrived since the previous poll.
 */
function summarizeLive(ctx, state, session) {
  const id = String(session.id)
  const seq = num(session.seq)
  const inherited = num(session.inheritedEventCount)
  let summary = state.live.get(id)

  if (summary === undefined || summary.seq > seq || summary.seq < inherited) {
    summary = createSummary(session.header, id)
    summary.seq = inherited
  }

  for (let cursor = summary.seq; cursor < seq; cursor += 1) {
    const event = session.eventAt(cursor)
    if (event !== undefined) foldEvent(summary, event, state.priceFor)
  }
  summary.seq = seq
  state.live.set(id, summary)
  return summary
}

/** Forget live summaries for sessions that left the store. */
function pruneLive(state, liveIds) {
  for (const id of [...state.live.keys()]) {
    if (liveIds.has(id)) continue
    // The scan skips live sessions, so a closed session has no stored summary yet.
    // Keep its last fold (with no revision, so the next scan re-reads it) instead of
    // dropping the session from the totals until that scan happens.
    state.stored.set(id, { revision: null, summary: state.live.get(id) })
    state.live.delete(id)
  }
}

// ── aggregate ──────────────────────────────────────────────────────────────

/** Convert a folded token accumulator into the wire shape. */
function tokenView(tokens) {
  return {
    input: tokens.input,
    output: tokens.output,
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    reasoning: tokens.reasoning,
    total: tokens.total,
  }
}

/**
 * Build the response body shared by both read routes. Everything is derived on
 * demand from the two summary maps, so a live poll never re-reads a log.
 */
function buildAggregate(ctx, state, days) {
  const now = Date.now()
  const liveSessions = ctx.sessions.list()
  const liveIds = new Set(liveSessions.map((session) => String(session.id)))
  pruneLive(state, liveIds)
  // Fold live sessions forward; their summaries override the stored ones.
  const liveSummaries = new Map()
  for (const session of liveSessions) {
    liveSummaries.set(String(session.id), summarizeLive(ctx, state, session))
  }

  // A running session moves its own token counters forward; the revision tells
  // the panel to refetch the full payload so the session table follows along.
  let liveSignature = 0
  for (const summary of liveSummaries.values()) liveSignature += summary.seq
  if (state.liveSignature === null) state.liveSignature = liveSignature
  else if (state.liveSignature !== liveSignature) {
    state.liveSignature = liveSignature
    state.revision += 1
  }

  const all = []
  for (const [id, entry] of state.stored) {
    if (liveIds.has(id)) continue
    all.push(entry.summary)
  }
  for (const summary of liveSummaries.values()) all.push(summary)

  const totals = {
    sessions: all.length,
    sessionsWithUsage: 0,
    liveSessions: liveSummaries.size,
    requests: 0,
    turns: 0,
    userMessages: 0,
    toolCalls: 0,
    tokens: EMPTY_TOKENS(),
    costUsd: 0,
    firstActivity: null,
    lastActivity: null,
  }
  const modelTotals = new Map()
  const dayTotals = new Map()
  /** Model totals inside the selected range, priced from the per-day breakdown. */
  const rangeModelTotals = new Map()
  /** Per-session figures for the selected range, so the table follows the control. */
  const figuresList = []
  const rangeFrom = days > 0 ? startOfDay(now - (days - 1) * 86400000) : null
  // "vs previous period" must not compare a partial today against a whole previous
  // window, so both sides cover the same number of COMPLETE days: the finished days
  // of this range against the equally long window before it. Today is excluded from
  // the comparison (it is still accruing) but stays in the displayed totals.
  const completeDays = days > 1 ? days - 1 : 0
  const todayStart = startOfDay(now)
  const deltaWindows =
    completeDays === 0
      ? null
      : {
          days: completeDays,
          currentFrom: todayStart - completeDays * 86400000,
          to: todayStart,
          previousFrom: todayStart - 2 * completeDays * 86400000,
        }
  const deltaCurrent = { tokens: EMPTY_TOKENS(), costUsd: 0, requests: 0 }
  const deltaPrevious = { tokens: EMPTY_TOKENS(), costUsd: 0, requests: 0 }

  for (const summary of all) {
    if (summary.requests > 0) totals.sessionsWithUsage += 1
    totals.requests += summary.requests
    totals.turns += summary.turns
    totals.userMessages += summary.userMessages
    totals.toolCalls += summary.toolCalls
    totals.costUsd += summary.costUsd
    addTokenViews(totals.tokens, summary.tokens)
    if (summary.firstActivity !== null && (totals.firstActivity === null || summary.firstActivity < totals.firstActivity)) {
      totals.firstActivity = summary.firstActivity
    }
    if (summary.lastActivity !== null && (totals.lastActivity === null || summary.lastActivity > totals.lastActivity)) {
      totals.lastActivity = summary.lastActivity
    }
    for (const [key, bucket] of summary.models) addModelBucket(modelTotals, key, bucket)

    // The figures the session table shows: all-time for "all time", otherwise the
    // day buckets inside the selected range. Summing day buckets is what makes the
    // range control apply to per-session tokens, per-model cost AND the counts.
    const figures = {
      tokens: EMPTY_TOKENS(),
      costUsd: 0,
      requests: 0,
      turns: 0,
      userMessages: 0,
      toolCalls: 0,
      unpricedCalls: 0,
      models: new Map(),
      activity: false,
    }
    figuresList.push(figures)
    if (rangeFrom === null) {
      // All time: the summary totals are already exact, including sessions whose
      // events carry no timestamp.
      Object.assign(figures, {
        tokens: { ...summary.tokens },
        costUsd: summary.costUsd,
        requests: summary.requests,
        turns: summary.turns,
        userMessages: summary.userMessages,
        toolCalls: summary.toolCalls,
        unpricedCalls: summary.unpricedCalls,
        activity: true,
      })
      for (const [key, bucket] of summary.models) addModelBucket(figures.models, key, bucket)
    }

    for (const [day, bucket] of summary.days) {
      const time = Date.parse(day + 'T00:00:00')
      if (!Number.isFinite(time)) continue
      if (deltaWindows !== null) {
        const window =
          time >= deltaWindows.currentFrom && time < deltaWindows.to
            ? deltaCurrent
            : time >= deltaWindows.previousFrom && time < deltaWindows.currentFrom
              ? deltaPrevious
              : null
        if (window !== null) {
          addTokenViews(window.tokens, bucket.tokens)
          window.costUsd += bucket.costUsd
          window.requests += bucket.requests
        }
      }
      if (rangeFrom !== null && time < rangeFrom) continue
      let entry = dayTotals.get(day)
      if (entry === undefined) {
        entry = { requests: 0, costUsd: 0, tokens: EMPTY_TOKENS() }
        dayTotals.set(day, entry)
      }
      entry.requests += bucket.requests
      entry.costUsd += bucket.costUsd
      addTokenViews(entry.tokens, bucket.tokens)

      if (rangeFrom === null) continue
      figures.activity = true
      figures.requests += bucket.requests
      figures.turns += bucket.turns
      figures.userMessages += bucket.userMessages
      figures.toolCalls += bucket.toolCalls
      figures.costUsd += bucket.costUsd
      addTokenViews(figures.tokens, bucket.tokens)
      for (const [key, model] of bucket.models) {
        if (model.calls === 0) continue
        figures.unpricedCalls += model.unpricedCalls
        addModelBucket(figures.models, key, model)
        addModelBucket(rangeModelTotals, key, model)
      }
    }
  }

  const timeline = []
  const rangeTokens = EMPTY_TOKENS()
  let rangeCost = 0
  let rangeRequests = 0
  const pushDay = (day, bucket) => {
    timeline.push({
      day,
      input: bucket === undefined ? 0 : bucket.tokens.input,
      output: bucket === undefined ? 0 : bucket.tokens.output,
      cacheRead: bucket === undefined ? 0 : bucket.tokens.cacheRead,
      cacheWrite: bucket === undefined ? 0 : bucket.tokens.cacheWrite,
      total: bucket === undefined ? 0 : bucket.tokens.total,
      costUsd: bucket === undefined ? 0 : bucket.costUsd,
      requests: bucket === undefined ? 0 : bucket.requests,
    })
    if (bucket === undefined) return
    addTokenViews(rangeTokens, bucket.tokens)
    rangeCost += bucket.costUsd
    rangeRequests += bucket.requests
  }

  const sparse = [...dayTotals.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))
  // A day without usage is real information: emitting only active days would draw
  // a 20-day idle gap as wide as a one-day one, so every day in range is present.
  const denseFrom =
    rangeFrom !== null
      ? rangeFrom
      : sparse.length > 0
        ? startOfDay(Date.parse(sparse[0][0] + 'T00:00:00'))
        : startOfDay(now)
  const denseTo = startOfDay(now)
  const spanDays = Math.round((denseTo - denseFrom) / 86400000) + 1
  if (denseFrom > 0 && spanDays > 0 && spanDays <= MAX_TIMELINE_DAYS) {
    const byDay = new Map(sparse)
    const cursor = new Date(denseFrom)
    let guard = 0
    while (cursor.getTime() <= denseTo && guard < MAX_TIMELINE_DAYS) {
      const day = dayKey(cursor.getTime())
      pushDay(day, byDay.get(day))
      cursor.setDate(cursor.getDate() + 1)
      guard += 1
    }
  } else {
    for (const [day, bucket] of sparse) pushDay(day, bucket)
  }

  const models = [...(rangeFrom === null ? modelTotals : rangeModelTotals).entries()]
    .map(([key, entry]) => {
      const slash = key.indexOf('/')
      return {
        key,
        provider: slash === -1 ? key : key.slice(0, slash),
        model: slash === -1 ? key : key.slice(slash + 1),
        calls: entry.calls,
        tokens: tokenView(entry.tokens),
        costUsd: entry.costUsd,
        unpricedCalls: entry.unpricedCalls,
        priced: entry.unpricedCalls === 0,
      }
    })
    .sort((left, right) => right.tokens.total - left.tokens.total)

  const sessionViews = []
  for (let index = 0; index < all.length; index += 1) {
    const figures = figuresList[index]
    if (figures.activity) sessionViews.push({ summary: all[index], figures })
  }
  sessionViews.sort((left, right) => (right.summary.lastActivity ?? 0) - (left.summary.lastActivity ?? 0))
  let rangeSessionsWithUsage = 0
  for (const view of sessionViews) if (view.figures.requests > 0) rangeSessionsWithUsage += 1
  const sessions = sessionViews.slice(0, state.config.maxSessions).map(({ summary, figures }) => {
    const cacheBase = figures.tokens.input + figures.tokens.cacheRead
    return {
      id: summary.id,
      title: summary.title,
      cwd: summary.cwd,
      agentPreset: summary.agentPreset,
      origin: summary.origin,
      parentSession: summary.parentSession,
      live: liveIds.has(summary.id),
      createdAt: summary.createdAt,
      firstActivity: summary.firstActivity,
      lastActivity: summary.lastActivity,
      // Range-scoped, so every number in the table follows the range control.
      turns: figures.turns,
      requests: figures.requests,
      userMessages: figures.userMessages,
      toolCalls: figures.toolCalls,
      tokens: tokenView(figures.tokens),
      costUsd: figures.costUsd,
      cacheHitRate: cacheBase > 0 ? figures.tokens.cacheRead / cacheBase : 0,
      models: [...figures.models.entries()].sort((left, right) => right[1].tokens.total - left[1].tokens.total).map(([key]) => key),
      priced: figures.unpricedCalls === 0,
      // The session's whole life, for the detail panel's reference line.
      allTime: {
        tokens: tokenView(summary.tokens),
        costUsd: summary.costUsd,
        requests: summary.requests,
        turns: summary.turns,
        userMessages: summary.userMessages,
        toolCalls: summary.toolCalls,
      },
    }
  })

  const scan = {
    state: state.scanning ? 'scanning' : 'idle',
    total: state.scanTotal,
    scanned: state.scanScanned,
    startedAt: state.scanStartedAt,
    finishedAt: state.scanFinishedAt,
    elapsedMs: state.scanElapsedMs,
    failed: state.scanUnreadable,
    readMs: state.scanReadMs,
    migrated: state.scanMigrated,
    restored: state.cacheRestored,
    cache: {
      enabled: state.cacheFile !== null,
      file: state.cacheFile,
      savedAt: state.cacheSavedAt,
      loadedAt: state.cacheLoadedAt,
      note: state.cacheNote,
      error: state.cacheError,
    },
    lastError: state.scanError,
  }

  return {
    version: 3,
    revision: state.revision,
    generatedAt: now,
    scan,
    totals: {
      ...totals,
      tokens: tokenView(totals.tokens),
      firstActivity: totals.firstActivity,
      lastActivity: totals.lastActivity,
    },
    range: {
      days,
      from: rangeFrom,
      to: now,
      tokens: tokenView(rangeTokens),
      costUsd: rangeCost,
      requests: rangeRequests,
      sessions: sessionViews.length,
      sessionsWithUsage: rangeSessionsWithUsage,
      timeline,
      models,
      delta:
        deltaWindows === null
          ? null
          : {
              days: deltaWindows.days,
              current: {
                tokens: tokenView(deltaCurrent.tokens),
                costUsd: deltaCurrent.costUsd,
                requests: deltaCurrent.requests,
              },
              previous: {
                tokens: tokenView(deltaPrevious.tokens),
                costUsd: deltaPrevious.costUsd,
                requests: deltaPrevious.requests,
              },
            },
    },
    sessions,
    prices: {
      currency: 'USD',
      unit: 'per 1M tokens',
      fallback: state.config.fallback,
      models: state.config.prices,
    },
  }
}

// ── HTTP routes ────────────────────────────────────────────────────────────

/** Answer only loopback callers: the panel is same-origin on this machine. */
function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress
  if (typeof address !== 'string') return false
  const withoutMapped = address.startsWith('::ffff:') ? address.slice(7) : address
  const withoutZone = withoutMapped.split('%')[0]
  if (!(withoutZone === '::1' || withoutZone === '127.0.0.1' || withoutZone.startsWith('127.'))) return false
  // A loopback peer is not sufficient on its own: a page on a rebinding domain also
  // connects to 127.0.0.1. The Host header, and a present Origin, must be loopback too.
  return isLoopbackHostText(req.headers.host) && isLoopbackOriginHeader(req.headers.origin)
}

/** True for a `host[:port]` value naming this machine's loopback interface. */
function isLoopbackHostText(value) {
  if (typeof value !== 'string' || value === '') return false
  const raw = value.startsWith('[') ? value.slice(1, value.indexOf(']')) : value.split(':')[0]
  const host = raw.toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  // A literal IPv4 in 127/8 only: a bindable name such as `127.0.0.1.attacker.com`
  // also begins with "127." and would otherwise let a rebinding page through.
  const parts = host.split('.')
  if (parts.length !== 4) return false
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false
  return parts[0] === '127'
}

/** An absent Origin is a non-browser client; a present one must be loopback. */
function isLoopbackOriginHeader(value) {
  if (value === undefined) return true
  if (typeof value !== 'string') return false
  try {
    return isLoopbackHostText(new URL(value).host)
  } catch (_error) {
    return false
  }
}

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

/** Parse `?days=` into a supported range; `0` means all time. */
function readDays(url) {
  const raw = url.searchParams.get('days')
  if (raw === null || raw === '') return 7
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return 7
  if (value <= 0) return 0
  return Math.min(3650, value)
}

/**
 * Re-enumerate the store when the panel has been quiet for a while, so a
 * session started in another window shows up without a manual refresh.
 */
function refreshIfStale(ctx, state) {
  if (state.scanning || state.listing) return
  const now = Date.now()
  if (now - state.lastListAt < state.config.listIntervalMs) return
  state.listing = true
  state.lastListAt = now
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    state.listing = false
    return
  }
  persistence
    .list()
    .then((snapshots) => {
      const liveIds = new Set(ctx.sessions.list().map((session) => String(session.id)))
      const changed = snapshots.some((snapshot) => {
        const id = String(snapshot.header.id)
        if (liveIds.has(id)) return false
        return !isFresh(state.stored.get(id), snapshot)
      })
      const present = new Set(snapshots.map((snapshot) => String(snapshot.header.id)))
      const removed = [...state.stored.keys()].some((id) => !present.has(id))
      if (changed || removed) void scanStored(ctx, state)
    })
    .catch(() => {
      /* a failed enumeration is retried on the next interval */
    })
    .finally(() => {
      state.listing = false
    })
}

/** Answer a bodyless HEAD. */
function sendHead(res) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end()
}

/** The cheap poll projects the full payload down to what a poll needs. */
function liveOf(full) {
  return {
    version: full.version,
    revision: full.revision,
    generatedAt: full.generatedAt,
    scan: full.scan,
    totals: full.totals,
  }
}

/**
 * Build a read route: gate the caller, warm the cache, kick the first scan, and
 * answer whatever `produce` returns for this request's URL.
 */
function readRoute(ctx, state, path, produce) {
  return async (req, res) => {
    if (!isLoopbackRequest(req)) {
      sendError(res, 403, 'forbidden', 'usage-stats is only reachable from this machine')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, 'method-not-allowed', 'GET required')
      return
    }
    try {
      const url = new URL(req.url ?? path, 'http://localhost')
      await state.cacheReady
      if (state.scanFinishedAt === null && !state.scanning) void scanStored(ctx, state)
      else refreshIfStale(ctx, state)
      const body = produce(url)
      if (req.method === 'HEAD') sendHead(res)
      else sendJson(res, 200, body)
    } catch (error) {
      sendError(res, 500, 'internal-error', error instanceof Error ? error.message : String(error))
    }
  }
}

/**
 * Activate the Host half: price resolver and the three loopback routes. The
 * first read request starts the first scan lazily, so a profile that never opens
 * the panel pays nothing.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const state = createState(resolved)
  state.priceFor = makePriceResolver(resolved.prices, resolved.fallback)
  // Restoring before the first request is what makes a restart paint instantly.
  state.cacheReady = loadCache(state)

  ctx.effect(
    () => () => {
      // Flush the most recent fold on reload; skip it before the first scan so an
      // empty instance cannot replace a populated cache.
      if (state.scanFinishedAt !== null) void saveCache(state)
    },
    'usage-stats: cache',
  )

  const fullHandler = readRoute(ctx, state, ROUTE_FULL, (url) => buildAggregate(ctx, state, readDays(url)))
  const liveHandler = readRoute(ctx, state, ROUTE_LIVE, (url) => liveOf(buildAggregate(ctx, state, readDays(url))))
  const refreshHandler = async (req, res) => {
    if (!isLoopbackRequest(req)) {
      sendError(res, 403, 'forbidden', 'usage-stats is only reachable from this machine')
      return
    }
    if (req.method !== 'POST') {
      sendError(res, 405, 'method-not-allowed', 'POST required')
      return
    }
    if (state.scanning) {
      sendJson(res, 200, { started: false, alreadyRunning: true })
      return
    }
    sendJson(res, 202, { started: true })
    void scanStored(ctx, state)
  }

  for (const [routePath, handler] of [
    [ROUTE_FULL, fullHandler],
    [ROUTE_LIVE, liveHandler],
    [ROUTE_REFRESH, refreshHandler],
  ]) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: routePath, handler }), 'usage-stats: ' + routePath)
  }
}

/** Merge the user's patch-row config over the defaults. */
function resolveConfig(config) {
  const input = config !== null && typeof config === 'object' ? config : {}
  const userPrices = input.prices !== null && typeof input.prices === 'object' ? input.prices : {}
  // Merge per field, so a row that only overrides `input` keeps the other rates.
  const prices = {}
  for (const [key, rate] of Object.entries(DEFAULT_PRICES)) {
    const override = userPrices[key]
    prices[key] = { ...rate, ...(override !== null && typeof override === 'object' ? override : {}) }
  }
  for (const [key, rate] of Object.entries(userPrices)) {
    if (prices[key] === undefined && rate !== null && typeof rate === 'object') {
      prices[key] = { ...DEFAULT_FALLBACK_PRICE, ...rate }
    }
  }
  const merged = { ...DEFAULTS, ...input, prices, fallback: { ...DEFAULT_FALLBACK_PRICE, ...input.fallback } }
  for (const key of ['listIntervalMs', 'readConcurrency', 'readTimeoutMs', 'maxScanMs', 'maxSessions']) {
    merged[key] = clampInt(input[key], DEFAULTS[key], CLAMP[key][0], CLAMP[key][1])
  }
  return merged
}

/** Services this Host half needs before it activates. */
export const inject = ['webServer', 'sessions', 'sessionPersistence']


