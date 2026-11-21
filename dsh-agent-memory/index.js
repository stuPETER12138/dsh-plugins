/**
 * Host half of `@local/dsh-agent-memory` — on-demand long-term memory.
 *
 * Two things live on disk, both human-owned:
 *
 *   core.md        standing profile, one prose block, included first
 *   records.jsonl  one JSON record per line, each tagged kind × subject
 *
 * Nothing is injected by default. `/memory <query>` retrieves the records that
 * answer the query and stages them; the next request assembly delivers them as
 * a dynamic prompt context, then the stage is consumed. `/memory clear` drops a
 * pending stage. This keeps the prompt prefix stable: no memory text ever
 * enters the system prompt, so a memory edit cannot invalidate the cache.
 *
 * The panel reads and writes the same store over one loopback route, and gets
 * two derived lists: near-duplicate merge proposals and possible contradictions
 * (same kind and subject, similar but not identical text) that a human has to
 * settle.
 *
 * Classification is deliberately two orthogonal axes rather than folders:
 *   kind     semantic | episodic | procedural   (what kind of claim this is)
 *   subject  me | machine | project              (whose fact it is)
 * A fact can be both a preference and an environment detail; tagging it once
 * with both axes avoids the duplicate copies a folder split would create.
 *
 * @module @local/dsh-agent-memory
 */

import { readFileSync, statSync } from 'node:fs'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Route the panel reads and writes. */
const ROUTE = '/dsh-agent-memory'
/** Dynamic prompt context that carries a staged retrieval. */
const CONTEXT_NAME = 'plugin:agent-memory'
/** Late placement: after first-party guidance and environment facts. */
const CONTEXT_ORDER = 10150
/** Character cap for the core block and for one record. */
const DEFAULT_MAX_CHARS = 8000
/** Records considered for one retrieval. */
const RETRIEVAL_LIMIT = 6
/** Character budget of the injected record list. */
const RETRIEVAL_BUDGET = 1200
/** Above this Jaccard similarity two records are treated as the same fact. */
const MERGE_THRESHOLD = 0.8
/**
 * Above this, two records are worth a human look. Lexical similarity cannot
 * separate "same fact, different words" from "contradiction", so the second
 * band only claims to be suspicious.
 */
const CONFLICT_THRESHOLD = 0.42
/** Pair scan is quadratic; stop proposing on very large stores. */
const PROPOSAL_SCAN_MAX = 600
/** Proposals returned to the panel at once. */
const PROPOSAL_LIMIT = 20
/** A save request larger than this is refused unread. */
const MAX_BODY_BYTES = 512 * 1024

const KINDS = ['semantic', 'episodic', 'procedural']
const SUBJECTS = ['me', 'machine', 'project']

const isObject = (value) => value !== null && typeof value === 'object'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** The Harness home: the profile directory's grandparent, or the default. */
function dshHome() {
  const profileDir = process.env.DSH_PROFILE_DIR
  const home =
    process.env.DSH_HOME ||
    // The profile directory is `<home>/profiles/<name>`.
    (profileDir ? path.dirname(path.dirname(profileDir)) : '') ||
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  return path.isAbsolute(home) ? home : null
}

// ── text ───────────────────────────────────────────────────────────────────

/**
 * Split text into comparable terms: ASCII words and CJK character bigrams.
 * Bigrams are what makes Chinese substring matching useful without a segmenter.
 *
 * @param {string} text - any text.
 * @returns {string[]} lowercase terms, duplicates kept for term frequency.
 */
function tokenize(text) {
  const terms = []
  const lower = text.toLowerCase()
  for (const word of lower.match(/[a-z0-9][a-z0-9_.\\/-]*/g) ?? []) terms.push(word)
  const cjk = lower.match(/[\u3400-\u9fff]+/g) ?? []
  for (const run of cjk) {
    if (run.length === 1) terms.push(run)
    for (let i = 0; i + 1 < run.length; i += 1) terms.push(run.slice(i, i + 2))
  }
  return terms
}

