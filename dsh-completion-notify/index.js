/**
 * Host half of the Completion Notify bundle.
 *
 * Everything that matters happens here: the browser cannot be trusted to report
 * a finished turn (it may be hidden, occluded, or closed), and an Electron
 * renderer's `Notification` is dropped in exactly those states. So the Host
 * subscribes to the Session log and spawns a detached OS notifier:
 *
 *   turn/end (completed) → 「会话名」任务完成
 *   turn/end (error)     → 「会话名」任务出错
 *   turn/end (other)     → 「会话名」任务中断
 *   approval/asked       → 「会话名」等你授权
 *   user-questions/request → 「会话名」等你回答 (observation only)
 *
 * Windows toasts come from `powershell.exe` with the shell's registered
 * AppUserModelID; macOS uses `osascript`, Linux `notify-send`.
 *
 * The browser half only draws the Settings switch and reports the page's focus,
 * so the Host can stay quiet while the user is reading that very Session.
 *
 * @module @local/dsh-completion-notify
 */

import { spawn } from 'node:child_process'

const ROUTE_STATE = '/completion-notify/state'
const ROUTE_TEST = '/completion-notify/test'
/** Registered AppUserModelID of the desktop shell; Windows toasts need one. */
const WINDOWS_APP_ID = 'electron.app.DeepSeek Harness'
const MAX_LABEL = 18
const TOAST_TIMEOUT_MS = 8000
const DEDUPE_MS = 10000
/** A browser report older than this no longer means "the user is looking". */
const STATE_FRESH_MS = 90 * 1000

/** Live state shared by the event listeners and the browser-facing routes. */
const state = {
  enabled: true,
  visible: true,
  focused: true,
  mainSessionId: null,
  updatedAt: 0,
}

let logger = console

function log(message) {
  try {
    if (typeof logger?.info === 'function') logger.info(`[completion-notify] ${message}`)
    else console.log(`[completion-notify] ${message}`)
  } catch (_error) {
    /* logging must never break a notification */
  }
}

// ── delivery ──────────────────────────────────────────────────────────────

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** The detached helper for this platform, or undefined when there is none. */
function notifierCommand(title, body) {
  if (process.platform === 'win32') {
    const xml =
      '<toast><visual><binding template="ToastGeneric">' +
      `<text>${escapeXml(title)}</text><text>${escapeXml(body)}</text>` +
      '</binding></visual></toast>'
    const script = [
      "$ErrorActionPreference = 'Stop'",
      // A desktop app may only toast with a registered AppUserModelID when its
      // own process claims that id; PowerShell has to claim it explicitly.
      '$signature = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class DshAumid {',
      '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
      '  public static extern int SetCurrentProcessExplicitAppUserModelID(string appId);',
      '}',
      '"@',
      'Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null',
      `try { [DshAumid]::SetCurrentProcessExplicitAppUserModelID(${psQuote(WINDOWS_APP_ID)}) | Out-Null } catch { }`,
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null',
      '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null',
      '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
      `$xml.LoadXml(${psQuote(xml)})`,
      '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psQuote(WINDOWS_APP_ID)}).Show($toast)`,
    ].join('\r\n')
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    }
  }
  if (process.platform === 'darwin') {
    const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Glass"`
    return { command: 'osascript', args: ['-e', script] }
  }
  if (process.platform === 'linux') return { command: 'notify-send', args: [title, body] }
  return undefined
}

/** Run one notifier to completion; false when it could not be spawned/ended well. */
function runNotifier(command, args) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch (_error) {
          /* already gone */
        }
        finish(false)
      }, TOAST_TIMEOUT_MS)
      child.on('error', (error) => {
        clearTimeout(timer)
        log(`${command} failed: ${error.message}`)
        finish(false)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) log(`${command} exited ${String(code)}`)
        finish(code === 0)
      })
    } catch (error) {
      log(`${command} spawn error: ${String(error)}`)
      finish(false)
    }
  })
}

/** One notification at a time: concurrent turns must not start N helpers. */
const queue = []
const shown = new Map()
let draining = false

function enqueue(title, body) {
  if (state.enabled !== true) return
  const now = Date.now()
  for (const [key, at] of shown) if (now - at > DEDUPE_MS) shown.delete(key)
  if (shown.has(title)) return
  shown.set(title, now)
  queue.push({ title, body })
  if (!draining) void drain()
}

async function drain() {
  draining = true
  try {
    while (queue.length > 0) {
      const item = queue.shift()
      const command = notifierCommand(item.title, item.body)
      if (command !== undefined) await runNotifier(command.command, command.args)
    }
  } finally {
    draining = false
  }
}

// ── Session facts ─────────────────────────────────────────────────────────

const labels = new Map()

function sessionIdOf(session) {
  const id = session?.header?.id ?? session?.id
  return typeof id === 'string' ? id : undefined
}

