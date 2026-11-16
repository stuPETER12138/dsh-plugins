/**
 * Usage Stats — the browser half of `@local/dsh-usage-stats`.
 *
 * One left-sidebar entry (`sidebar.panellist`) and one panel (`main`, key
 * `usage-stats`). The panel polls the Host's single read route every few
 * seconds and renders, for the selected range: six totals, a calendar heatmap of
 * daily token usage, the model cost composition, and the sessions that used
 * tokens.
 *
 * The heatmap is HTML and CSS — one cell per local day, one column per week, one
 * row per weekday, shade from the day's share of the busiest day — so there is no
 * chart library, no resize observer and no pointer handling; a cell's details are
 * the browser's native `title`. Colors are `--dsw-*` theme tokens only.
 *
 * Built artifact format: the client module system executes only the factory
 * below and materializes it lazily. React comes from the platform module table.
 *
 * @module @local/dsh-usage-stats/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-usage-stats',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    // ── constants ──────────────────────────────────────────────────────────

    const NS = 'usageStats'
    const PANEL_ID = 'usage-stats'
    const ROUTE = '/dsh-usage-stats'
    /** Poll cadence while the panel is open and visible. */
    const POLL_MS = 5000
    /** The panel opens on the last 90 days; `0` asks the Host for all time. */
    const DEFAULT_DAYS = 90
    /** Range control, in order; `0` asks the Host for all time. */
    const RANGES = [30, 90, 0]
    const RANGE_LABEL = { 30: 'range30', 90: 'range90', 0: 'rangeAll' }
    /** One heatmap column is one Monday-start week. */
    const DAY_MS = 86_400_000
    const WEEK_MS = 7 * DAY_MS
    /** Non-empty cells use this many shades of the accent color. */
    const LEVELS = 4

    // ── copy ───────────────────────────────────────────────────────────────

    const zh = {
      panel: '用量统计',
      title: '用量统计',
      subtitle: '本机会话日志里的 Token 用量与估算成本',
      rangeLabel: '统计范围',
      range30: '30 天',
      range90: '90 天',
      rangeAll: '全部',
      updatedAt: '更新于 {time}',
      scanning: '索引中 {scanned}/{total}',
      scanningShort: '索引中…',
      loading: '正在读取用量统计…',
      loadFailed: '加载失败：{message}',
      retry: '重试',
      emptyTitle: '这段时间没有用量',
      emptyBody: '换一个统计范围，或聊一段之后回来再看。',
      tokens: 'Token 用量',
      tokenBreakdown: '输入 {input} · 输出 {output} · 缓存 命中 {cacheRead}',
      cost: '预估成本',
      requests: '消息数',
      sessions: '会话数',
      activeDays: '活跃天数',
      topModel: '最常用模型',
      heatLow: '少',
      heatHigh: '多',
      modelsTitle: '模型用量',
      modelsNote: '{count} 个模型 · 按 Token 排序',
      modelOther: '其他',
      modelOthers: '{count} 个模型',
      colModel: '模型',
      colTokens: 'Token',
      colCost: '成本',
      colShare: '占比',
      fallbackNote: '部分模型不在内置价目表中，按兜底单价估算。',
      sessionsTitle: '会话用量',
      sessionsNote: '{count} 个会话',
      colSession: '会话',
      colActivity: '最近活动',
      sessionsTruncated: '仅列出最近的 {count} 个会话。',
      untitled: '未命名会话',
      live: '进行中',
      failedLogs: '{count} 个会话日志读不出来，未计入统计。',
      staleHost: 'Host 端还是旧版本，重启 DSH 后再打开这个面板。',
      footer: '数据来自本机会话日志里的 assistant/message.usage，不联网、不上传。',
    }

    const en = {
      panel: 'Usage Stats',
      title: 'Usage Stats',
      subtitle: 'Token usage and estimated cost from this machine\u2019s session logs',
      rangeLabel: 'Range',
      range30: '30 days',
      range90: '90 days',
      rangeAll: 'All',
      updatedAt: 'Updated {time}',
      scanning: 'Indexing {scanned}/{total}',
      scanningShort: 'Indexing…',
      loading: 'Reading usage stats…',
      loadFailed: 'Could not load usage stats: {message}',
      retry: 'Retry',
      emptyTitle: 'No usage in this range',
      emptyBody: 'Try another range, or come back after a conversation.',
      tokens: 'Tokens',
      tokenBreakdown: 'in {input} · out {output} · cache hit {cacheRead}',
      cost: 'Est. cost',
      requests: 'Messages',
      sessions: 'Sessions',
      activeDays: 'Active days',
      topModel: 'Top model',
      heatLow: 'Less',
      heatHigh: 'More',
      modelsTitle: 'Usage by model',
      modelsNote: '{count} models · sorted by tokens',
      modelOther: 'Other',
      modelOthers: '{count} models',
      colModel: 'Model',
      colTokens: 'Tokens',
      colCost: 'Cost',
      colShare: 'Share',
      fallbackNote: 'Some models are not in the built-in price table and use the fallback rate.',
      sessionsTitle: 'Usage by session',
      sessionsNote: '{count} sessions',
      colSession: 'Session',
      colActivity: 'Last activity',
      sessionsTruncated: 'Only the {count} most recent sessions are listed.',
      untitled: 'Untitled session',
      live: 'Live',
      failedLogs: '{count} session logs could not be read and are not counted.',
      staleHost: 'The Host half is an older version. Restart DSH, then reopen this panel.',
      footer: 'Figures come from this machine\u2019s session logs (assistant/message.usage). Nothing is sent anywhere.',
    }

    // ── formatting ─────────────────────────────────────────────────────────

    const EXACT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
    const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
    const ACTIVITY = new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' })

    /** One decimal, with a trailing `.0` removed: 1200 -> "1.2", 2000 -> "2". */
    function trimDecimal(value) {
      const text = value.toFixed(1)
      return text.endsWith('.0') ? text.slice(0, -2) : text
    }

    /** K/M/B so token counts stay short in every locale. */
    function compact(value) {
      const size = Math.abs(value)
      if (size < 1000) return String(Math.round(value))
      if (size < 1e6) return trimDecimal(value / 1e3) + 'K'
      if (size < 1e9) return trimDecimal(value / 1e6) + 'M'
      return trimDecimal(value / 1e9) + 'B'
    }

    const exact = (value) => EXACT.format(Math.round(value))

    /** Money with enough precision for fractions of a cent, never rounded to $0.00. */
    function usd(value) {
      const size = Math.abs(value)
      if (size === 0) return '$0'
      if (size < 0.01) return '$' + value.toFixed(4)
      if (size < 1) return '$' + value.toFixed(3)
      return '$' + value.toFixed(2)
    }

    /** A 0..1 share as a percentage; a real but tiny share never reads as 0%. */
    function percent(fraction) {
      const share = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
      return share === 0 && fraction > 0 ? '<1%' : share + '%'
    }

    const clock = (ms) => CLOCK.format(new Date(ms))
    const activity = (ms) => (typeof ms === 'number' ? ACTIVITY.format(new Date(ms)) : '')

    /** Tooltip for one day; the native `title` needs no component. */
    function dayTip(row) {
      return row.day + ' · ' + compact(row.total) + ' Token · ' + usd(row.costUsd) + ' · ' + exact(row.requests)
    }

    /** Monday 00:00 of the week containing `time`, in local time. */
    function mondayOf(time) {
      const date = new Date(time)
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
      return date
    }

    /**
     * Lay the timeline out as a calendar: one cell per local day, one column per
     * Monday-start week, one row per weekday. Shades are rank-based, like a
     * contribution graph: the busiest quarter of the active days is the darkest,
     * so a single huge day cannot wash every other cell out.
     */
    function buildHeat(timeline) {
      const days = []
      for (const row of timeline) {
        const time = Date.parse(row.day + 'T00:00:00')
        if (Number.isFinite(time)) days.push({ row, time })
      }
      if (days.length === 0) return { columns: 0, cells: [], months: [] }

      const active = days.filter((day) => day.row.total > 0).map((day) => day.row.total).sort((left, right) => left - right)
      const shades = new Map()
      for (const total of active) {
        if (shades.has(total)) continue
        const fraction = active.length === 1 ? 1 : active.lastIndexOf(total) / active.length
        shades.set(total, 1 + Math.min(LEVELS - 1, Math.floor(fraction * LEVELS)))
      }

      const origin = mondayOf(days[0].time)
      const cells = []
      const months = []
      for (const { row, time } of days) {
        const date = new Date(time)
        const column = Math.round((mondayOf(time).getTime() - origin.getTime()) / WEEK_MS)
        cells.push({ day: row.day, row, column, weekday: (date.getDay() + 6) % 7, level: shades.get(row.total) ?? 0 })

        const label = MONTH.format(date)
        const last = months[months.length - 1]
        if (last === undefined) months.push({ label, column })
        else if (last.label !== label && column - last.column >= 2) months.push({ label, column })
      }
      return { columns: cells[cells.length - 1].column + 1, cells, months }
    }

    // ── network ────────────────────────────────────────────────────────────

    async function fetchJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        let message = 'HTTP ' + response.status
        try {
          const body = await response.json()
          if (typeof body?.error?.message === 'string') message = body.error.message
        } catch (_error) {
          /* a body that is not JSON keeps the status text */
        }
        throw new Error(message)
      }
      return response.json()
    }

    // ── icon ───────────────────────────────────────────────────────────────

    /** Sidebar glyph: a three-step bar chart. */
    function UsageStatsIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M2.5 13.5h11' }),
        h('path', { d: 'M4.6 11V7.4M8 11V4.4M11.4 11V6.2' }),
      )
    }

    // ── pieces ─────────────────────────────────────────────────────────────

    function Header(props) {
      const { t, days, onRange, data } = props
      const scanning = data !== null && data.scan.state === 'scanning'
      return h(
        'header',
        { className: 'us-head' },
        h('div', null, h('h1', { className: 'us-title' }, t('title')), h('p', { className: 'us-sub' }, t('subtitle'))),
        h(
          'div',
          { className: 'us-tools' },
          scanning
            ? h(
                'span',
                { className: 'us-scan', 'aria-live': 'polite' },
                data.scan.total > 0
                  ? t('scanning', { scanned: exact(data.scan.scanned), total: exact(data.scan.total) })
                  : t('scanningShort'),
              )
            : null,
          h(
            'div',
            { className: 'us-seg', role: 'group', 'aria-label': t('rangeLabel') },
            RANGES.map((value) =>
              h(
                'button',
                {
                  key: value,
                  type: 'button',
                  className: days === value ? 'is-active' : '',
                  'aria-pressed': days === value,
                  onClick: () => onRange(value),
                },
                t(RANGE_LABEL[value]),
              ),
            ),
          ),
          data === null ? null : h('span', { className: 'us-updated' }, t('updatedAt', { time: clock(data.generatedAt) })),
        ),
      )
    }

    /**
     * The overview card: the calendar on the left, the six figures on the right.
     * Side by side is what keeps the card honest — a short history owns a small
     * grid, and the numbers still fill the width instead of trailing off.
     */
    function Overview(props) {
      const { t, data, rangeLabel } = props
      const totals = data.totals
      const top = data.models[0]
      const activeDays = data.timeline.filter((row) => row.total > 0).length
      const heat = buildHeat(data.timeline)
      const columns = Math.max(1, heat.columns)
      // Few weeks leave room for bigger cells; a year of history still fits.
      const size = columns > 26 ? 14 : columns > 13 ? 20 : 30
      const gap = size === 14 ? 3 : 4
      const figures = [
        {
          label: t('tokens') + ' · ' + rangeLabel,
          value: compact(totals.tokens.total),
          note: t('tokenBreakdown', {
            input: compact(totals.tokens.input),
            output: compact(totals.tokens.output),
            cacheRead: compact(totals.tokens.cacheRead),
          }),
        },
        { label: t('cost'), value: usd(totals.costUsd) },
        { label: t('requests'), value: exact(totals.requests) },
        { label: t('sessions'), value: exact(totals.sessions) },
        { label: t('activeDays'), value: exact(activeDays) },
        { label: t('topModel'), value: top === undefined ? '—' : top.model, note: top === undefined ? '' : top.provider, name: true },
      ]
      return h(
        'section',
        { className: 'us-card us-heat-card us-overview' },
        h(
          'div',
          { className: 'us-overview-chart' },
          h(
            'div',
            { className: 'us-heat-scroll' },
            h(
              'div',
              {
                className: 'us-heat',
                style: {
                  '--us-cell': size + 'px',
                  gridTemplateColumns: 'repeat(' + columns + ', ' + size + 'px)',
                  gridTemplateRows: 'auto repeat(7, ' + size + 'px)',
                  gap: gap + 'px',
                },
              },
              heat.months.map((month) =>
                h('span', { key: month.column, className: 'us-heat-month', style: { gridColumn: month.column + 1, gridRow: 1 } }, month.label),
              ),
              heat.cells.map((cell) =>
                h('span', {
                  key: cell.day,
                  className: 'us-heat-cell is-l' + cell.level,
                  style: { gridColumn: cell.column + 1, gridRow: cell.weekday + 2 },
                  title: dayTip(cell.row),
                }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'us-heat-foot' },
            h('span', null, t('heatLow')),
            [0, 1, 2, 3, 4].map((level) => h('i', { key: level, className: 'us-heat-cell is-l' + level })),
            h('span', null, t('heatHigh')),
          ),
        ),
        h(
          'div',
          { className: 'us-figures' },
          figures.map((figure) =>
            h(
              'div',
              { className: 'us-figure', key: figure.label },
              h('div', { className: 'us-figure-label' }, figure.label),
              h('div', { className: 'us-figure-value' + (figure.name === true ? ' is-name' : ''), title: figure.name === true ? figure.value : undefined }, figure.value),
              figure.note === undefined || figure.note === '' ? null : h('div', { className: 'us-figure-note' }, figure.note),
            ),
          ),
        ),
      )
    }

    /**
     * Tokens by model, busiest first. A model below 1% of the range's tokens is
     * noise in a list this long, so those rows fold into one "other" row that
     * keeps their tokens, cost and count readable.
     */
    function Models(props) {
      const { t, data } = props
      const models = data.models
      if (models.length === 0) return null
      const total = models.reduce((sum, model) => sum + model.tokens.total, 0)
      const ordered = [...models].sort((left, right) => right.tokens.total - left.tokens.total)
      const share = (model) => (total > 0 ? model.tokens.total / total : 1)
      const kept = ordered.filter((model) => share(model) >= 0.01)
      const folded = kept.length > 0 ? ordered.filter((model) => share(model) < 0.01) : []
      if (folded.length > 0) {
        kept.push({
          key: 'other',
          model: t('modelOther'),
          provider: t('modelOthers', { count: exact(folded.length) }),
          title: folded.map((model) => model.key).join(', '),
          tokens: { total: folded.reduce((sum, model) => sum + model.tokens.total, 0) },
          costUsd: folded.reduce((sum, model) => sum + model.costUsd, 0),
        })
      }
      return h(
        'section',
        { className: 'us-card us-models' },
        h(
          'div',
          { className: 'us-card-head' },
          h('h2', { className: 'us-card-title' }, t('modelsTitle')),
          h('span', { className: 'us-card-note' }, t('modelsNote', { count: exact(models.length) })),
        ),
        h(
          'div',
          { className: 'us-rows' },
          h(
            'div',
            { className: 'us-row us-row-head' },
            h('span', null, t('colModel')),
            h('span', { className: 'us-num' }, t('colTokens')),
            h('span', { className: 'us-num' }, t('colCost')),
            h('span', { className: 'us-num' }, t('colShare')),
          ),
          kept.map((model) =>
            h(
              'div',
              { className: 'us-row', key: model.key },
              h(
                'span',
                { className: 'us-name', title: model.title ?? model.key },
                h('span', { className: 'us-trunc' }, model.model),
                model.provider === '' ? null : h('span', { className: 'us-provider' }, model.provider),
              ),
              h('span', { className: 'us-num us-muted' }, compact(model.tokens.total)),
              h('span', { className: 'us-num' }, usd(model.costUsd)),
              h('span', { className: 'us-num us-muted' }, percent(total > 0 ? model.tokens.total / total : 1)),
            ),
          ),
        ),
        models.some((model) => !model.priced) ? h('p', { className: 'us-note' }, t('fallbackNote')) : null,
      )
    }

    function Sessions(props) {
      const { t, data } = props
      const sessions = data.sessions
      return h(
        'section',
        { className: 'us-card us-sessions' },
        h(
          'div',
          { className: 'us-card-head' },
          h('h2', { className: 'us-card-title' }, t('sessionsTitle')),
          h('span', { className: 'us-card-note' }, t('sessionsNote', { count: exact(data.totals.sessions) })),
        ),
        sessions.length === 0
          ? null
          : h(
              'div',
              { className: 'us-rows us-scroll-body' },
              h(
                'div',
                { className: 'us-row us-row-head' },
                h('span', null, t('colSession')),
                h('span', { className: 'us-num' }, t('colTokens')),
                h('span', { className: 'us-num' }, t('colCost')),
                h('span', { className: 'us-num' }, t('colActivity')),
              ),
              sessions.map((session) =>
                h(
                  'div',
                  { className: 'us-row', key: session.id },
                  h(
                    'span',
                    { className: 'us-name', title: session.title || session.id },
                    session.live ? h('i', { className: 'us-live', title: t('live') }) : null,
                    h('span', { className: 'us-trunc' }, session.title || t('untitled')),
                  ),
                  h('span', { className: 'us-num us-muted' }, compact(session.tokens.total)),
                  h('span', { className: 'us-num' }, usd(session.costUsd)),
                  h('span', { className: 'us-num us-muted' }, activity(session.lastActivity)),
                ),
              ),
            ),
        data.totals.sessions > sessions.length
          ? h('p', { className: 'us-note' }, t('sessionsTruncated', { count: exact(sessions.length) }))
          : null,
      )
    }

    // ── page ───────────────────────────────────────────────────────────────

    function UsageStatsPage({ t }) {
      const [days, setDays] = useState(DEFAULT_DAYS)
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [attempt, setAttempt] = useState(0)

      // One request per poll: the Host re-scans on its own schedule, so the panel
      // only has to keep its copy of the payload recent.
      useEffect(() => {
        let disposed = false
        let timer = 0
        const run = async () => {
          if (!document.hidden) {
            try {
              const body = await fetchJson(ROUTE + '?days=' + days)
              if (!disposed) {
                setData(body)
                setError(null)
              }
            } catch (failure) {
              if (!disposed) setError(String(failure?.message ?? failure))
            }
          }
          if (!disposed) timer = window.setTimeout(run, POLL_MS)
        }
        run()
        return () => {
          disposed = true
          window.clearTimeout(timer)
        }
      }, [days, attempt])

      const scanning = data !== null && data.scan.state === 'scanning'
      const rangeLabel = t(RANGE_LABEL[days])

      let body
      if (data === null) {
        body =
          error === null
            ? h('p', { className: 'us-state' }, t('loading'))
            : h(
                'div',
                { className: 'us-state' },
                h('p', { className: 'us-state-title' }, t('loadFailed', { message: error })),
                h('button', { type: 'button', className: 'us-button', onClick: () => setAttempt(attempt + 1) }, t('retry')),
              )
      } else if (!Array.isArray(data.timeline)) {
        // A browser refresh can outrun a Host restart; say so instead of crashing.
        body = h('p', { className: 'us-state' }, t('staleHost'))
      } else if (data.totals.tokens.total === 0 && data.totals.requests === 0) {
        body = scanning
          ? h('p', { className: 'us-state' }, t('scanningShort'))
          : h(
              'div',
              { className: 'us-state' },
              h('p', { className: 'us-state-title' }, t('emptyTitle')),
              h('p', { className: 'us-state-body' }, t('emptyBody')),
            )
      } else {
        body = h(React.Fragment, null, h(Overview, { t, data, rangeLabel }), h(Models, { t, data }), h(Sessions, { t, data }))
      }

      return h(
        'section',
        { className: 'us-page', 'data-usage-stats': 'true' },
        h(
          'div',
          { className: 'us-scroll' },
          h(
            'div',
            { className: 'us-content' },
            h(Header, { t, days, onRange: setDays, data }),
            data !== null && data.scan.failed > 0 ? h('p', { className: 'us-note' }, t('failedLogs', { count: exact(data.scan.failed) })) : null,
            data !== null && data.scan.error !== null ? h('p', { className: 'us-note' }, data.scan.error) : null,
            data !== null && error !== null ? h('p', { className: 'us-note' }, t('loadFailed', { message: error })) : null,
            body,
            h('footer', { className: 'us-foot' }, t('footer')),
          ),
        ),
      )
    }

    // ── styles ─────────────────────────────────────────────────────────────

    /** Plugin-owned global stylesheet: colors come from `--dsw-*` tokens only. */
    const STYLES = `
.us-page{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.us-scroll{flex:1;min-height:0;overflow:auto}
.us-content{max-width:1040px;margin:0 auto;padding:24px clamp(20px,4vw,40px) 48px}
.us-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:18px}
.us-title{margin:0;font-size:22px;font-weight:600;line-height:30px}
.us-sub{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.us-tools{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.us-updated{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.us-scan{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.us-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm)}
.us-seg button{height:26px;padding:0 10px;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s}
.us-seg button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.us-seg button.is-active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}
.us-card{margin-bottom:14px;padding:16px 18px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.us-card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;margin-bottom:14px}
.us-card-title{margin:0;font-size:14px;font-weight:600;line-height:22px}
.us-card-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.us-overview{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,480px);gap:clamp(24px,4vw,56px);align-items:center}
.us-overview-chart{display:flex;flex-direction:column;align-items:center;gap:14px;min-width:0}
.us-figures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px;align-content:center}
.us-figure{min-width:0}
.us-figure-label{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.us-figure-value{margin-top:2px;font-size:26px;font-weight:600;line-height:34px;letter-spacing:-.01em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.us-figure-value.is-name{font-size:16px;line-height:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.us-figure-note{margin-top:2px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:17px;word-break:keep-all}
.us-heat-scroll{max-width:100%;overflow-x:auto;padding-bottom:2px}
.us-heat{display:grid;justify-content:center;width:max-content;margin:0 auto}
.us-heat-month{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap;pointer-events:none}
.us-heat-cell{display:block;width:var(--us-cell,14px);height:var(--us-cell,14px);border-radius:2px;background:var(--dsw-alias-bg-layer-2)}
.us-heat-cell.is-l1{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,var(--dsw-alias-bg-layer-1))}
.us-heat-cell.is-l2{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-bg-layer-1))}
.us-heat-cell.is-l3{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 70%,var(--dsw-alias-bg-layer-1))}
.us-heat-cell.is-l4{background:var(--dsw-alias-state-business-primary)}
.us-heat-foot{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.us-heat-foot .us-heat-cell{width:10px;height:10px}
.us-heat-foot span:first-child{margin-right:2px}
.us-heat-foot span:last-child{margin-left:2px}
.us-rows{display:flex;flex-direction:column}
.us-row{display:grid;grid-template-columns:minmax(0,1fr) 84px 84px 56px;align-items:center;gap:12px;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l2);font-size:13px;line-height:20px}
.us-row-head{padding:0 0 6px;border-top:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.us-sessions .us-row{grid-template-columns:minmax(0,1fr) 84px 84px 128px}
.us-name{display:flex;align-items:center;gap:6px;min-width:0}
.us-trunc{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.us-provider{margin-left:6px;color:var(--dsw-alias-label-caption);font-size:11px;font-style:normal;white-space:nowrap}
.us-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.us-muted{color:var(--dsw-alias-label-tertiary)}
.us-live{display:inline-block;flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.us-scroll-body{max-height:340px;overflow:auto;scrollbar-gutter:stable}
.us-note{margin:10px 0 0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:17px}
.us-state{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:0;padding:28px 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.us-state-title{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;line-height:22px}
.us-state-body{margin:0;max-width:460px}
.us-button{height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background .15s}
.us-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.us-foot{margin-top:18px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:17px}
.us-page :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
@media (width<=900px){.us-overview{grid-template-columns:minmax(0,1fr);gap:20px}.us-figures{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (width<=700px){.us-content{padding-bottom:32px}.us-figure-value{font-size:22px;line-height:28px}.us-figures{grid-template-columns:repeat(2,minmax(0,1fr))}}
`

    // ── plugin ─────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-stats: dictionaries')

      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = PANEL_ID
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'usage-stats: styles')

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => t('panel') }, UsageStatsIcon),
      )
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, UsageStatsPage))
    }

    return { inject, apply }
  },
})
