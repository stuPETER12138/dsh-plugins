/**
 * Session share — transcript folder.
 *
 * Pure host-side module: no `node:` imports, no I/O, no clock, no randomness.
 * It turns the raw event log of one DSH session into the small, stable payload
 * the browser half renders and the user picks from when sharing a conversation
 * as Markdown, an image, or a PDF.
 *
 * The event vocabulary is the one written by `@deepseek-ai/dsh-session`
 * (confirmed against live `session.v4.jsonl(.zstd)` logs; see
 * `notes/transcript.md`):
 *
 *   user/message       surface event, `data.content` = text/image parts
 *   assistant/message  surface event, `data.message.content` = reasoning |
 *                      text | tool-call parts, `data.message.source` = provider
 *                      and model
 *   tool/call          `data.callId`, `data.name`, `data.arguments` (JSON string)
 *   tool/result        `data.message.toolCallId`, `data.message.isError`
 *   session/title      `data.title` (last one wins)
 *
 * Surface events are append-only in the log, but a `replace` `surfaceOp` node
 * is a model-only copy: `dsh-session` itself documents that replacement copies
 * are the wrong source for a human transcript, so this module keeps only
 * append-origin surface events (see `isAppendSurfaceEvent` in
 * `@deepseek-ai/dsh-session/lib/index.js`).
 *
 * @module @local/dsh-session-share/transcript
 */

/** Exact session event types this module understands. */
export const EVENT_TYPES = {
  user: 'user/message',
  assistant: 'assistant/message',
  toolCall: 'tool/call',
  toolResult: 'tool/result',
  title: 'session/title',
}

/** `source.kind` values that identify a real human prompt. */
const DEFAULT_USER_SOURCE_KINDS = ['user']

/** Tool titles longer than this are clipped in the share payload. */
const DEFAULT_TOOL_TITLE_MAX = 120

/** Tool details longer than this are clipped in the share payload. */
const DEFAULT_TOOL_DETAIL_MAX = 240

/** Ordered `arguments` fields used to describe a tool call in one short line. */
const TOOL_TITLE_FIELDS = [
  'description',
  'file_path',
  'pattern',
  'path',
  'url',
  'task_id',
  'job_id',
  'agent_id',
  'target',
  'name',
  'title',
  'command',
  'query',
]

/**
 * Fold one session header and its events into a share payload.
 *
 * @param {object|null|undefined} header - the session header
 *   (`{ id, createdAt, cwd, title?, ... }`; the durable header line of the log).
 * @param {Array<object>|null|undefined} events - session events in log order,
 *   each `{ seq, time, type, data }`. Extra fields such as `surfaceOp` are used
 *   when present.
 * @param {object} [options] - fold options.
 * @param {boolean} [options.includeTools=true] - emit one grouped `tool` item
 *   per run of tool calls.
 * @param {string[]} [options.userSourceKinds=['user']] - `user/message`
 *   `source.kind` values treated as human prompts. Injected context
 *   (`runtime-context`, `skill-catalog`, `time-context`, `agent-message`,
 *   `subagent-settled`, `compact-checkpoint`, ...) is skipped by default.
 * @param {number} [options.maxTextChars=0] - clip each item's text to this many
 *   characters (0 or absent = no clip). The Host route passes 200_000.
 * @param {number} [options.toolTitleMax=120] - clip tool titles.
 * @param {number} [options.toolDetailMax=240] - clip tool details.
 * @returns {{session: {id: string, title: string, cwd: string|null,
 *   createdAt: number|null, updatedAt: number|null, model: string|null,
 *   provider?: string}, items: Array<object>}}
 */
