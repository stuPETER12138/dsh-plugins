/**
 * Session share — Host half of `@local/dsh-session-share`.
 *
 * The browser half never parses the session log itself. This half reads the
 * current Session (live in memory when possible, otherwise through the durable
 * session services), folds its events into a small share payload with
 * `./src/transcript.js`, and serves that payload on one exact loopback route:
 *
 *   GET /dsh-session-share/transcript?sessionId=<id>
 *
 * With no `sessionId`, the most recently active live Session on this machine is
 * used, which keeps the browser share dialog usable even when its slot props do
 * not expose the Session identity.
 *
 * The route is read-only, same-origin, and reachable from loopback callers only
 * — the same guard the shipped Host plugins use — and never writes anything.
 *
 * @module @local/dsh-session-share
 */

import { assembleTranscript } from './src/transcript.js'

/** Exact browser route that serves one Session's share payload. */
const ROUTE_TRANSCRIPT = '/dsh-session-share/transcript'

/** Read deadline for one stored session log. */
const READ_TIMEOUT_MS = 20_000

/** Upper bound on events folded into one payload; older events are dropped. */
const MAX_EVENTS = 20_000

/** Payload schema version, so the browser half can reject unknown shapes. */
const PAYLOAD_VERSION = 1

/** Images embedded per share request; keeps the loopback payload small. */
const MAX_SHARED_IMAGES = 24

/** Raw bytes of every embedded image together, before base64 inflation. */
const MAX_SHARED_IMAGE_BYTES = 8 * 1024 * 1024

/** Services this Host half needs before it activates. */
export const inject = ['webServer']

/**
 * Publish the transcript route. Everything else is read on demand, so a profile
 * that never opens the share dialog pays nothing.
 *
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_TRANSCRIPT,
        handler: (request, response) => {
          void handleTranscript(ctx, request, response)
        },
      }),
    'session-share: transcript route',
  )
}

/**
 * `GET|HEAD /dsh-session-share/transcript?sessionId=<id>` — one loopback JSON
 * payload. Failures are explicit `{ error: { code, message } }` bodies, never
 * an empty 200.
 */
async function handleTranscript(ctx, request, response) {
  if (!isLoopbackRequest(request)) {
    sendError(response, 403, 'forbidden', '会话分享只接受本机页面的请求。')
    return
  }
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    sendError(response, 405, 'method-not-allowed', '仅支持 GET。')
    return
  }

  let requested
  try {
    requested = new URL(request.url ?? '/', 'http://localhost').searchParams.get('sessionId')
  } catch (_error) {
    requested = null
  }

  try {
    const source = await readSession(ctx, requested)
    if (source === null) {
      const message =
        requested === null || requested === ''
          ? '当前没有可分享的会话，先打开一个会话再试。'
          : '找不到这个会话：它可能尚未保存，或者已经被删除。'
      sendError(response, 404, 'session-not-found', message)
      return
    }

    // A seeded or forked Session keeps an inherited prefix in its own log; the
    // Chat view shows that history as part of the conversation, so a share must
    // include it too. (Statistics plugins skip the prefix to avoid double
    // counting a parent's tokens — that rule does not apply to a transcript.)
    let events = Array.isArray(source.events) ? source.events.slice() : []
    let truncated = false
    if (events.length > MAX_EVENTS) {
      events = events.slice(events.length - MAX_EVENTS)
      truncated = true
    }

    const folded = assembleTranscript(source.header, events, { maxTextChars: 200_000 })
    // Message images live in the attachment store, not in the log; resolve the
    // refs the transcript kept so the browser can draw them into PNG and PDF.
    const attachments = await readShareImages(ctx, folded.items)
    const payload = {
      version: PAYLOAD_VERSION,
      source: source.source,
      truncated,
      partial: source.partial === true,
      session: folded.session,
      items: folded.items,
      attachments,
    }

    if (method === 'HEAD') {
      sendHead(response)
      return
    }
    sendJson(response, 200, payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendError(response, 500, 'internal-error', '读取会话失败：' + message)
  }
}

// ── session reading ────────────────────────────────────────────────────────

/**
 * Resolve the image references kept by the transcript into `data:` URLs.
 *
 * The attachment service verifies each stored object against its reference and
 * returns the bytes; a missing or corrupted image is simply left out, so a
 * share never fails because of one old attachment. The result is keyed by
 * `attachmentId`, and only the first {@link MAX_SHARED_IMAGES} within
 * {@link MAX_SHARED_IMAGE_BYTES} are embedded.
 *
 * @returns {Promise<Record<string, {mediaType: string, width: number, height: number, bytes: number, dataUrl: string}>>}
 */
