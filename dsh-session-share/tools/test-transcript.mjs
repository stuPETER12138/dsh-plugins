#!/usr/bin/env node
/**
 * Test harness for `src/transcript.js`.
 *
 * Run with the bundled Node from the plugin directory:
 *   node tools/test-transcript.mjs
 *
 * Covers:
 *  - a synthetic session fixture with every event shape the folder understands
 *  - malformed/unknown events (the folder must never throw)
 *  - option handling (tool grouping off, injected-source opt-in, text clipping,
 *    and the `maxTextChars` option the Host route passes)
 *  - one real recent live session log under $DSH_HOME/sessions, when readable;
 *    that part SKIPs gracefully instead of failing on a fresh machine.
 *
 * Prints one PASS/FAIL/SKIP line per check and a SUMMARY line; exits non-zero
 * when any check fails.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { EVENT_TYPES, assembleTranscript, summarizeForShare } from '../src/transcript.js'

let passed = 0
let failed = 0
let skipped = 0

function pass(name) {
  passed += 1
  console.log(`PASS ${name}`)
}

function skip(name, reason) {
  skipped += 1
  console.log(`SKIP ${name} — ${reason}`)
}

function fail(name, error) {
  failed += 1
  console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`)
}

function check(name, fn) {
  try {
    fn()
    pass(name)
  } catch (error) {
    fail(name, error)
  }
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

// ── synthetic fixture ──────────────────────────────────────────────────────

const HEADER = {
  type: 'session',
  version: 4,
  id: 'session-fixture-0001',
  createdAt: 1000,
  cwd: 'D:\\Project\\dsh-normal',
  isSeeded: false,
  agentPreset: 'cordis',
}

function ev(seq, type, data, extra = {}) {
  return { type, seq, time: 1000 + seq, data, surfaceOp: 'append', ...extra }
}

const EVENTS = [
  ev(0, 'system/message', { content: [{ type: 'text', text: 'system prompt' }] }),
  ev(1, 'user/message', {
    role: 'user',
    content: [{ type: 'text', text: '你好，\n请分享这段对话。' }],
    source: { kind: 'user', rpcId: 'rpc-1' },
  }),
  ev(2, 'user/message', {
    role: 'user',
    content: [{ type: 'text', text: '运行时上下文' }],
    source: { kind: 'runtime-context', form: 'snapshot' },
  }),
  ev(3, 'user/message', {
    role: 'user',
    content: [
      {
        type: 'image',
        attachment: {
          attachmentId: 'sha256:abc',
          mediaType: 'image/png',
          width: 800,
          height: 600,
          bytes: 1234,
          name: 'shot.png',
        },
      },
      { type: 'text', text: '这张图也一起。' },
    ],
    source: { kind: 'user' },
  }),
  // A replacement copy is model-only: it must never reach the transcript.
  ev(
    4,
    'user/message',
    { role: 'user', content: [{ type: 'text', text: '被替换的旧消息' }], source: { kind: 'user' } },
    { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } },
  ),
  ev(5, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '先思考一下' },
        { type: 'tool-call', id: 'call_a', name: 'read', arguments: '{"file_path":"src/a.js"}' },
      ],
      source: { kind: 'model', provider: 'p-test', model: 'm-test-1' },
      id: 'asst-5',
    },
  }),
  ev(6, 'tool/call', {
    turn: 1,
    step: 1,
    callId: 'call_a',
    name: 'read',
    arguments: '{"file_path":"src/a.js"}',
  }),
  ev(7, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'tool',
      source: { kind: 'tool', callId: 'call_a' },
      toolCallId: 'call_a',
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      id: 'res-7',
    },
  }),
  ev(8, 'tool/call', {
    turn: 1,
    step: 1,
    callId: 'call_b',
    name: 'pwsh',
    arguments: '{"command":"node tools/test-transcript.mjs","description":"Run transcript test"}',
  }),
  ev(9, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'tool',
      source: { kind: 'tool', callId: 'call_b' },
      toolCallId: 'call_b',
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
      id: 'res-9',
    },
    error: { name: 'Error', code: 'E_TEST' },
  }),
  ev(10, 'assistant/message', {
    turn: 1,
    step: 2,
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '总结' },
        { type: 'text', text: '第一段。' },
      ],
      source: { kind: 'model', provider: 'p-test', model: 'm-test-2' },
      id: 'asst-10',
    },
  }),
  ev(11, 'tool/call', {
    turn: 1,
    step: 2,
    callId: 'call_c',
    name: 'glob',
    arguments: '{"pattern":"**/*.js"}',
  }),
  ev(12, 'assistant/message', {
    turn: 1,
    step: 3,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '完成。' }],
      source: { kind: 'model', provider: 'p-test', model: 'm-test-2' },
      id: 'asst-12',
    },
  }),
  ev(13, 'session/title', { title: '旧标题', messageSeqs: [1], source: { kind: 'fallback' } }),
  ev(14, 'session/title', { title: '最终标题', messageSeqs: [1], source: { kind: 'provider' } }),
  ev(15, 'session/title-llm-request', { provider: 'x' }),
  ev(16, 'unknown/event', { anything: true }),
  { type: 'assistant/message', seq: 17, time: 1017, data: null },
  null,
  { type: 'user/message', seq: 18, time: 1018 },
  { type: 'tool/call', seq: 19, time: 1019 },
]

