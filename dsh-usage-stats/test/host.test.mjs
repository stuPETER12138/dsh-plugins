/**
 * Host-half tests for the resource and cleanup sections.
 *
 * Hermetic: every test builds its own temporary Harness home, so nothing reads
 * or writes the real `~/.dsh`. The stub context mounts the real plugin and calls
 * the registered HTTP handlers, which exercises the same code path the panel
 * uses — the payload shape, the dry run, and every refusal on the delete route.
 *
 * Run: node --test dsh-usage-stats/test/host.test.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, writeFile, utimes } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'
import { deleteSessionDirs, scanSessions, selectCleanup } from '../storage.js'

const DAY = 86_400_000

/** One session directory holding one log file of `bytes` bytes. */
async function makeSession(home, id, { bytes, ageDays }) {
  const dir = path.join(home, 'sessions', '--proj-a--', id)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  await writeFile(file, Buffer.alloc(bytes, 0x61))
  const when = new Date(Date.now() - ageDays * DAY)
  await utimes(file, when, when)
  return { id, dir, file }
}

function snapshotFor(home, session) {
  return {
    header: { id: session.id, createdAt: 0 },
    revision: 'rev-' + session.id,
    formatStatus: 'current',
    location: { kind: 'jsonl', path: path.join(home, 'sessions', '--proj-a--', session.id, 'session.v4.jsonl.zstd') },
  }
}

/** A context stub with only what the Host half touches. */
function createCtx({ snapshots, archivedIds, sessions = [] }) {
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name === 'sessionPersistence') return { list: async () => snapshots }
      if (name === 'workspaceRegistry') return { archivedSessionIds: archivedIds }
      return undefined
    },
    sessions: { list: () => sessions },
    effect(run) {
      run()
      return () => {}
    },
    webServer: {
      register({ path: routePath, handler }) {
        routes.set(routePath, handler)
      },
    },
  }
  return { ctx, routes }
}

/** Call one registered route the way the Web server would. */
async function call(handler, options = {}) {
  const request = new EventEmitter()
  request.url = options.url ?? '/dsh-usage-stats'
  request.method = options.method ?? 'GET'
  request.headers = { host: '127.0.0.1:9', ...(options.headers ?? {}) }
  request.socket = { remoteAddress: '127.0.0.1' }

  const response = {
    statusCode: 0,
    text: '',
    writeHead(status) {
      this.statusCode = status
    },
    end(text) {
      this.text = text ?? ''
    },
  }

  const pending = handler(request, response)
  if (options.body !== undefined) {
    request.emit('data', Buffer.from(JSON.stringify(options.body)))
    request.emit('end')
  }
  await pending
  return { status: response.statusCode, json: response.text === '' ? null : JSON.parse(response.text) }
}

/** Build a home with three archived sessions: two old, one recent. */
async function createHome(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'usage-stats-test-'))
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const home = path.join(root, 'home')
  const old = await makeSession(home, 'session-aaaaaaaa-0000-0000-0000-000000000001', { bytes: 2000, ageDays: 100 })
  const older = await makeSession(home, 'session-bbbbbbbb-0000-0000-0000-000000000002', { bytes: 5000, ageDays: 95 })
  const recent = await makeSession(home, 'session-cccccccc-0000-0000-0000-000000000003', { bytes: 1000, ageDays: 1 })
  // An attachment tree, to prove the extra data directories are measured too.
  const attachment = path.join(home, 'attachments', 'v1', 'objects', 'ab', 'abcdef')
  await mkdir(path.dirname(attachment), { recursive: true })
  await writeFile(attachment, Buffer.alloc(400, 0x62))
  return { home, sessions: [old, older, recent] }
}