async function readShareImages(ctx, items) {
  const attachments = ctx.get('attachments')
  if (attachments === undefined || attachments === null || typeof attachments.readImage !== 'function') return {}

  const embedded = {}
  const seen = new Set()
  let count = 0
  let totalBytes = 0
  const signal = AbortSignal.timeout(READ_TIMEOUT_MS)

  for (const item of items) {
    if (!Array.isArray(item.imageRefs)) continue
    for (const ref of item.imageRefs) {
      const attachmentId = typeof ref?.attachmentId === 'string' ? ref.attachmentId : ''
      if (attachmentId === '' || seen.has(attachmentId)) continue
      if (count >= MAX_SHARED_IMAGES || totalBytes >= MAX_SHARED_IMAGE_BYTES) continue
      seen.add(attachmentId)
      try {
        const stored = await attachments.readImage(ref, signal)
        const raw = toBytes(stored?.data)
        if (raw === null || totalBytes + raw.byteLength > MAX_SHARED_IMAGE_BYTES) continue
        const mediaType = typeof ref.mediaType === 'string' && ref.mediaType !== '' ? ref.mediaType : 'image/png'
        totalBytes += raw.byteLength
        count += 1
        embedded[attachmentId] = {
          mediaType,
          width: numberOr(ref.width, 0),
          height: numberOr(ref.height, 0),
          bytes: raw.byteLength,
          dataUrl: `data:${mediaType};base64,${Buffer.from(raw).toString('base64')}`,
        }
      } catch (_error) {
        /* a missing or corrupted image is skipped, not fatal */
      }
    }
  }
  return embedded
}

/** Coerce an attachment read result into a `Uint8Array`, or null. */
function toBytes(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data !== null && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset ?? 0, data.byteLength ?? 0)
  }
  return null
}

/**
 * Resolve one Session's header and events. Live memory wins because it is the
 * freshest copy; otherwise the durable log is read through the public services.
 * With no requested id the most recently active live Session is chosen.
 *
 * @returns {Promise<{header: object, events: object[], inheritedEventCount: number, source: string} | null>}
 */
async function readSession(ctx, requested) {
  const sessions = ctx.get('sessions')
  const id = typeof requested === 'string' && requested !== '' ? requested : latestLiveId(sessions)
  if (id === null || id === undefined) return null

  // The in-memory Session of a conversation opened earlier may only carry its
  // recent event window; `sessionQuery` prefers that same live snapshot, so a
  // whole-conversation share also needs the durable log for the older part.
  const primary = await readPrimary(ctx, id, sessions)
  if (primary === null) return readPersisted(ctx, id)

  if (startsAtZero(primary.events)) return primary

  const persisted = await readPersisted(ctx, id)
  if (persisted === null) {
    // No durable copy to merge: share what the loaded window holds and let the
    // UI say that the older history may be missing.
    return { ...primary, partial: true }
  }
  return {
    header: primary.header ?? persisted.header,
    events: mergeEvents(persisted.events, primary.events),
    inheritedEventCount: numberOr(persisted.inheritedEventCount, numberOr(primary.inheritedEventCount, 0)),
    source: 'merged',
  }
}

/**
 * Read the live-preferred copy of a Session: the complete query reader first,
 * then the in-memory Session (whose loaded window may be partial).
 */
async function readPrimary(ctx, id, sessions) {
  const query = ctx.get('sessionQuery')
  if (query !== undefined && query !== null && typeof query.readSession === 'function') {
    try {
      const snapshot = await query.readSession(id)
      return {
        header: snapshot.session ?? snapshot.header,
        events: snapshot.events ?? [],
        inheritedEventCount: numberOr(snapshot.inheritedEventCount, 0),
        source: 'query',
      }
    } catch (_error) {
      /* fall back to the in-memory window, then to the raw stored log */
    }
  }

  const live = typeof sessions?.get === 'function' ? sessions.get(id) : undefined
  if (live === undefined || live === null) return null
  return {
    header: live.header,
    events: liveEvents(live),
    inheritedEventCount: numberOr(live.inheritedEventCount, 0),
    source: 'live',
  }
}

/** True when an event list starts at the first event of the logical log. */
function startsAtZero(events) {
  if (!Array.isArray(events) || events.length === 0) return true
  return numberOr(events[0]?.seq, -1) === 0
}