/** Shared item-shape assertions (also used on the real session log). */
function validateItems(items) {
  assert.ok(Array.isArray(items))
  const ids = new Set()
  for (const item of items) {
    assert.ok(item !== null && typeof item === 'object', 'item must be an object')
    assert.equal(typeof item.id, 'string')
    assert.ok(item.id.length > 0)
    assert.ok(!ids.has(item.id), `duplicate item id ${item.id}`)
    ids.add(item.id)
    assert.ok(['user', 'assistant', 'tool', 'note'].includes(item.kind), `unexpected kind ${item.kind}`)
    assert.ok(Number.isFinite(item.seq), 'seq must be finite')
    assert.ok(item.time === null || Number.isFinite(item.time), 'time must be number|null')
    assert.equal(typeof item.text, 'string')
    if (item.kind === 'tool') {
      assert.ok(Array.isArray(item.toolCalls) && item.toolCalls.length > 0, 'tool item needs toolCalls')
      for (const call of item.toolCalls) {
        assert.equal(typeof call.name, 'string')
        assert.equal(typeof call.title, 'string')
        if (call.detail !== undefined) assert.equal(typeof call.detail, 'string')
        if (call.status !== undefined) assert.ok(call.status === 'ok' || call.status === 'error')
      }
    } else if (item.kind === 'user') {
      assert.ok(item.text.length > 0 || (item.images ?? 0) > 0, 'user item needs text or images')
    } else {
      assert.ok(item.text.length > 0, 'assistant item needs text')
    }
    if (item.images !== undefined) assert.ok(Number.isInteger(item.images) && item.images > 0)
    if (item.model !== undefined) assert.ok(item.model === null || typeof item.model === 'string')
  }
}

// ── fixture checks ─────────────────────────────────────────────────────────

check('fixture: session metadata', () => {
  const { session } = assembleTranscript(HEADER, EVENTS)
  assert.equal(session.id, 'session-fixture-0001')
  assert.equal(session.title, '最终标题')
  assert.equal(session.cwd, 'D:\\Project\\dsh-normal')
  assert.equal(session.createdAt, 1000)
  assert.equal(session.updatedAt, 1012)
  assert.equal(session.model, 'm-test-2')
  assert.equal(session.provider, 'p-test')
})

check('fixture: item order and kinds', () => {
  const { items } = assembleTranscript(HEADER, EVENTS)
  assert.deepEqual(
    items.map((item) => item.kind),
    ['user', 'user', 'tool', 'assistant', 'tool', 'assistant'],
  )
  assert.deepEqual(
    items.map((item) => item.seq),
    [1, 3, 6, 10, 11, 12],
  )
  assert.deepEqual(
    items.map((item) => item.time),
    [1001, 1003, 1006, 1010, 1011, 1012],
  )
})