test('payload carries resources, disk totals and the 90-day plan', async (t) => {
  const { home, sessions } = await createHome(t)
  process.env.DSH_HOME = home
  const snapshots = sessions.map((session) => snapshotFor(home, session))
  const { ctx, routes } = createCtx({
    snapshots,
    archivedIds: sessions.map((session) => session.id),
  })
  apply(ctx, {})
  t.after(() => {
    delete process.env.DSH_HOME
  })

  const { status, json } = await call(routes.get('/dsh-usage-stats'), { url: '/dsh-usage-stats?days=7' })
  assert.equal(status, 200)
  assert.equal(json.storage.sessions, 3)
  assert.equal(json.storage.bytes, 8000)
  assert.equal(json.storage.files, 3)
  assert.equal(json.storage.extras.find((row) => row.key === 'attachments').bytes, 400)

  assert.equal(json.cleanup.days, 90)
  assert.equal(json.cleanup.total.count, 2)
  assert.equal(json.cleanup.total.bytes, 7000)
  assert.deepEqual(
    json.cleanup.candidates.map((candidate) => candidate.id),
    [sessions[1].id, sessions[0].id],
    'largest eligible session first',
  )
  assert.equal(json.cleanup.skipped.recent, 1)

  // Host process and machine figures are always present; the app tree is not
  // available outside Electron.
  assert.ok(json.resources.host.memory.rss > 0)
  assert.ok(json.resources.system.totalBytes > 0)
  assert.ok(json.resources.host.cpu.cores >= 1)
  assert.equal(json.resources.app, null)
})

test('the dry-run route answers the same plan as the payload', async (t) => {
  const { home, sessions } = await createHome(t)
  process.env.DSH_HOME = home
  const { ctx, routes } = createCtx({
    snapshots: sessions.map((session) => snapshotFor(home, session)),
    archivedIds: sessions.map((session) => session.id),
  })
  apply(ctx, { cleanup: { days: 90 } })
  t.after(() => {
    delete process.env.DSH_HOME
  })

  const { status, json } = await call(routes.get('/dsh-usage-stats/cleanup'))
  assert.equal(status, 200)
  assert.equal(json.cleanup.total.count, 2)
  assert.equal(json.storage.bytes, 8000)
})

test('a delete without confirmation is refused', async (t) => {
  const { home, sessions } = await createHome(t)
  process.env.DSH_HOME = home
  const { ctx, routes } = createCtx({
    snapshots: sessions.map((session) => snapshotFor(home, session)),
    archivedIds: sessions.map((session) => session.id),
  })
  apply(ctx, {})
  t.after(() => {
    delete process.env.DSH_HOME
  })

  const { status, json } = await call(routes.get('/dsh-usage-stats/cleanup'), {
    method: 'POST',
    body: { ids: [sessions[0].id] },
  })
  assert.equal(status, 400)
  assert.equal(json.error.code, 'confirmation-required')
  assert.equal((await readdir(sessions[0].dir)).length, 1, 'nothing was removed')
})

test('recent, unknown and live sessions are all refused', async (t) => {
  const { home, sessions } = await createHome(t)
  process.env.DSH_HOME = home
  const [old, older, recent] = sessions
  const { ctx, routes } = createCtx({
    snapshots: sessions.map((session) => snapshotFor(home, session)),
    archivedIds: sessions.map((session) => session.id),
    sessions: [{ id: old.id }],
  })
  apply(ctx, {})
  t.after(() => {
    delete process.env.DSH_HOME
  })

  const recentCall = await call(routes.get('/dsh-usage-stats/cleanup'), {
    method: 'POST',
    body: { ids: [recent.id], confirm: true },
  })
  assert.equal(recentCall.status, 409)
  assert.deepEqual(recentCall.json.refused, [recent.id])

  const liveCall = await call(routes.get('/dsh-usage-stats/cleanup'), {
    method: 'POST',
    body: { ids: [old.id], confirm: true },
  })
  assert.equal(liveCall.status, 409)
  assert.deepEqual(liveCall.json.refused, [old.id])

  const unknownCall = await call(routes.get('/dsh-usage-stats/cleanup'), {
    method: 'POST',
    body: { ids: ['session-nope'], confirm: true },
  })
  assert.equal(unknownCall.status, 409)
  assert.deepEqual(unknownCall.json.refused, ['session-nope'])

  // The eligible session never got deleted by those refusals.
  const scan = await scanSessions(path.join(home, 'sessions'))
  assert.equal(scan.sessions.length, 3)
  assert.ok(older.id.length > 0)
})