/** Merge two event lists by absolute `seq`, letting the later list win. */
function mergeEvents(older, newer) {
  const bySeq = new Map()
  for (const event of older) {
    const seq = numberOr(event?.seq, -1)
    if (seq >= 0) bySeq.set(seq, event)
  }
  for (const event of newer) {
    const seq = numberOr(event?.seq, -1)
    if (seq >= 0) bySeq.set(seq, event)
  }
  return [...bySeq.values()].sort((left, right) => numberOr(left.seq, 0) - numberOr(right.seq, 0))
}

/**
 * The most recently active live Session, skipping subagent sessions: the share
 * dialog always refers to a conversation the user is looking at.
 */
function latestLiveId(sessions) {
  let bestId = null
  let bestTime = -1
  let list = []
  try {
    list = typeof sessions?.list === 'function' ? sessions.list() : []
  } catch (_error) {
    list = []
  }
  for (const session of list) {
    if (session === null || session === undefined) continue
    if (session.header?.origin === 'subagent') continue
    const time = lastEventTime(session)
    if (time > bestTime) {
      bestTime = time
      bestId = String(session.id)
    }
  }
  return bestId
}

/** Time of the newest event in a live Session, or its creation time when empty. */
function lastEventTime(session) {
  const seq = numberOr(session.seq, 0)
  if (seq <= 0) return numberOr(session.header?.createdAt, 0)
  try {
    const event = session.eventAt(seq - 1)
    return numberOr(event?.time, numberOr(session.header?.createdAt, 0))
  } catch (_error) {
    return numberOr(session.header?.createdAt, 0)
  }
}

/** Fold a live Session's in-memory log into an event array. */
function liveEvents(session) {
  const seq = numberOr(session.seq, 0)
  const events = []
  if (typeof session.eventAt !== 'function') return events
  for (let cursor = 0; cursor < seq; cursor += 1) {
    try {
      const event = session.eventAt(cursor)
      if (event !== undefined && event !== null) events.push(event)
    } catch (_error) {
      /* one unreadable slot does not hide the rest of the conversation */
    }
  }
  return events
}

/**
 * Read a stored Session directly through `sessionPersistence`, used when the
 * live-preferred query service is not available in this profile.
 */
async function readPersisted(ctx, id) {
  const signal = AbortSignal.timeout(READ_TIMEOUT_MS)
  const persistence = ctx.get('sessionPersistence')

  if (persistence !== undefined && persistence !== null) {
    let handle
    try {
      handle = await persistence.open(id, 'read', { signal })
      const result = await handle.read(undefined, undefined, { signal })
      return {
        header: handle.header,
        events: result?.events ?? [],
        inheritedEventCount: numberOr(handle.inheritedEventCount, 0),
        source: 'persistence',
      }
    } catch (_error) {
      /* fall through */
    } finally {
      if (handle !== undefined) {
        try {
          await handle.close()
        } catch (_closeError) {
          /* nothing this plugin owns */
        }
      }
    }
  }

  return null
}

// ── loopback guard ─────────────────────────────────────────────────────────
//
// The route serves conversation text, so it must only answer the page on this
// machine. A loopback peer is not sufficient on its own: a page on a rebinding
// domain also connects to 127.0.0.1, so the Host header and any Origin must be
// loopback too.

function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress
  if (typeof address !== 'string') return false
  const withoutMapped = address.startsWith('::ffff:') ? address.slice(7) : address
  const withoutZone = withoutMapped.split('%')[0]
  if (!(withoutZone === '::1' || withoutZone === '127.0.0.1' || withoutZone.startsWith('127.'))) return false
  return isLoopbackHostText(request.headers.host) && isLoopbackOriginHeader(request.headers.origin)
}

function isLoopbackHostText(value) {
  if (typeof value !== 'string' || value === '') return false
  const raw = value.startsWith('[') ? value.slice(1, value.indexOf(']')) : value.split(':')[0]
  const host = raw.toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  const parts = host.split('.')
  if (parts.length !== 4) return false
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false
  return parts[0] === '127'
}

function isLoopbackOriginHeader(value) {
  if (value === undefined) return true
  if (typeof value !== 'string') return false
  try {
    return isLoopbackHostText(new URL(value).host)
  } catch (_error) {
    return false
  }
}

// ── responses ──────────────────────────────────────────────────────────────

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(text)
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } })
}

function sendHead(response) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end()
}

function numberOr(value, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}
