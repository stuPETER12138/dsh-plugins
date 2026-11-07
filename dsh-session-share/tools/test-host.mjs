#!/usr/bin/env node
/**
 * Unit test for the Host half of `@local/dsh-session-share`.
 *
 * Runs `index.js` against stub Cordis services and a stub request/response, so
 * the route contract (payload, fallbacks, loopback guard, methods) is exercised
 * without starting DSH:
 *
 *   node tools/test-host.mjs
 */

import { apply } from '../index.js'

const PASS = []
const FAIL = []

function check(name, condition, detail) {
  if (condition) {
    PASS.push(name)
    console.log('PASS ' + name)
  } else {
    FAIL.push(name)
    console.log('FAIL ' + name + (detail === undefined ? '' : ' — ' + detail))
  }
}

// ── fixture session ────────────────────────────────────────────────────────

const header = { id: 'session-test-1', createdAt: 1_000, cwd: 'D:\\Project\\dsh-normal', title: '未命名会话' }

const events = [
  { seq: 0, time: 1_000, type: 'session/title', data: { title: '测试会话' } },
  {
    seq: 1,
    time: 1_001,
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: '你好，帮我看看这个 bug' },
        {
          type: 'image',
          attachment: {
            attachmentId: 'sha256:test-image',
            mediaType: 'image/png',
            width: 640,
            height: 360,
            bytes: 4,
            name: 'shot.png',
          },
        },
      ],
    },
  },
  {
    seq: 2,
    time: 1_002,
    type: 'assistant/message',
    data: {
      message: {
        role: 'assistant',
        source: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        content: [{ type: 'text', text: '好的，我先看一下。' }],
      },
    },
  },
  { seq: 3, time: 1_003, type: 'tool/call', data: { callId: 'c1', name: 'read', arguments: '{"file_path":"src/app.js"}' } },
  { seq: 4, time: 1_004, type: 'tool/result', data: { message: { toolCallId: 'c1', isError: false } } },
  {
    seq: 5,
    time: 1_005,
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'runtime-context' },
      content: [{ type: 'text', text: '这段注入的上下文不应出现在分享里' }],
    },
  },
  {
    seq: 6,
    time: 1_006,
    type: 'user/message',
    data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '谢谢' }] },
  },
  {
    seq: 7,
    time: 1_007,
    type: 'user/message',
    surfaceOp: { op: 'replace' },
    data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '替换副本不应出现' }] },
  },
]

const liveSession = {
  id: header.id,
  header,
  seq: events.length,
  inheritedEventCount: 0,
  eventAt(index) {
    return events[index]
  },
}

// ── stub Cordis context ────────────────────────────────────────────────────

let registered = null
const disposers = []

const ctx = {
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  get(name) {
    if (name === 'sessions') {
      return {
        get: (id) => (id === header.id ? liveSession : undefined),
        list: () => [liveSession],
      }
    }
    if (name === 'attachments') {
      return {
        async readImage(ref) {
          // Only the known picture resolves; unknown refs must be skipped.
          if (ref.attachmentId !== 'sha256:test-image') throw new Error('attachment not found')
          return { ref, data: new Uint8Array([1, 2, 3, 4]) }
        },
      }
    }
    return undefined
  },
  webServer: {
    register(route) {
      registered = route
      return () => {}
    },
  },
  logger: undefined,
}

apply(ctx)
check('registers exactly one exact route', registered !== null && registered.kind === 'exact', String(registered?.kind))
check('route path is the transcript route', registered?.path === '/dsh-session-share/transcript', String(registered?.path))

// ── request/response stubs ─────────────────────────────────────────────────

function createResponse() {
  let resolveDone
  const done = new Promise((resolve) => {
    resolveDone = resolve
  })
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers ?? {}
      return this
    },
    end(text) {
      this.body = text ?? ''
      resolveDone(this)
    },
  }
  return { res, done }
}