export function assembleTranscript(header, events, options = {}) {
  const opts = normalizeOptions(options)
  const sessionHeader = isPlainObject(header) ? header : {}
  const list = Array.isArray(events) ? events : []

  const toolStatus = collectToolStatuses(list)
  const items = []
  /** @type {{seq: number, time: number|null, calls: object[]}|null} */
  let pendingTools = null
  let lastIncludedTime = null
  let title = null
  let assistantModel = null
  let assistantProvider = null
  let routeModel = null
  let routeProvider = null

  /** Emit the pending run of tool calls as one grouped item. */
  const flushTools = () => {
    if (pendingTools === null || pendingTools.calls.length === 0) {
      pendingTools = null
      return
    }
    const calls = pendingTools.calls
    items.push({
      id: `tool:${pendingTools.seq}`,
      kind: 'tool',
      seq: pendingTools.seq,
      time: pendingTools.time,
      text: `调用了 ${calls.length} 个工具`,
      toolCalls: calls,
    })
    pendingTools = null
  }

  for (let index = 0; index < list.length; index += 1) {
    const event = list[index]
    try {
      if (!isPlainObject(event)) continue
      const type = typeof event.type === 'string' ? event.type : ''
      const seq = eventSeq(event, index)
      const time = eventTime(event.time)

      if (type === EVENT_TYPES.user) {
        const item = userItem(event, seq, time, opts)
        if (item === null) continue
        flushTools()
        items.push(item)
        lastIncludedTime = laterTime(lastIncludedTime, time)
        continue
      }

      if (type === EVENT_TYPES.assistant) {
        const source = assistantSource(event)
        if (source !== null) {
          if (typeof source.model === 'string' && source.model !== '') assistantModel = source.model
          if (typeof source.provider === 'string' && source.provider !== '') assistantProvider = source.provider
        }
        const item = assistantItem(event, seq, time, opts)
        if (item === null) continue
        flushTools()
        items.push(item)
        lastIncludedTime = laterTime(lastIncludedTime, time)
        continue
      }

      if (type === EVENT_TYPES.toolCall) {
        if (!opts.includeTools) continue
        const call = toolCallEntry(event, toolStatus, opts)
        if (call === null) continue
        if (pendingTools === null) pendingTools = { seq, time, calls: [] }
        pendingTools.calls.push(call)
        lastIncludedTime = laterTime(lastIncludedTime, time)
        continue
      }

      if (type === EVENT_TYPES.title) {
        const data = event.data
        if (isPlainObject(data) && typeof data.title === 'string' && data.title.trim() !== '') {
          title = data.title
        }
        continue
      }

      if (type === 'request/context' || type === 'model/selection') {
        // Fallback only: a session with no settled assistant message can still
        // name the route it was configured with.
        const data = event.data
        if (isPlainObject(data)) {
          if (typeof data.model === 'string' && data.model !== '') routeModel = data.model
          if (typeof data.provider === 'string' && data.provider !== '') routeProvider = data.provider
        }
        continue
      }
      // Every other event type (reasoning streams, system prompts, compaction,
      // turn/step bookkeeping, titles' LLM requests, jobs, approvals, ...) is
      // intentionally invisible to the share payload.
    } catch (_error) {
      // A malformed event never hides the rest of the conversation.
    }
  }
  flushTools()

  const createdAt = eventTime(sessionHeader.createdAt)
  const model = assistantModel !== null ? assistantModel : routeModel
  const provider = assistantProvider !== null ? assistantProvider : routeProvider
  const session = {
    id: typeof sessionHeader.id === 'string' ? sessionHeader.id : '',
    title: title !== null ? title : headerTitle(sessionHeader),
    cwd: typeof sessionHeader.cwd === 'string' ? sessionHeader.cwd : null,
    createdAt,
    updatedAt: lastIncludedTime !== null ? lastIncludedTime : createdAt,
    model,
  }
  if (provider !== null) session.provider = provider

  return { session, items }
}