check('fixture: user text keeps newlines and images count', () => {
  const { items } = assembleTranscript(HEADER, EVENTS)
  assert.equal(items[0].text, '你好，\n请分享这段对话。')
  assert.equal(items[0].images, undefined)
  assert.equal(items[1].text, '这张图也一起。')
  assert.equal(items[1].images, 1)
})

check('fixture: user image refs kept for embedding', () => {
  const { items } = assembleTranscript(HEADER, EVENTS)
  const refs = items[1].imageRefs
  assert.ok(Array.isArray(refs) && refs.length === 1)
  assert.equal(refs[0].attachmentId, 'sha256:abc')
  assert.equal(refs[0].mediaType, 'image/png')
  assert.equal(refs[0].width, 800)
  assert.equal(refs[0].height, 600)
  assert.equal(refs[0].name, 'shot.png')
  // JSON-safe: the Host route serializes these refs.
  assert.deepEqual(JSON.parse(JSON.stringify(refs)), refs)
})

check('fixture: injected and replaced user messages are skipped', () => {
  const { items } = assembleTranscript(HEADER, EVENTS)
  assert.ok(!items.some((item) => item.text.includes('运行时上下文')))
  assert.ok(!items.some((item) => item.text.includes('被替换的旧消息')))
})

check('fixture: tool calls grouped with statuses and titles', () => {
  const { items } = assembleTranscript(HEADER, EVENTS)
  const tool = items[2]
  assert.equal(tool.text, '调用了 2 个工具')
  assert.equal(tool.toolCalls.length, 2)
  assert.equal(tool.toolCalls[0].name, 'read')
  assert.equal(tool.toolCalls[0].title, 'src/a.js')
  assert.equal(tool.toolCalls[0].status, 'ok')
  assert.equal(tool.toolCalls[1].name, 'pwsh')
  assert.equal(tool.toolCalls[1].title, 'Run transcript test')
  assert.equal(tool.toolCalls[1].detail, 'node tools/test-transcript.mjs')
  assert.equal(tool.toolCalls[1].status, 'error')
  const later = items[4]
  assert.equal(later.text, '调用了 1 个工具')
  assert.equal(later.toolCalls[0].title, '**/*.js')
  assert.ok(!('status' in later.toolCalls[0]))
})

check('fixture: assistant model captured, reasoning excluded', () => {
  const { items } = assembleTranscript(HEADER, EVENTS)
  assert.equal(items[3].model, 'm-test-2')
  assert.equal(items[3].provider, 'p-test')
  assert.equal(items[5].text, '完成。')
  assert.ok(!items.some((item) => item.text.includes('先思考一下')))
  assert.ok(!items.some((item) => item.text.includes('总结')))
})

check('fixture: item ids unique and shape valid', () => {
  validateItems(assembleTranscript(HEADER, EVENTS).items)
})

check('fixture: includeTools false removes tool items', () => {
  const { items } = assembleTranscript(HEADER, EVENTS, { includeTools: false })
  assert.deepEqual(
    items.map((item) => item.kind),
    ['user', 'user', 'assistant', 'assistant'],
  )
})

check('fixture: userSourceKinds opt-in keeps injected context', () => {
  const { items } = assembleTranscript(HEADER, EVENTS, { userSourceKinds: ['user', 'runtime-context'] })
  assert.ok(items.some((item) => item.text === '运行时上下文'))
})

check('fixture: maxTextChars clips item text', () => {
  const { items } = assembleTranscript(HEADER, EVENTS, { maxTextChars: 4 })
  for (const item of items) {
    if (item.kind === 'tool') continue
    assert.ok(item.text.length <= 5, `clipped text too long: ${item.text}`)
  }
  assert.ok(items[0].text.endsWith('…'))
})

check('fixture: host route options accepted', () => {
  const folded = assembleTranscript(HEADER, EVENTS, { maxTextChars: 200_000 })
  assert.ok(folded.items.length > 0)
})