function createRequest({ method = 'GET', url = '/dsh-session-share/transcript', host = '127.0.0.1:49669', origin, remoteAddress = '127.0.0.1' } = {}) {
  const headers = { host }
  if (origin !== undefined) headers.origin = origin
  return { method, url, headers, socket: { remoteAddress } }
}

async function call(request) {
  const { res, done } = createResponse()
  registered.handler(request, res)
  const timeout = new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('route handler did not respond within 3s')), 3_000)
    timer.unref?.()
  })
  const response = await Promise.race([done, timeout])
  clearTimeout(timeout)
  let json
  try {
    json = JSON.parse(response.body)
  } catch (_error) {
    json = undefined
  }
  return { response, json }
}

// ── cases ──────────────────────────────────────────────────────────────────

const bySession = await call(createRequest({ url: '/dsh-session-share/transcript?sessionId=' + header.id }))
check('session request answers 200', bySession.response.statusCode === 200, String(bySession.response.statusCode))
check('payload version is 1', bySession.json?.version === 1, String(bySession.json?.version))
check('payload names the session', bySession.json?.session?.id === header.id, String(bySession.json?.session?.id))
check('payload carries the last title', bySession.json?.session?.title === '测试会话', String(bySession.json?.session?.title))
check('payload carries the model', bySession.json?.session?.model === 'deepseek-v4.1-flash', String(bySession.json?.session?.model))
check('response is uncacheable', bySession.response.headers['cache-control'] === 'no-store', String(bySession.response.headers['cache-control']))
check('no truncation flag for a short session', bySession.json?.truncated === false, String(bySession.json?.truncated))
check('source is the live session', bySession.json?.source === 'live', String(bySession.json?.source))

const items = Array.isArray(bySession.json?.items) ? bySession.json.items : []
const kinds = items.map((item) => item.kind)
check(
  'items keep visible order user, assistant, tool, user',
  JSON.stringify(kinds) === JSON.stringify(['user', 'assistant', 'tool', 'user']),
  JSON.stringify(kinds),
)
check('injected runtime context is skipped', !items.some((item) => item.text?.includes('注入的上下文')))
check('replacement surface copies are skipped', !items.some((item) => item.text?.includes('替换副本')))
check('tool call title is the path argument', items[2]?.toolCalls?.[0]?.title === 'src/app.js', JSON.stringify(items[2]?.toolCalls))
check('tool call status comes from the result', items[2]?.toolCalls?.[0]?.status === 'ok', JSON.stringify(items[2]?.toolCalls))
check('assistant item carries its model', items[1]?.model === 'deepseek-v4.1-flash', String(items[1]?.model))
check('user item keeps its image refs', Array.isArray(items[0]?.imageRefs) && items[0].imageRefs[0]?.attachmentId === 'sha256:test-image')
check('payload embeds referenced image bytes as a data URL', typeof bySession.json?.attachments?.['sha256:test-image']?.dataUrl === 'string' && bySession.json.attachments['sha256:test-image'].dataUrl.startsWith('data:image/png;base64,'), String(bySession.json?.attachments?.['sha256:test-image']?.dataUrl)?.slice(0, 40))
check('embedded image keeps its dimensions', bySession.json?.attachments?.['sha256:test-image']?.width === 640 && bySession.json.attachments['sha256:test-image'].height === 360)

const fallback = await call(createRequest({ url: '/dsh-session-share/transcript' }))
check('missing sessionId falls back to the latest live session', fallback.response.statusCode === 200 && fallback.json?.session?.id === header.id, String(fallback.response.statusCode))

const unknown = await call(createRequest({ url: '/dsh-session-share/transcript?sessionId=session-missing' }))
check('unknown session answers 404', unknown.response.statusCode === 404, String(unknown.response.statusCode))
check('unknown session names the code', unknown.json?.error?.code === 'session-not-found', String(unknown.json?.error?.code))

const foreignPeer = await call(createRequest({ remoteAddress: '10.0.0.5' }))
check('non-loopback peer answers 403', foreignPeer.response.statusCode === 403, String(foreignPeer.response.statusCode))