/** The Session's durable title, else its working directory, else a short id. */
function longLabel(ctx, session) {
  try {
    const titles = typeof ctx?.get === 'function' ? ctx.get('sessionTitle') : undefined
    const snapshot = typeof titles?.get === 'function' ? titles.get(session) : undefined
    const title = typeof snapshot?.title === 'string' ? snapshot.title.trim() : ''
    if (title !== '') return title
  } catch (_error) {
    /* fall through */
  }
  const cwd = session?.header?.cwd
  const directory = typeof cwd === 'string' ? cwd.split(/[\\/]+/).filter((part) => part !== '').pop() : undefined
  if (typeof directory === 'string' && directory !== '') return directory
  const id = sessionIdOf(session)
  return typeof id === 'string' ? id.slice(-6) : '未命名会话'
}

/** Cached short label: folding a Session log is not work to repeat per turn. */
function shortLabel(ctx, session) {
  const id = sessionIdOf(session)
  const cached = id === undefined ? undefined : labels.get(id)
  if (cached !== undefined) return cached
  const label = longLabel(ctx, session)
  const short = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL)}…` : label
  if (id !== undefined) {
    if (labels.size > 64) labels.clear()
    labels.set(id, short)
  }
  return short
}

/** True while the user has this exact Session in front of them. */
function watching(sessionId) {
  const fresh = state.updatedAt !== 0 && Date.now() - state.updatedAt < STATE_FRESH_MS
  return fresh && state.visible === true && state.focused === true && state.mainSessionId !== null && state.mainSessionId === sessionId
}

/** Fold one Session log event into a notification. */
function handleSessionEvent(ctx, session, event) {
  const type = event?.type
  if (type !== 'turn/end' && type !== 'approval/asked') return
  if (session?.header?.origin === 'subagent') return
  const sessionId = sessionIdOf(session)
  const label = shortLabel(ctx, session)

  if (type === 'approval/asked') {
    const toolName = typeof event.data?.toolName === 'string' ? event.data.toolName : ''
    enqueue(`「${label}」等你授权`, toolName === '' ? '有工具请求权限，回到 DSH 处理。' : `${toolName} 请求权限，回到 DSH 处理。`)
    return
  }

  if (watching(sessionId)) return
  const kind = event.data?.reason?.kind
  if (kind === 'completed') enqueue(`「${label}」任务完成`, '回复结束，回到 DSH 查看。')
  else if (kind === 'error') enqueue(`「${label}」任务出错`, '本轮执行出错，回到 DSH 查看。')
  else enqueue(`「${label}」任务中断`, `本轮结束（${String(kind ?? '未知原因')}）。`)
}

// ── browser routes ────────────────────────────────────────────────────────

function reply(response, payload) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

/**
 * `POST /completion-notify/state?enabled=1&visible=1&focused=0&main=<id>` —
 * the browser reports the switch and focus; a GET reads the state back.
 */
function handleState(request, response) {
  if (request.method !== 'POST') {
    reply(response, { ...state })
    return
  }
  const query = new URL(request.url ?? '/', 'http://localhost').searchParams
  const flag = (name) => (query.get(name) === '1' ? true : query.get(name) === '0' ? false : undefined)
  const enabledFlag = flag('enabled')
  const visibleFlag = flag('visible')
  const focusedFlag = flag('focused')
  if (enabledFlag !== undefined) state.enabled = enabledFlag
  if (visibleFlag !== undefined) state.visible = visibleFlag
  if (focusedFlag !== undefined) state.focused = focusedFlag
  const main = query.get('main')
  if (main !== null) state.mainSessionId = main === '' ? null : main
  state.updatedAt = Date.now()
  reply(response, { ok: true })
}

/** One sample toast for the settings row. */
function handleTest(request, response) {
  const wasEnabled = state.enabled
  state.enabled = true
  enqueue('「示例会话」任务完成', '通知已开启：任务完成时会这样提醒你。')
  state.enabled = wasEnabled
  reply(response, { ok: true })
}

/** Services this Host plugin needs before it activates. */
export const inject = ['webServer']

/**
 * Subscribe to Session events and publish the browser-facing routes.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  if (ctx.logger !== undefined) logger = ctx.logger

  ctx.on('session/event', (session, event) => {
    try {
      handleSessionEvent(ctx, session, event)
    } catch (error) {
      log(`handler error: ${String(error)}`)
    }
  })

  // A human question blocks the turn like an approval does. Observation only:
  // the waterfall always continues.
  ctx.on('user-questions/request', function (request, next) {
    try {
      const agent = this !== undefined && this !== null ? this.agent : undefined
      if (agent !== undefined) enqueue(`「${shortLabel(ctx, agent.session)}」等你回答`, '有提问等你回答，回到 DSH 处理。')
    } catch (_error) {
      /* never block the question */
    }
    return next()
  })

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE_STATE, handler: handleState }),
    'completion-notify: state route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE_TEST, handler: handleTest }),
    'completion-notify: test route',
  )
}