/** Jaccard similarity of two term sets; 0 when either is empty. */
function similarity(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  for (const term of small) if (large.has(term)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** `YYYY-MM-DD` for a local timestamp. */
function dayKey(time) {
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

const round = (value) => Math.round(value * 1000) / 1000

// ── http helpers ───────────────────────────────────────────────────────────

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
  const parts = host.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Answer only loopback callers, including the `Host` and `Origin` checks. */
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

/** A bounded JSON request body; anything larger or malformed rejects. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body is larger than ' + MAX_BODY_BYTES + ' bytes'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (_error) {
        reject(new Error('request body is not valid JSON'))
      }
    })
    req.on('error', (error) => reject(error))
  })
}

// ── store ──────────────────────────────────────────────────────────────────

/**
 * Coerce one stored line into the current record shape, dropping what cannot be
 * rendered. Records written by hand in an editor go through this too.
 *
 * @param {unknown} value - one parsed line.
 * @returns {object|null} the normalized record, or `null` to drop it.
 */
function normalizeRecord(value) {
  if (!isObject(value)) return null
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  if (text === '') return null
  const created = Number.isFinite(value.createdAt) ? value.createdAt : Date.now()
  return {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : 'r_' + created.toString(36) + Math.random().toString(36).slice(2, 6),
    kind: KINDS.includes(value.kind) ? value.kind : 'semantic',
    subject: SUBJECTS.includes(value.subject) ? value.subject : 'me',
    text,
    probe: typeof value.probe === 'string' && value.probe.trim() !== '' ? value.probe.trim() : null,
    source: typeof value.source === 'string' && value.source !== '' ? value.source : 'manual',
    importance: Number.isFinite(value.importance) ? Math.min(5, Math.max(1, Math.trunc(value.importance))) : 3,
    usable: value.usable !== false,
    createdAt: created,
    lastUsedAt: Number.isFinite(value.lastUsedAt) ? value.lastUsedAt : null,
    useCount: Number.isFinite(value.useCount) ? Math.max(0, Math.trunc(value.useCount)) : 0,
    mergedFrom: Array.isArray(value.mergedFrom) ? value.mergedFrom.filter((id) => typeof id === 'string') : [],
  }
}

/** Public view of a record, with its term set kept out of the payload. */
function publicRecord(record) {
  return {
    id: record.id,
    kind: record.kind,
    subject: record.subject,
    text: record.text,
    probe: record.probe,
    importance: record.importance,
    usable: record.usable,
    createdAt: record.createdAt,
    day: dayKey(record.createdAt),
    lastUsedAt: record.lastUsedAt,
    useCount: record.useCount,
    mergedFrom: record.mergedFrom,
  }
}

/**
 * Read one file with an mtime/size cache; absent or unreadable reads as empty.
 *
 * @param {{cache: Map<string, object>}} state - plugin state.
 * @param {string} file - absolute path.
 * @returns {string} file text.
 */
function readText(state, file) {
  const cached = state.textCache.get(file)
  let info
  try {
    info = statSync(file)
  } catch (_error) {
    state.textCache.set(file, { text: '', mtimeMs: 0, size: -1 })
    return ''
  }
  if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.text
  try {
    const text = readFileSync(file, 'utf8')
    state.textCache.set(file, { text, mtimeMs: info.mtimeMs, size: info.size })
    return text
  } catch (_error) {
    return cached?.text ?? ''
  }
}

/** Load and normalize `records.jsonl`, reusing the parse while the file is unchanged. */
function loadRecords(state) {
  const raw = readText(state, state.recordsFile)
  const stamp = state.textCache.get(state.recordsFile)
  const signature = (stamp?.mtimeMs ?? 0) + ':' + (stamp?.size ?? -1)
  if (state.recordsSignature === signature) return state.records
  const records = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('//')) continue
    try {
      const record = normalizeRecord(JSON.parse(trimmed))
      if (record !== null) records.push(record)
    } catch (_error) {
      /* one broken hand-edited line must not hide the rest of the store */
    }
  }
  state.records = records
  state.recordsSignature = signature
  state.index = buildIndex(records)
  return records
}

/** Dismissed proposal pairs, stored as a sorted `a|b` list. */
function loadDismissed(state) {
  const raw = readText(state, state.dismissedFile)
  const stamp = state.textCache.get(state.dismissedFile)
  const signature = (stamp?.mtimeMs ?? 0) + ':' + (stamp?.size ?? -1)
  if (state.dismissedSignature === signature) return state.dismissed
  const set = new Set()
  try {
    const parsed = JSON.parse(raw === '' ? '[]' : raw)
    if (Array.isArray(parsed)) for (const key of parsed) if (typeof key === 'string') set.add(key)
  } catch (_error) {
    /* a corrupt dismissal list only means old proposals reappear */
  }
  state.dismissed = set
  state.dismissedSignature = signature
  return set
}

/** Stable pair key, order-independent. */
function pairKey(left, right) {
  return left < right ? left + '|' + right : right + '|' + left
}

/** Atomic whole-file write: temp file in the same directory, then rename. */
async function writeAtomic(file, text) {
  const temporary = file + '.' + process.pid + '-' + Date.now() + '.tmp'
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

/** Serialize records back to JSONL, one record per line. */
function serializeRecords(records) {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n'
}

// ── retrieval ──────────────────────────────────────────────────────────────

/**
 * Inverted index over record text plus kind and subject, with the statistics
 * BM25 needs. Rebuilt whenever the store changes; a few thousand records is
 * well under a millisecond to index.
 *
 * @param {object[]} records - normalized records.
 * @returns {object} index.
 */
function buildIndex(records) {
  const postings = new Map() // term -> Map(recordId -> tf)
  const lengths = new Map() // recordId -> document length
  const terms = new Map() // recordId -> Set(term) for similarity
  let total = 0
  for (const record of records) {
    if (!record.usable) continue
    const tokens = tokenize([record.text, record.kind, record.subject, record.probe ?? ''].join(' '))
    const counts = new Map()
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    for (const [term, count] of counts) {
      let posting = postings.get(term)
      if (posting === undefined) {
        posting = new Map()
        postings.set(term, posting)
      }
      posting.set(record.id, count)
    }
    lengths.set(record.id, tokens.length)
    terms.set(record.id, new Set(counts.keys()))
    total += tokens.length
  }
  return { postings, lengths, terms, count: lengths.size, average: lengths.size === 0 ? 0 : total / lengths.size }
}

/**
 * Score records against a query with BM25, then blend importance and freshness.
 *
 * @param {object[]} records - normalized records.
 * @param {object} index - from {@link buildIndex}.
 * @param {string} query - free text.
 * @returns {Array<{record: object, score: number}>} descending, only positive hits.
 */
function search(records, index, query) {
  const queryTerms = [...new Set(tokenize(query))]
  if (queryTerms.length === 0 || index.count === 0) return []
  const k1 = 1.2
  const b = 0.75
  const scores = new Map()
  for (const term of queryTerms) {
    const posting = index.postings.get(term)
    if (posting === undefined) continue
    const df = posting.size
    const idf = Math.log(1 + (index.count - df + 0.5) / (df + 0.5))
    for (const [id, tf] of posting) {
      const length = index.lengths.get(id) ?? 0
      const norm = 1 - b + b * (length / (index.average || 1))
      const value = idf * ((tf * (k1 + 1)) / (tf + k1 * norm))
      scores.set(id, (scores.get(id) ?? 0) + value)
    }
  }
  const now = Date.now()
  const byId = new Map(records.map((record) => [record.id, record]))
  const ranked = []
  let best = 0
  for (const [id, raw] of scores) if (raw > best) best = raw
  for (const [id, raw] of scores) {
    const record = byId.get(id)
    if (record === undefined || !record.usable) continue
    const relevance = best === 0 ? 0 : raw / best
    const ageDays = Math.max(0, (now - record.createdAt) / 86_400_000)
    const freshness = Math.exp(-ageDays / 90)
    const value = 0.6 * relevance + 0.25 * (record.importance / 5) + 0.15 * freshness
    ranked.push({ record, score: value })
  }
  ranked.sort((left, right) => right.score - left.score)
  return ranked
}

/** One line for the model: text, provenance, and how to re-verify it. */
function renderRecordLine(record) {
  const probe = record.probe === null ? '' : '（可用 `' + record.probe + '` 确认）'
  return '- [' + record.kind + ' · ' + record.subject + ' · ' + dayKey(record.createdAt) + '] ' + record.text + probe
}

/**
 * Build the block a `/memory` command stages.
 *
 * @param {object} state - plugin state.
 * @param {string} query - what the user asked to recall.
 * @returns {{text: string, count: number}} the block and how many records it has.
 */
function buildMemoryBlock(state, query) {
  const records = loadRecords(state)
  const core = readText(state, state.coreFile).trim()
  const ranked = search(records, state.index, query)
  const picked = []
  let budget = RETRIEVAL_BUDGET
  for (const { record } of ranked) {
    if (picked.length >= RETRIEVAL_LIMIT) break
    const line = renderRecordLine(record)
    if (line.length > budget && picked.length > 0) continue
    picked.push(record)
    budget -= line.length
  }
  const blocks = ['## 用户长期记忆（由用户主动调取，不是当前指令）', '与当前对话冲突时，以当前对话为准。']
  if (core !== '') blocks.push('### 常驻画像\n\n' + core)
  if (picked.length > 0) blocks.push('### 与「' + query + '」相关的记录\n\n' + picked.map(renderRecordLine).join('\n'))
  if (core === '' && picked.length === 0) blocks.push('（记忆库里没有与这条查询相关的内容。）')
  const now = Date.now()
  for (const record of picked) {
    record.lastUsedAt = now
    record.useCount += 1
  }
  if (picked.length > 0) void persistRecords(state).catch(() => {})
  return { text: blocks.join('\n\n'), count: picked.length }
}

/** Write the current records back to disk and refresh the cache stamp. */
async function persistRecords(state) {
  await writeAtomic(state.recordsFile, serializeRecords(state.records))
  const info = statSync(state.recordsFile)
  state.recordsSignature = info.mtimeMs + ':' + info.size
  state.textCache.set(state.recordsFile, { text: serializeRecords(state.records), mtimeMs: info.mtimeMs, size: info.size })
  state.index = buildIndex(state.records)
}

// ── proposals ──────────────────────────────────────────────────────────────

/**
 * Derive the two review queues from the store: near-duplicates worth merging,
 * and similar-but-different pairs a human should look at.
 *
 * @param {object} state - plugin state.
 * @returns {{proposals: object[], truncated: boolean}} derived pairs.
 */
function buildProposals(state) {
  const records = loadRecords(state).filter((record) => record.usable)
  if (records.length > PROPOSAL_SCAN_MAX) return { proposals: [], truncated: true }
  const dismissed = loadDismissed(state)
  // Similarity is computed on record text alone: kind and subject are equal by
  // construction within a pair, so including them would only pad every score.
  const terms = new Map()
  for (const record of records) terms.set(record.id, recordTerms(record))
  const proposals = []
  for (let i = 0; i < records.length && proposals.length < PROPOSAL_LIMIT; i += 1) {
    for (let j = i + 1; j < records.length && proposals.length < PROPOSAL_LIMIT; j += 1) {
      const left = records[i]
      const right = records[j]
      if (left.kind !== right.kind || left.subject !== right.subject) continue
      if (dismissed.has(pairKey(left.id, right.id))) continue
      const overlap = similarity(terms.get(left.id), terms.get(right.id))
      if (overlap < CONFLICT_THRESHOLD) continue
      proposals.push({
        type: overlap >= MERGE_THRESHOLD ? 'merge' : 'conflict',
        similarity: round(overlap),
        a: publicRecord(left),
        b: publicRecord(right),
      })
    }
  }
  return { proposals, truncated: false }
}

/** Term set of one record's text, for similarity scoring. */
function recordTerms(record) {
  return new Set(tokenize(record.text))
}

// ── plugin ─────────────────────────────────────────────────────────────────

/** Services this Host half needs before it activates. */
export const inject = ['webServer', 'systemPrompt']

/**
 * Mount the panel route, the prompt context, and the `/memory` command.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {unknown} config - the row's config.
 */
export function apply(ctx, config) {
  const input = isObject(config) ? config : {}
  const configured = typeof input.dir === 'string' ? input.dir.trim() : ''
  const home = dshHome()
  const dir =
    configured !== ''
      ? path.resolve(configured)
      : home === null
        ? path.join(process.cwd(), '.dsh-agent-memory')
        : path.join(home, 'agent-memory')
  const parsed = Number.parseInt(input.maxChars ?? '', 10)
  const maxChars = Number.isFinite(parsed) && parsed > 0 ? Math.min(50_000, Math.max(500, parsed)) : DEFAULT_MAX_CHARS

  const state = {
    dir,
    maxChars,
    coreFile: path.join(dir, 'core.md'),
    recordsFile: path.join(dir, 'records.jsonl'),
    dismissedFile: path.join(dir, 'dismissed.json'),
    textCache: new Map(),
    records: [],
    recordsSignature: null,
    dismissed: new Set(),
    dismissedSignature: null,
    index: { postings: new Map(), lengths: new Map(), terms: new Map(), count: 0, average: 0 },
    staged: new Map(), // session id -> { text, count, at, delivered }
  }
  const ready = mkdir(dir, { recursive: true }).catch(() => {})

  /** Session key for staging: the agent's session when the loop supplies one. */
  const sessionOf = (context) => {
    const id = context?.agent?.session?.id
    return typeof id === 'string' && id !== '' ? id : 'default'
  }

  const statusText = () => {
    const records = loadRecords(state)
    const usable = records.filter((record) => record.usable).length
    return '记忆库：' + usable + ' 条记录，' + (readText(state, state.coreFile).trim() === '' ? '无' : '有') +
      '常驻画像。用法：/memory <要回忆的内容>；/memory clear 清空已注入的内容。'
  }

  const stage = (sessionId, block) => {
    state.staged.set(sessionId, { text: block.text, count: block.count, at: Date.now(), delivered: false })
  }

  // Panel route.
  const handler = async (req, res) => {
    if (!isLoopback(req)) {
      sendError(res, 403, 'forbidden', 'agent memory is only reachable from this machine')
      return
    }

    if (req.method === 'GET') {
      await ready
      loadRecords(state)
      const coreEntry = readText(state, state.coreFile)
      const proposals = buildProposals(state)
      sendJson(res, 200, {
        ok: true,
        dir: state.dir,
        maxChars: state.maxChars,
        kinds: KINDS,
        subjects: SUBJECTS,
        core: { text: coreEntry, updatedAt: state.textCache.get(state.coreFile)?.mtimeMs ?? null },
        records: loadRecords(state).map(publicRecord),
        proposals: proposals.proposals,
        proposalsTruncated: proposals.truncated,
        staged: [...state.staged.entries()].map(([session, entry]) => ({
          session,
          count: entry.count,
          at: entry.at,
          delivered: entry.delivered,
        })),
      })
      return
    }

    if (req.method !== 'POST') {
      sendError(res, 405, 'method-not-allowed', 'GET or POST required')
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendError(res, 400, 'invalid-body', messageOf(error))
      return
    }
    if (!isObject(body) || typeof body.action !== 'string') {
      sendError(res, 400, 'invalid-body', 'action is required')
      return
    }
    await ready

    try {
      const result = await mutate(state, body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (error) {
      const code = error?.code ?? 'internal-error'
      sendError(res, 400, code, messageOf(error))
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }), 'agent-memory: route')

  // Staged retrieval reaches the model as dynamic context, after history, so
  // the system prompt and its cache are never touched by a memory edit.
  ctx.effect(
    () =>
      ctx.systemPrompt.context({
        name: CONTEXT_NAME,
        order: CONTEXT_ORDER,
        interpolate: false,
        text: (assembly) => {
          const entry = state.staged.get(sessionOf(assembly))
          if (entry === undefined || entry.delivered) return ''
          // One delivery: the block is a response to one explicit request.
          entry.delivered = true
          return entry.text
        },
      }),
    'agent-memory: prompt context',
  )

  // The human-facing command runs directly against the current agent.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'memory',
      description: 'Recall long-term memory into the next request',
      input: { hint: '<query> | clear' },
      handler: ({ agent, rawInput }) => {
        const query = rawInput.trim()
        const sessionId = typeof agent?.session?.id === 'string' ? agent.session.id : 'default'
        if (query === '') return { kind: 'success', text: statusText() }
        if (query === 'clear' || query === '清空') {
          state.staged.delete(sessionId)
          return { kind: 'success', text: '已清空注入内容。' }
        }
        try {
          const block = buildMemoryBlock(state, query)
          stage(sessionId, block)
          return {
            kind: 'success',
            text: '已调取 ' + block.count + ' 条记录，下一条消息会带上它们。',
          }
        } catch (error) {
          return { kind: 'error', text: '记忆检索失败：' + messageOf(error) }
        }
      },
    })
  })
}