/**
 * Compact share metadata for one folded transcript: item counts, text volume
 * and a first-prompt preview. Useful for dialog copy and export decisions.
 *
 * @param {{session?: object, items?: object[]}|null|undefined} transcript -
 *   the value returned by {@link assembleTranscript}.
 * @param {{previewChars?: number}} [options] - preview length (default 80).
 * @returns {{sessionId: string, title: string, model: string|null,
 *   createdAt: number|null, updatedAt: number|null, totalItems: number,
 *   counts: {user: number, assistant: number, tool: number, note: number},
 *   textChars: number, images: number, firstUserText: string}}
 */
export function summarizeForShare(transcript, options = {}) {
  const raw = isPlainObject(options) ? options : {}
  const previewChars = positiveLimit(raw.previewChars, 80)
  const items =
    isPlainObject(transcript) && Array.isArray(transcript.items) ? transcript.items : []
  const session =
    isPlainObject(transcript) && isPlainObject(transcript.session) ? transcript.session : {}

  const counts = { user: 0, assistant: 0, tool: 0, note: 0 }
  let textChars = 0
  let images = 0
  let firstUserText = ''

  for (const item of items) {
    if (!isPlainObject(item)) continue
    if (typeof item.kind === 'string' && Object.prototype.hasOwnProperty.call(counts, item.kind)) {
      counts[item.kind] += 1
    }
    if (typeof item.text === 'string') {
      textChars += item.text.length
      if (firstUserText === '' && item.kind === 'user' && item.text.trim() !== '') {
        firstUserText = item.text.trim()
      }
    }
    if (typeof item.images === 'number' && item.images > 0) images += item.images
  }

  return {
    sessionId: typeof session.id === 'string' ? session.id : '',
    title: typeof session.title === 'string' ? session.title : '',
    model: typeof session.model === 'string' ? session.model : null,
    createdAt: eventTime(session.createdAt),
    updatedAt: eventTime(session.updatedAt),
    totalItems: items.length,
    counts,
    textChars,
    images,
    firstUserText: clipText(firstUserText, previewChars),
  }
}

// ── items ─────────────────────────────────────────────────────────────────

/**
 * One `user/message` event as a share item, or null when it is not a human
 * prompt / has no visible content / is a replacement copy.
 */
function userItem(event, seq, time, opts) {
  if (isReplacement(event)) return null
  const data = event.data
  if (!isPlainObject(data)) return null
  if (typeof data.role === 'string' && data.role !== 'user') return null

  const source = isPlainObject(data.source) ? data.source : null
  const kind = source !== null && typeof source.kind === 'string' ? source.kind : ''
  if (kind !== '' && !opts.userSourceKinds.includes(kind)) return null

  const content = Array.isArray(data.content) ? data.content : []
  const texts = []
  const imageRefs = []
  for (const part of content) {
    if (!isPlainObject(part)) continue
    if (part.type === 'text') {
      if (typeof part.text === 'string' && part.text.trim() !== '') texts.push(part.text)
    } else if (part.type === 'image') {
      const ref = imageRefOf(part.attachment)
      if (ref !== null) imageRefs.push(ref)
    }
  }

  const text = clipText(texts.join('\n\n').trim(), opts.maxTextChars)
  // A pure image prompt is still a real turn, so keep it with empty text.
  if (text === '' && imageRefs.length === 0) return null

  const item = { id: `user:${seq}`, kind: 'user', seq, time, text }
  if (imageRefs.length > 0) {
    item.images = imageRefs.length
    item.imageRefs = imageRefs
  }
  return item
}

/**
 * Copy the JSON-safe display fields of one image attachment reference. The
 * Host route resolves `attachmentId` into bytes; width/height let the export
 * engine lay the image out before it finishes decoding.
 */