check('fixture: malformed input never throws', () => {
  const empty = assembleTranscript(null, null)
  assert.deepEqual(empty.items, [])
  assert.equal(empty.session.id, '')
  const folded = assembleTranscript(HEADER, [
    null,
    42,
    { type: 7 },
    { type: 'user/message', data: null },
    { type: 'assistant/message', data: { message: { content: 'nope' } } },
  ])
  assert.deepEqual(folded.items, [])
})

check('fixture: summarizeForShare counts', () => {
  const summary = summarizeForShare(assembleTranscript(HEADER, EVENTS))
  assert.equal(summary.totalItems, 6)
  assert.deepEqual(summary.counts, { user: 2, assistant: 2, tool: 2, note: 0 })
  assert.equal(summary.images, 1)
  assert.ok(summary.textChars > 0)
  assert.ok(summary.firstUserText.startsWith('你好'))
  assert.equal(summary.title, '最终标题')
})

check('fixture: event type constants', () => {
  assert.equal(EVENT_TYPES.user, 'user/message')
  assert.equal(EVENT_TYPES.assistant, 'assistant/message')
  assert.equal(EVENT_TYPES.toolCall, 'tool/call')
  assert.equal(EVENT_TYPES.toolResult, 'tool/result')
  assert.equal(EVENT_TYPES.title, 'session/title')
})

// ── real session log ───────────────────────────────────────────────────────

function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured)
  return path.join(os.homedir(), '.dsh')
}