test('a confirmed delete removes only the eligible sessions', async (t) => {
  const { home, sessions } = await createHome(t)
  process.env.DSH_HOME = home
  const [old, older, recent] = sessions
  const { ctx, routes } = createCtx({
    snapshots: sessions.map((session) => snapshotFor(home, session)),
    archivedIds: sessions.map((session) => session.id),
  })
  apply(ctx, {})
  t.after(() => {
    delete process.env.DSH_HOME
  })

  const { status, json } = await call(routes.get('/dsh-usage-stats/cleanup'), {
    method: 'POST',
    body: { ids: [old.id, older.id], confirm: true },
  })
  assert.equal(status, 200)
  assert.equal(json.deleted.length, 2)
  assert.equal(json.failed.length, 0)
  assert.equal(json.freedBytes, 7000)
  assert.equal(json.storage.sessions, 1)
  assert.equal(json.cleanup.total.count, 0)

  const remaining = await scanSessions(path.join(home, 'sessions'))
  assert.deepEqual(remaining.sessions.map((session) => session.id), [recent.id])
})

test('selectCleanup excludes anything written inside the window', () => {
  const now = Date.now()
  const sessions = [
    { id: 'old', bytes: 10, files: 1, lastWrite: now - 91 * DAY, group: 'g', dir: 'd' },
    { id: 'edge', bytes: 20, files: 1, lastWrite: now - 90 * DAY + 60_000, group: 'g', dir: 'd' },
    { id: 'exact', bytes: 30, files: 1, lastWrite: now - 90 * DAY - 60_000, group: 'g', dir: 'd' },
  ]
  const plan = selectCleanup({ sessions, archivedIds: ['old', 'edge', 'exact'], liveIds: [], days: 90, now })
  assert.deepEqual(plan.candidates.map((candidate) => candidate.id).sort(), ['exact', 'old'])
  assert.equal(plan.skipped.recent, 1)
  assert.equal(plan.archived.sessions, 3)

  const unarchived = selectCleanup({ sessions, archivedIds: ['old'], liveIds: [], days: 90, now })
  assert.deepEqual(unarchived.candidates.map((candidate) => candidate.id), ['old'])
  assert.equal(unarchived.archived.sessions, 1)
})

test('deleteSessionDirs refuses paths outside the scanned root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'usage-stats-guard-'))
  const sessionsRoot = path.join(root, 'sessions')
  await mkdir(path.join(sessionsRoot, '--g--', 'session-1'), { recursive: true })
  await writeFile(path.join(sessionsRoot, '--g--', 'session-1', 'session.v4.jsonl.zstd'), 'x')
  const scan = await scanSessions(sessionsRoot)

  const forged = [{ id: 'evil', dir: path.join(root, 'precious'), bytes: 1, files: 1, group: 'g', lastWrite: 0 }]
  await mkdir(path.join(root, 'precious'), { recursive: true })
  await writeFile(path.join(root, 'precious', 'keep.txt'), 'keep')

  const result = await deleteSessionDirs({ root: sessionsRoot, sessions: forged, ids: ['evil'] })
  assert.deepEqual(result.deleted, [])
  assert.equal(result.failed[0].error, 'outside-root')
  assert.equal((await readdir(path.join(root, 'precious'))).length, 1, 'an unscanned path is never touched')

  const clean = await deleteSessionDirs({ root: scan.root, sessions: scan.sessions, ids: ['session-1', 'ghost'] })
  assert.equal(clean.deleted.length, 1)
  assert.equal(clean.failed[0].error, 'unknown-session')
  await rm(root, { recursive: true, force: true })
})