function imageRefOf(attachment) {
  if (!isPlainObject(attachment)) return null
  const attachmentId = typeof attachment.attachmentId === 'string' ? attachment.attachmentId : ''
  if (attachmentId === '') return null
  const ref = { attachmentId }
  if (typeof attachment.mediaType === 'string' && attachment.mediaType !== '') ref.mediaType = attachment.mediaType
  if (typeof attachment.width === 'number' && attachment.width > 0) ref.width = attachment.width
  if (typeof attachment.height === 'number' && attachment.height > 0) ref.height = attachment.height
  if (typeof attachment.bytes === 'number' && attachment.bytes > 0) ref.bytes = attachment.bytes
  if (typeof attachment.name === 'string' && attachment.name !== '') ref.name = attachment.name
  return ref
}

/**
 * One `assistant/message` event as a share item, or null when it carries no
 * visible text (pure reasoning / tool-use steps are not part of the transcript).
 */
function assistantItem(event, seq, time, opts) {
  if (isReplacement(event)) return null
  const data = event.data
  if (!isPlainObject(data)) return null
  const message = data.message
  if (!isPlainObject(message)) return null
  if (typeof message.role === 'string' && message.role !== 'assistant') return null

  const content = Array.isArray(message.content) ? message.content : []
  const texts = []
  for (const part of content) {
    if (!isPlainObject(part)) continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '') {
      texts.push(part.text)
    }
  }

  const text = clipText(texts.join('\n\n').trim(), opts.maxTextChars)
  if (text === '') return null

  const source = isPlainObject(message.source) ? message.source : null
  const model = source !== null && typeof source.model === 'string' && source.model !== '' ? source.model : null
  const provider =
    source !== null && typeof source.provider === 'string' && source.provider !== ''
      ? source.provider
      : null

  const item = { id: `assistant:${seq}`, kind: 'assistant', seq, time, text, model }
  if (provider !== null) item.provider = provider
  return item
}

/** Provider/model of an assistant event, whether or not it produced a share item. */
function assistantSource(event) {
  const data = isPlainObject(event.data) ? event.data : null
  const message = data !== null && isPlainObject(data.message) ? data.message : null
  const source = message !== null && isPlainObject(message.source) ? message.source : null
  return source
}

/**
 * One `tool/call` event as a `toolCalls` entry, or null when malformed.
 * Status is filled from the matching `tool/result` when the log has one.
 */
function toolCallEntry(event, toolStatus, opts) {
  const data = event.data
  if (!isPlainObject(data)) return null
  const name = typeof data.name === 'string' && data.name !== '' ? data.name : 'tool'
  const callId = typeof data.callId === 'string' ? data.callId : ''
  const args = parseArguments(data.arguments)

  const title = clipText(pickToolTitle(name, args), opts.toolTitleMax) || name
  const detail = toolDetail(args, title, opts)
  const status = callId !== '' ? toolStatus.get(callId) : undefined

  const entry = { name, title }
  if (detail !== '') entry.detail = detail
  if (status === 'ok' || status === 'error') entry.status = status
  return entry
}

/** Map every tool result `callId` to `'ok'` or `'error'`. */
function collectToolStatuses(events) {
  const status = new Map()
  for (const event of events) {
    try {
      if (!isPlainObject(event) || event.type !== EVENT_TYPES.toolResult) continue
      const data = isPlainObject(event.data) ? event.data : null
      if (data === null) continue
      const message = isPlainObject(data.message) ? data.message : null
      if (message === null) continue
      const callId = toolResultCallId(message)
      if (callId === '') continue
      const failed = message.isError === true || (data.error !== undefined && data.error !== null)
      status.set(callId, failed ? 'error' : 'ok')
    } catch (_error) {
      // ignore one malformed result
    }
  }
  return status
}

/** The call id a `tool/result` message answers. */
function toolResultCallId(message) {
  if (typeof message.toolCallId === 'string' && message.toolCallId !== '') return message.toolCallId
  const source = isPlainObject(message.source) ? message.source : null
  if (source !== null && typeof source.callId === 'string') return source.callId
  return ''
}