/** Every `session.vN.jsonl[.zstd]` log under the sessions root, newest first. */
function listSessionLogs(root) {
  const logs = []
  let projects
  try {
    projects = fs.readdirSync(root, { withFileTypes: true })
  } catch (error) {
    throw new Error(`cannot read ${root}: ${errorText(error)}`)
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(root, project.name)
    let sessions
    try {
      sessions = fs.readdirSync(projectDir, { withFileTypes: true })
    } catch (_error) {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const sessionDir = path.join(projectDir, session.name)
      let files
      try {
        files = fs.readdirSync(sessionDir)
      } catch (_error) {
        continue
      }
      for (const file of files) {
        const match = /^session\.v(\d+)\.jsonl(\.zstd)?$/.exec(file)
        if (match === null) continue
        const full = path.join(sessionDir, file)
        let stat
        try {
          stat = fs.statSync(full)
        } catch (_error) {
          continue
        }
        logs.push({ file: full, zstd: Boolean(match[2]), version: Number(match[1]), mtimeMs: stat.mtimeMs })
      }
    }
  }
  logs.sort((a, b) => b.mtimeMs - a.mtimeMs || b.version - a.version)
  return logs
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Decode a multi-frame zstd file (Node's zstdDecompressSync only reads frame 1). */
function decodeZstdFrames(buffer) {
  const chunks = []
  let pos = 0
  while (pos < buffer.length) {
    const start = buffer.indexOf(ZSTD_MAGIC, pos)
    if (start < 0) break
    let cursor = start
    let decoded = false
    while (cursor < buffer.length) {
      const next = buffer.indexOf(ZSTD_MAGIC, cursor + ZSTD_MAGIC.length)
      const end = next < 0 ? buffer.length : next
      try {
        chunks.push(zlib.zstdDecompressSync(buffer.subarray(start, end)))
        pos = end
        decoded = true
        break
      } catch (_error) {
        if (end >= buffer.length) break
        cursor = end
      }
    }
    if (!decoded) pos = start + ZSTD_MAGIC.length
  }
  return Buffer.concat(chunks)
}

function readLogText(file, zstd) {
  const buffer = fs.readFileSync(file)
  if (!zstd) return buffer.toString('utf8')
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('this Node build has no zstd support (need Node >= 22.15)')
  }
  return decodeZstdFrames(buffer).toString('utf8')
}

function parseLog(text) {
  const lines = text.split('\n').filter((line) => line.startsWith('{'))
  if (lines.length === 0) return null
  let header
  try {
    header = JSON.parse(lines[0])
  } catch (_error) {
    return null
  }
  if (header === null || typeof header !== 'object') return null
  const events = []
  for (const line of lines.slice(1)) {
    try {
      const event = JSON.parse(line)
      if (event !== null && typeof event === 'object') events.push(event)
    } catch (_error) {
      // torn tail while a live session is being written
    }
  }
  return { header, events }
}

function isReplacementEvent(event) {
  const op = event && event.surfaceOp
  return op !== null && typeof op === 'object' && op.op === 'replace'
}

function isHumanUserEvent(event) {
  if (!event || event.type !== EVENT_TYPES.user) return false
  if (isReplacementEvent(event)) return false
  const data = event.data
  if (!data || typeof data !== 'object') return false
  const kind = data.source && typeof data.source.kind === 'string' ? data.source.kind : ''
  if (kind !== '' && kind !== 'user') return false
  const content = Array.isArray(data.content) ? data.content : []
  return (
    content.some((part) => part && part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '') ||
    content.some((part) => part && part.type === 'image')
  )
}

function assistantHasText(event) {
  if (!event || event.type !== EVENT_TYPES.assistant) return false
  if (isReplacementEvent(event)) return false
  const content =
    event.data && event.data.message && Array.isArray(event.data.message.content) ? event.data.message.content : []
  return content.some((part) => part && part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '')
}

function runRealSessionCheck() {
  const name = 'real-session'
  let logs
  try {
    logs = listSessionLogs(path.join(dshHome(), 'sessions'))
  } catch (error) {
    skip(name, `cannot list session logs: ${errorText(error)}`)
    return
  }
  if (logs.length === 0) {
    skip(name, `no session logs under ${path.join(dshHome(), 'sessions')}`)
    return
  }

  let parsed = null
  let used = null
  for (const log of logs) {
    try {
      parsed = parseLog(readLogText(log.file, log.zstd))
    } catch (_error) {
      parsed = null
    }
    if (parsed !== null && parsed.events.length > 0) {
      used = log
      break
    }
    parsed = null
  }
  if (parsed === null || used === null) {
    skip(name, 'no readable session log with events')
    return
  }

  try {
    const folded = assembleTranscript(parsed.header, parsed.events)
    assert.ok(Array.isArray(folded.items), 'items must be an array')
    validateItems(folded.items)

    const lastTitle = parsed.events
      .filter(
        (event) =>
          event &&
          event.type === EVENT_TYPES.title &&
          event.data &&
          typeof event.data.title === 'string' &&
          event.data.title.trim() !== '',
      )
      .pop()
    if (lastTitle !== undefined) assert.equal(folded.session.title, lastTitle.data.title)

    const humanUsers = parsed.events.filter(isHumanUserEvent)
    if (humanUsers.length > 0) {
      assert.ok(
        folded.items.some((item) => item.kind === 'user'),
        `expected a user item from ${humanUsers.length} human user events`,
      )
    }

    const textAssistants = parsed.events.filter(assistantHasText)
    if (textAssistants.length > 0) {
      assert.ok(
        folded.items.some((item) => item.kind === 'assistant'),
        'expected an assistant item',
      )
      assert.equal(typeof folded.session.model, 'string')
    }

    const toolCalls = parsed.events.filter((event) => event && event.type === EVENT_TYPES.toolCall)
    if (toolCalls.length > 0 && folded.items.length > 0) {
      assert.ok(folded.items.some((item) => item.kind === 'tool'))
    }

    const summary = summarizeForShare(folded)
    assert.equal(summary.totalItems, folded.items.length)

    pass(
      `${name}: ${folded.session.id || path.basename(path.dirname(used.file))} items=${folded.items.length} ` +
        `user=${summary.counts.user} assistant=${summary.counts.assistant} tool=${summary.counts.tool} ` +
        `title=${JSON.stringify(folded.session.title)}`,
    )
  } catch (error) {
    fail(name, error)
  }
}

runRealSessionCheck()

console.log('')
console.log(`SUMMARY pass=${passed} fail=${failed} skip=${skipped}`)
if (failed > 0) {
  console.log('transcript test FAILED')
  process.exitCode = 1
} else {
  console.log('transcript test OK')
}