const foreignHost = await call(createRequest({ host: 'evil.example.com' }))
check('non-loopback Host answers 403', foreignHost.response.statusCode === 403, String(foreignHost.response.statusCode))

const foreignOrigin = await call(createRequest({ origin: 'https://evil.example.com' }))
check('non-loopback Origin answers 403', foreignOrigin.response.statusCode === 403, String(foreignOrigin.response.statusCode))

const loopbackOrigin = await call(createRequest({ origin: 'http://127.0.0.1:49669' }))
check('loopback Origin is accepted', loopbackOrigin.response.statusCode === 200, String(loopbackOrigin.response.statusCode))

const post = await call(createRequest({ method: 'POST' }))
check('POST answers 405', post.response.statusCode === 405, String(post.response.statusCode))

const head = await call(createRequest({ method: 'HEAD' }))
check('HEAD answers 200 with no body', head.response.statusCode === 200 && head.response.body === '', `${head.response.statusCode}/${JSON.stringify(head.response.body)}`)

// ── cleanup ────────────────────────────────────────────────────────────────

for (const dispose of disposers) {
  try {
    await dispose()
  } catch (_error) {
    /* stub disposers are empty */
  }
}

// ── query-first path ────────────────────────────────────────────────────────
//
// A Session materialized in memory may only hold its recent event window (older
// events are paged on demand). `sessionQuery.readSession` must therefore win:
// it returns the complete logical log, which is what a whole-conversation share
// needs. This reproduces the "only the last turn was shared" report.

{
  let queryRoute = null
  const queryDisposers = []
  const windowStart = events.length - 2
  const windowedSession = {
    id: header.id,
    header,
    seq: events.length,
    inheritedEventCount: 0,
    eventAt(index) {
      return index >= windowStart ? events[index] : undefined
    },
  }
  const queryCtx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') queryDisposers.push(dispose)
      return dispose
    },
    get(name) {
      if (name === 'sessions') {
        return {
          get: (id) => (id === header.id ? windowedSession : undefined),
          list: () => [windowedSession],
        }
      }
      if (name === 'sessionQuery') {
        return {
          async readSession(id) {
            if (id !== header.id) throw new Error('unknown session')
            // Live-preferred snapshot: only the recent window is materialized.
            // A seeded Session also reports an inherited prefix, which a share
            // must still include.
            return { session: header, inheritedEventCount: 2, events: events.slice(windowStart) }
          },
        }
      }
      if (name === 'sessionPersistence') {
        return {
          async open() {
            return {
              header,
              inheritedEventCount: 2,
              async read() {
                return { events }
              },
              async close() {},
            }
          },
        }
      }
      if (name === 'attachments') {
        return {
          async readImage(ref) {
            if (ref.attachmentId !== 'sha256:test-image') throw new Error('attachment not found')
            return { ref, data: new Uint8Array([1, 2, 3, 4]) }
          },
        }
      }
      return undefined
    },
    webServer: {
      register(route) {
        queryRoute = route
        return () => {}
      },
    },
  }

  apply(queryCtx)
  const { res, done } = createResponse()
  queryRoute.handler(createRequest({ url: '/dsh-session-share/transcript?sessionId=' + header.id }), res)
  const response = await done
  const payload = JSON.parse(response.body)
  check('partial live snapshot is merged with the durable log', payload.source === 'merged', String(payload.source))
  check('merged payload returns every turn', Array.isArray(payload.items) && payload.items.length === 4, `items=${payload.items?.length}`)
  check('older turns survive the partial window', payload.items?.[0]?.text === '你好，帮我看看这个 bug', String(payload.items?.[0]?.text))
  check('partial-window fallback still embeds its image', typeof payload.attachments?.['sha256:test-image']?.dataUrl === 'string')

  for (const dispose of queryDisposers) {
    try {
      await dispose()
    } catch (_error) {
      /* stub disposers are empty */
    }
  }
}

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`)
if (FAIL.length > 0) process.exitCode = 1