/** Parse `tool/call` `arguments` (a JSON string in live logs) into an object. */
function parseArguments(raw) {
  if (isPlainObject(raw)) return raw
  if (typeof raw !== 'string') return {}
  const trimmed = raw.trim()
  if (trimmed === '') return {}
  try {
    const parsed = JSON.parse(trimmed)
    return isPlainObject(parsed) ? parsed : {}
  } catch (_error) {
    return {}
  }
}

/** Short human-readable title for one tool call (a path, a description, ...). */
function pickToolTitle(name, args) {
  for (const field of TOOL_TITLE_FIELDS) {
    const value = args[field]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  if (Array.isArray(args.queries)) {
    const queries = args.queries.filter((value) => typeof value === 'string' && value.trim() !== '')
    if (queries.length > 0) return queries.join(' | ')
  }
  if (Array.isArray(args.files) && args.files.length > 0) {
    const first = args.files[0]
    if (isPlainObject(first) && typeof first.path === 'string' && first.path !== '') return first.path
  }
  if (Array.isArray(args.questions) && args.questions.length > 0) {
    const first = args.questions[0]
    if (isPlainObject(first) && typeof first.question === 'string' && first.question !== '') {
      return first.question
    }
  }
  if (Array.isArray(args.todos)) return `${args.todos.length} 项待办`
  if (typeof args.prompt === 'string' && args.prompt.trim() !== '') return args.prompt.trim()
  return name
}

/** Optional second line for one tool call: the command / message it carried. */
function toolDetail(args, title, opts) {
  for (const field of ['command', 'message', 'prompt']) {
    const value = args[field]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '' || trimmed === title) continue
    return clipText(trimmed, opts.toolDetailMax)
  }
  return ''
}

// ── event helpers ─────────────────────────────────────────────────────────

/** True when a surface event is a model-only replacement copy, not transcript. */
function isReplacement(event) {
  const op = event.surfaceOp
  if (op === undefined || op === null) return false
  if (typeof op === 'string') return op !== 'append'
  if (isPlainObject(op)) return op.op === 'replace'
  return false
}

/** `seq` as a finite non-negative number, falling back to the array index. */
function eventSeq(event, fallback) {
  const value = event.seq
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  return fallback
}

/** `time` as epoch milliseconds, or null when the log did not record it. */
function eventTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/** The later of two epoch-millisecond times (null means "not recorded"). */
function laterTime(current, time) {
  if (time === null) return current
  if (current === null || time > current) return time
  return current
}

/** `header.title` fallback for sessions whose log has no `session/title`. */
function headerTitle(sessionHeader) {
  return typeof sessionHeader.title === 'string' ? sessionHeader.title : ''
}

// ── misc ──────────────────────────────────────────────────────────────────

/** Whether a value is a non-array object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Clip text to `max` characters, marking a visible truncation with an ellipsis. */
function clipText(text, max) {
  if (typeof text !== 'string') return ''
  if (max <= 0 || text.length <= max) return text
  return text.slice(0, max) + '…'
}

/** Positive integer limit, or the fallback when absent/invalid. */
function positiveLimit(value, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.floor(number)
}

/** Normalize `assembleTranscript` options once. */
function normalizeOptions(options) {
  const raw = isPlainObject(options) ? options : {}
  const kinds = Array.isArray(raw.userSourceKinds)
    ? raw.userSourceKinds.filter((kind) => typeof kind === 'string' && kind !== '')
    : []
  return {
    includeTools: raw.includeTools !== false,
    userSourceKinds: kinds.length > 0 ? kinds : DEFAULT_USER_SOURCE_KINDS,
    maxTextChars: positiveLimit(raw.maxTextChars, 0),
    toolTitleMax: positiveLimit(raw.toolTitleMax, DEFAULT_TOOL_TITLE_MAX),
    toolDetailMax: positiveLimit(raw.toolDetailMax, DEFAULT_TOOL_DETAIL_MAX),
  }
}
