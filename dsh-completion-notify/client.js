/**
 * Completion Notify — the browser half of `@local/dsh-completion-notify`.
 *
 * Detection and delivery live in the Host half: it watches every Session log
 * event and spawns a hidden OS notifier process, so a finished turn still reaches the
 * user when this page is covered, minimized, or closed.
 *
 * This half only draws the preference row in Settings → General and reports the
 * page's focus, so the Host can stay quiet while the user reads that Session.
 *
 * Built artifact format: the Client module system executes only the factory
 * below and materializes it lazily. React comes from the platform module table.
 *
 * @module @local/dsh-completion-notify/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-completion-notify',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const NS = 'completionNotify'
    const PREF_KEY = 'dsh.completion-notify.v1'
    const ROUTE_STATE = '/completion-notify/state'
    const ROUTE_TEST = '/completion-notify/test'
    const NOTICE_MS = 5000
    const HEARTBEAT_MS = 30000

    const zh = {
      rowTitle: '任务完成与等待确认通知',
      rowDescription:
        '会话跑完任务、或卡在等你授权 / 回答时，由 DSH 主进程弹出系统通知，标题写明是哪个会话。关掉页面也会提醒；你正看着这个会话时不打扰。',
      noticeOn: '已开启：任务完成或等待你确认时会弹出系统通知。',
      noticeOff: '已关闭：不再弹出这些通知。',
      testAction: '发送测试通知',
      testSent: '已发送示例通知；若没出现，请检查 Windows 通知设置或专注助手。',
      testFailed: '发送失败：DSH 主进程的通知通道不可用。',
    }

    const en = {
      rowTitle: 'Notify on completion and approval requests',
      rowDescription:
        'Send an OS notification from the DSH host process when a Session finishes its task or blocks on your approval or answer, titled with that Session. Works with the page covered, minimized, or closed; stays quiet while you look at that Session.',
      noticeOn: 'On: the host process pops a system notification for those events.',
      noticeOff: 'Off: no notifications will be sent.',
      testAction: 'Send a test notification',
      testSent: 'A sample notification was sent; if nothing appeared, check the Windows notification settings or Focus assist.',
      testFailed: 'Could not send: the host notification channel is unavailable.',
    }

    // ── preference, mirrored to the Host ──────────────────────────────────

    function readEnabled() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? 'null')
        if (parsed === null || typeof parsed !== 'object') return true
        if (parsed.enabled !== undefined) return parsed.enabled !== false
        // The two-switch shape this plugin stored earlier: off only if both were off.
        return !(parsed.completes === false && parsed.waiting === false)
      } catch (_error) {
        return true
      }
    }

    let enabled = readEnabled()
    const listeners = new Set()

    /** Tell the Host what changed: `{ enabled?, visible?, focused?, mainSessionId? }`. */
    function postState(patch) {
      const query = new URLSearchParams()
      if (patch.enabled !== undefined) query.set('enabled', patch.enabled ? '1' : '0')
      if (patch.visible !== undefined) query.set('visible', patch.visible ? '1' : '0')
      if (patch.focused !== undefined) query.set('focused', patch.focused ? '1' : '0')
      if (patch.mainSessionId !== undefined) query.set('main', patch.mainSessionId ?? '')
      try {
        void fetch(`${ROUTE_STATE}?${query.toString()}`, { method: 'POST' }).catch(() => {})
      } catch (_error) {
        /* the Host keeps its last known state */
      }
    }

    function setEnabled(next) {
      if (enabled === next) return
      enabled = next
      try {
        window.localStorage.setItem(PREF_KEY, JSON.stringify({ enabled: next }))
      } catch (_error) {
        /* a blocked store keeps the switch working for this page */
      }
      postState({ enabled: next })
      for (const listener of [...listeners]) listener()
    }

    function useEnabled() {
      const [value, setValue] = useState(enabled)
      useEffect(() => {
        const listener = () => setValue(enabled)
        listeners.add(listener)
        listener()
        return () => {
          listeners.delete(listener)
        }
      }, [])
      return value
    }

    /** Ask the Host for one sample notification. */
    async function requestTest() {
      try {
        const response = await fetch(ROUTE_TEST, { method: 'POST' })
        const result = await response.json().catch(() => undefined)
        return result?.ok === true
      } catch (_error) {
        return false
      }
    }

    /** A locale seat that cannot fail: a missing `t` degrades to the key itself. */
    function translateOf(props) {
      return typeof props?.t === 'function' ? props.t : (key) => key
    }

    /** Stand-in for a standard Hook this seat does not supply, keeping call order fixed. */
    function useAbsentSnapshot() {
      return undefined
    }

    /** The Session whose conversation is on screen, from the list's retention. */
    function mainSessionIdOf(byId) {
      if (byId === undefined || byId === null || typeof byId !== 'object') return undefined
      for (const id of Object.keys(byId)) {
        if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
      }
      return undefined
    }

    // ── the Settings → General preference row ─────────────────────────────

    /**
     * One preference row: title, description, switch, and a test button.
     * @param props - slot props; `t` is the bound `completionNotify` dictionary.
     */
    function NotificationRow(props) {
      const t = translateOf(props)
      const on = useEnabled()
      const [notice, setNotice] = useState(null)

      useEffect(() => {
        if (notice === null) return undefined
        const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
        return () => window.clearTimeout(timer)
      }, [notice])

      const toggle = () => {
        const next = !enabled
        setEnabled(next)
        setNotice(next ? t('noticeOn') : t('noticeOff'))
      }

      const test = () => {
        void requestTest().then((sent) => setNotice(sent ? t('testSent') : t('testFailed')))
      }

      return h(
        'div',
        { className: 'cn-row' },
        h(
          'div',
          { className: 'cn-row-text' },
          h('div', { className: 'cn-row-title' }, t('rowTitle')),
          h('div', { className: 'cn-row-description' }, t('rowDescription')),
          notice === null ? null : h('div', { className: 'cn-row-notice', role: 'status', 'aria-live': 'polite' }, notice),
          on ? h('button', { type: 'button', className: 'cn-row-test', onClick: test }, t('testAction')) : null,
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': on,
            'aria-label': t('rowTitle'),
            'data-completion-notify': on ? 'on' : 'off',
            className: 'cn-switch',
            onClick: toggle,
          },
          h('span', { className: 'cn-switch-thumb' }),
        ),
      )
    }

    // ── focus reporter ────────────────────────────────────────────────────

    /**
     * Reports window activation and the visible Session, so the Host can tell
     * "the user is reading this answer" apart from "the user is in another app".
     * @param props - standard `useSessions`.
     */
    function FocusReporter(props) {
      const useList = typeof props?.useSessions === 'function' ? props.useSessions : useAbsentSnapshot
      const sessions = useList((snapshot) => snapshot)
      const mainId = mainSessionIdOf(sessions?.byId)
      const latest = useRef(mainId)
      latest.current = mainId

      useEffect(() => {
        let focused = true
        try {
          focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
        } catch (_error) {
          focused = true
        }
        const report = () =>
          postState({
            enabled,
            visible: document.visibilityState === 'visible',
            focused,
            mainSessionId: latest.current ?? null,
          })
        const onFocus = () => {
          focused = true
          report()
        }
        const onBlur = () => {
          focused = false
          report()
        }
        const onVisibility = () => {
          if (document.visibilityState === 'visible') {
            try {
              focused = typeof document.hasFocus === 'function' ? document.hasFocus() : focused
            } catch (_error) {
              /* keep the last known value */
            }
          }
          report()
        }
        window.addEventListener('focus', onFocus)
        window.addEventListener('blur', onBlur)
        document.addEventListener('visibilitychange', onVisibility)
        report()
        // The Host treats a stale report as "not watching", so keep it fresh even
        // when no focus event fires (the window can stay in the background).
        const heartbeat = window.setInterval(report, HEARTBEAT_MS)
        return () => {
          window.clearInterval(heartbeat)
          window.removeEventListener('focus', onFocus)
          window.removeEventListener('blur', onBlur)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [])

      return null
    }

    // ── styles ────────────────────────────────────────────────────────────

    /**
     * The row matches the shipped General preference rows and the switch copies
     * the host primitive's shape; colour comes from `--dsw-*` tokens only.
     */
    const STYLES = `
.cn-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.cn-row-text{min-width:0}
.cn-row-title{font-size:14px;line-height:20px}
.cn-row-description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.cn-row-notice{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.cn-row-test{align-self:flex-start;margin-top:8px;height:24px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.cn-row-test:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cn-row-test:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.cn-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.cn-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.cn-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.cn-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform .12s ease}
.cn-switch[aria-checked=true] .cn-switch-thumb{background:var(--dsw-alias-label-primary-foreground);transform:translate(16px)}
@media (prefers-reduced-motion:reduce){.cn-switch-thumb{transition:none}}
`

    // ── plugin ────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale']

    /**
     * Contribute the preference row, the focus reporter, and the stylesheet.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'completion-notify: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'completion-notify'
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'completion-notify: styles')

      ctx.effect(
        () =>
          ctx.slots.inject('settings.general.item', () =>
            ctx.slots.register(
              { name: 'settings.general.item', id: 'completion-notify', order: 95, locale: NS, label: () => t('rowTitle') },
              NotificationRow,
            ),
          ),
        'completion-notify: settings row',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'completion-notify.focus', order: 30, locale: NS }, FocusReporter),
          ),
        'completion-notify: focus reporter',
      )
    }

    return { inject, apply }
  },
})