/**
 * Apply one panel mutation. Every branch validates its input and returns the
 * fresh derived lists so the panel never has to guess what changed.
 *
 * @param {object} state - plugin state.
 * @param {object} body - the request body.
 * @returns {Promise<object>} fields merged into the response.
 */
async function mutate(state, body) {
  const records = loadRecords(state)

  if (body.action === 'core.set') {
    const text = typeof body.text === 'string' ? body.text : ''
    if (text.length > state.maxChars) throw fail('too-long', 'core text is longer than ' + state.maxChars + ' characters')
    await writeAtomic(state.coreFile, text)
    const info = statSync(state.coreFile)
    state.textCache.set(state.coreFile, { text, mtimeMs: info.mtimeMs, size: info.size })
    return { core: { text, updatedAt: info.mtimeMs } }
  }

  if (body.action === 'record.create') {
    const text = typeof body.record?.text === 'string' ? body.record.text.trim() : ''
    if (text === '') throw fail('empty-text', 'record text is empty')
    if (text.length > state.maxChars) throw fail('too-long', 'record text is longer than ' + state.maxChars + ' characters')
    const record = normalizeRecord({
      ...body.record,
      text,
      source: 'manual',
      createdAt: Date.now(),
    })
    records.push(record)
    await persistRecords(state)
    return { records: records.map(publicRecord) }
  }

  if (body.action === 'record.update') {
    const record = records.find((item) => item.id === body.id)
    if (record === undefined) throw fail('unknown-record', 'no record with that id')
    if (isObject(body.patch)) {
      if (typeof body.patch.text === 'string') {
        const text = body.patch.text.trim()
        if (text === '') throw fail('empty-text', 'record text is empty')
        // Validate before mutating, so a rejected update leaves the record as is.
        if (text.length > state.maxChars) throw fail('too-long', 'record text is longer than ' + state.maxChars)
        record.text = text
      }
      if (KINDS.includes(body.patch.kind)) record.kind = body.patch.kind
      if (SUBJECTS.includes(body.patch.subject)) record.subject = body.patch.subject
      if (typeof body.patch.probe === 'string') record.probe = body.patch.probe.trim() === '' ? null : body.patch.probe.trim()
      if (Number.isFinite(body.patch.importance)) {
        record.importance = Math.min(5, Math.max(1, Math.trunc(body.patch.importance)))
      }
      if (typeof body.patch.usable === 'boolean') record.usable = body.patch.usable
    }
    await persistRecords(state)
    return { records: records.map(publicRecord) }
  }

  if (body.action === 'record.delete') {
    const index = records.findIndex((item) => item.id === body.id)
    if (index === -1) throw fail('unknown-record', 'no record with that id')
    records.splice(index, 1)
    await persistRecords(state)
    return { records: records.map(publicRecord) }
  }

  if (body.action === 'proposal.merge') {
    const left = records.find((item) => item.id === body.a)
    const right = records.find((item) => item.id === body.b)
    if (left === undefined || right === undefined) throw fail('unknown-record', 'both records are required')
    const keep = left.text.length >= right.text.length ? left : right
    const drop = keep === left ? right : left
    keep.mergedFrom = [...new Set([...keep.mergedFrom, drop.id, ...drop.mergedFrom])]
    keep.importance = Math.max(keep.importance, drop.importance)
    keep.probe = keep.probe ?? drop.probe
    keep.createdAt = Math.min(keep.createdAt, drop.createdAt)
    keep.useCount += drop.useCount
    records.splice(records.indexOf(drop), 1)
    await persistRecords(state)
    return { records: records.map(publicRecord) }
  }

  if (body.action === 'proposal.dismiss') {
    if (typeof body.a !== 'string' || typeof body.b !== 'string') throw fail('invalid-body', 'both ids are required')
    const dismissed = loadDismissed(state)
    dismissed.add(pairKey(body.a, body.b))
    const text = JSON.stringify([...dismissed].sort()) + '\n'
    await writeAtomic(state.dismissedFile, text)
    const info = statSync(state.dismissedFile)
    state.dismissedSignature = info.mtimeMs + ':' + info.size
    state.textCache.set(state.dismissedFile, { text, mtimeMs: info.mtimeMs, size: info.size })
    return {}
  }

  throw fail('unknown-action', 'unsupported action: ' + body.action)
}

/** An error carrying a machine-readable code for the panel. */
function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
