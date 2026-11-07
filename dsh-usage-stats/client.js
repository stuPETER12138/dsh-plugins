/**
 * Usage Stats — the browser half of `@local/dsh-usage-stats`.
 *
 * Registers:
 *  - one left-sidebar panel entry (`sidebar.panellist`) whose icon opens the panel;
 *  - the panel itself as the root `main` panel of that id (`main`, key `usage-stats`).
 *
 * The panel is a read-only projection of the Host aggregate: token usage, estimated
 * cost, per-model composition, and per-session detail. It loads
 * the full payload once per range, then polls the cheap `/live` endpoint every three
 * seconds; the poll only touches the summary, the range hero and the KPI row, while the
 * timeline, cost list and session table are memoized against the full payload so a poll
 * never re-renders them.
 *
 * Built artifact format: the client module system executes only the factory below and
 * materializes it lazily. React comes from the platform module table, so this file
 * requires nothing but `react` and declares no `dsh.client.external`.
 *
 * @module @local/dsh-usage-stats/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-usage-stats',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    // ── constants ──────────────────────────────────────────────────────────

    /** Locale namespace of this plugin's dictionary. */
    const NS = 'usageStats'
    /** Panel id: sidebar entry id, main panel key, and the stylesheet's owner tag. */
    const PANEL_ID = 'usage-stats'
    /** Kept in sync with package.json; shown in the footer. */
    const VERSION = '1.0.0'
    /** Cheap poll cadence while the panel is mounted and visible. */
    const POLL_MS = 3000
    /** The hosted scan can take a few seconds; never leave the refresh button spinning. */
    const REFRESH_TIMEOUT_MS = 45000

    /**
     * A warm scan that found nothing new finishes in milliseconds, often before the
     * next poll observes it running. Busy also clears once the Host reports idle for
     * longer than this, so the control never stays disabled on a no-op rescan.
     */
    const REFRESH_STALL_MS = 2500
    /** Weekly aggregation kicks in for "all time" only past this many daily buckets. */
    const WEEKLY_THRESHOLD = 90
    /** Above this many (filtered) sessions the table paginates; below it renders in full. */
    const PAGE_LIMIT = 300
    const PAGE_SIZE = 100
    /** The cost card shows the top models by cost and folds the rest into "other". */
    const TOP_MODELS = 8
    /** The panel opens on the last week; the segmented control owns every other range. */
    const DEFAULT_DAYS = 7
    /** Chart geometry; the viewBox is fixed so the SVG never reflows during polling. */
    const CHART_WIDTH = 1100
    const CHART_HEIGHT = 350
    const CHART_PAD = { top: 20, right: 18, bottom: 38, left: 66 }
    /** Vertical breathing room between two stacked segments of the same bar. */
    const SEGMENT_GAP = 2

    const RANGE_OPTIONS = [
      { days: 7, label: 'range7' },
      { days: 30, label: 'range30' },
      { days: 90, label: 'range90' },
      { days: 0, label: 'rangeAll' },
    ]

    /** Stacked chart order, bottom to top; the legend and the split bar reuse it. */
    const SEGMENTS = [
      { key: 'input', labelKey: 'legendInput' },
      { key: 'output', labelKey: 'legendOutput' },
      { key: 'cacheRead', labelKey: 'legendCacheRead' },
      { key: 'cacheWrite', labelKey: 'legendCacheWrite' },
    ]

    /**
     * Legend order only: cache hits are the vast majority of every bar, so they lead
     * the legend while the stack itself stays input → output → cacheRead → cacheWrite.
     */
    const LEGEND_SEGMENTS = [SEGMENTS[2], SEGMENTS[1], SEGMENTS[0], SEGMENTS[3]]

    // ── copy ───────────────────────────────────────────────────────────────

    const zh = {
      panel: '用量统计',
      title: '用量统计',
      subtitle: '从本机真实的会话日志估算 Token 与成本',
      rangeLabel: '统计范围',
      range7: '最近 7 天',
      range30: '最近 30 天',
      range90: '最近 90 天',
      rangeAll: '全部时间',
      rangeDays: '最近 {count} 天',
      refresh: '重新扫描',
      refreshHint: '重新索引本机会话日志',
      updatedAt: '更新于 {time}',
      notUpdated: '尚未更新',
      scanningPill: '索引中 {scanned}/{total}',
      lastScanFailed: '上次索引失败：{message}',
      refreshFailed: '重新扫描失败：{message}',
      loadFailedTitle: '统计加载失败',
      loadFailed: '加载统计失败：{message}',
      loading: '正在加载用量统计…',
      loadingHint: '首次索引本机会话日志可能需要几十秒（取决于会话数量）',
      retry: '重试',
      emptyTitle: '还没有可统计的会话',
      emptyBody: '这台机器上还没有记录到会话日志。开始一段对话后再回来看看。',
      heroTotalLabel: '本周期 Token',
      heroTotalAll: '全部时间 Token',
      heroDaily: '日均 Token',
      heroRequests: '请求数',
      heroCost: '成本',
      kpiTokens: 'Token 用量',
      kpiSessions: '会话数',
      kpiCost: '预估成本',
      scopeAll: '全部时间',
      scopePeriod: '本周期',
      tokenBreakdown: '输入 {input} · 输出 {output} · 缓存命中 {cacheRead}',
      sessionsBreakdown: '有用量 {used} · 活跃 {live}',
      sessionsAllTime: '全部时间 {count} 个会话',
      costHint: '按配置单价估算',
      avgPerRequest: '平均每次请求 {tokens} Token',
      dailyCost: '日均 {amount}',
      deltaUp: '较上期上升',
      deltaDown: '较上期下降',
      deltaFlat: '与上期持平',
      deltaTitle: '较前 {days} 个完整日：{value}',
      timelineTitle: 'Token 时间线',
      timelineDaily: '按天聚合 · {range}',
      timelineWeekly: '按周聚合 · {range}',
      timelineRangeTotal: '共 {tokens} Token · {cost}',
      legendInput: '输入',
      legendOutput: '输出',
      legendCacheRead: '缓存命中',
      legendCacheWrite: '缓存写入',
      chartAria: 'Token 时间线，共 {count} 个数据点',
      chartHint: '悬停或用左右方向键查看每日明细',
      chartEmptyTitle: '这段时间没有用量',
      chartEmptyBody: '换一个时间范围，或者点重新扫描再索引一次。',
      bucketSummary: '{day}：{tokens} Token，{cost}，{requests} 次请求',
      tipTokens: 'Token',
      tipCost: '成本',
      tipRequests: '请求',
      avgLabel: '日均 {value}',
      peakLabel: '{day} 峰值 {value}',
      costTitle: '成本构成',
      costSubtitle: '按模型汇总 · {range}',
      costByTokens: '没有可用的单价，按 Token 排序',
      costOther: '其他 {count} 个模型',
      providerDeepseekAccount: 'DeepSeek 账户',
      providerDeepseekOfficial: 'DeepSeek 官方 API',
      providerOpencodeGo: 'OpenCode Go',
      providerOpencode: 'OpenCode',
      providerBailian: '阿里云百炼',
      providerStepfun: '阶跃星辰',
      providerIntern: '书生 Intern',
      providerOpenasi: 'OpenASI',
      providerOpenai: 'OpenAI',
      providerAnthropic: 'Anthropic',
      providerGoogle: 'Google',
      costUnpriced: '使用了兜底单价',
      costCalls: '{count} 次调用',
      modelsCount: '{count} 个模型',
      costRowLabel: '模型 {model}：{cost}，占比 {share}',
      costEmptyBody: '有会话用量之后，这里会显示各模型的成本构成。',
      pricesNote: '单价按每 1M Token 计（{currency}），可在 Host 配置的 prices / fallback 中修改',
      priceTitle: '单价（每 1M Token）：输入 {input} · 输出 {output} · 缓存读 {cacheRead} · 缓存写 {cacheWrite}',
      fallbackPriceTitle: '兜底单价（每 1M Token）：输入 {input} · 输出 {output} · 缓存读 {cacheRead} · 缓存写 {cacheWrite}',
      peakPriceTitle: '峰谷单价（每 1M Token，输入/输出/缓存读）：高峰 {peakIn} / {peakOut} / {peakCache}；非高峰 {offIn} / {offOut} / {offCache}',
      sessionsTitle: '会话明细',
      sessionsInRange: '{range} · {count} 个会话',
      sessionsInRangeFiltered: '{range} · {shown} / {total} 个会话',
      searchPlaceholder: '搜索标题、路径或模型',
      searchLabel: '搜索会话',
      clearSearch: '清空搜索',
      colSession: '会话',
      colModel: '模型',
      colTokens: 'Token',
      colCost: '成本',
      colLastActivity: '最后活动',
      sortBy: '按{column}排序',
      expandRow: '展开会话详情',
      collapseRow: '收起会话详情',
      untitled: '未命名会话',
      liveBadge: '活跃',
      subagentBadge: '子会话',
      detailTokens: 'Token 拆分',
      cacheHitLabel: '缓存命中率',
      detailActivity: '活动',
      detailRequests: '请求',
      detailTurns: '轮次',
      detailUserMessages: '用户消息',
      detailToolCalls: '工具调用',
      detailTimes: '时间',
      detailCreated: '创建',
      detailFirst: '首次活动',
      detailLast: '最后活动',
      detailEnv: '环境',
      detailCwd: '工作目录',
      detailModels: '使用模型',
      detailPreset: 'Agent 预设',
      detailOrigin: '来源',
      detailAllTime: '全部时间：{tokens} Token · {cost}',
      tokenBreakdownLong: '输入 {input} · 输出 {output} · 缓存读 {cacheRead} · 缓存写 {cacheWrite}',
      noMatchTitle: '没有匹配的会话',
      noMatchBody: '换一个关键词，或者按 Esc 清空搜索。',
      sessionsEmptyTitle: '还没有会话记录',
      sessionsEmptyBody: '这台机器上还没有可统计的会话日志。',
      pagePrev: '上一页',
      pageNext: '下一页',
      pageOf: '第 {page} / {total} 页',
      sourceNote: '数据来源：本机会话日志，只读',
      versionLabel: 'v{version}',
      scanElapsed: '上次索引 {value}',
      scanNever: '尚未完成索引',
      exactValue: '精确值 {value}',
      durMs: '{value} 毫秒',
      durSec: '{value} 秒',
      durMin: '{m} 分 {s} 秒',
      durHour: '{h} 小时 {m} 分',
      durDay: '{d} 天 {h} 小时',
    }

    const en = {
      panel: 'Usage Stats',
      title: 'Usage Stats',
      subtitle: 'Estimated from this machine’s real session logs: tokens and cost',
      rangeLabel: 'Statistics range',
      range7: 'Last 7 days',
      range30: 'Last 30 days',
      range90: 'Last 90 days',
      rangeAll: 'All time',
      rangeDays: 'Last {count} days',
      refresh: 'Rescan',
      refreshHint: 'Re-index the local session logs',
      updatedAt: 'Updated {time}',
      notUpdated: 'Not updated yet',
      scanningPill: 'Indexing {scanned}/{total}',
      lastScanFailed: 'The last index run failed: {message}',
      refreshFailed: 'Could not start a rescan: {message}',
      loadFailedTitle: 'Could not load the statistics',
      loadFailed: 'Loading the statistics failed: {message}',
      loading: 'Loading usage statistics…',
      loadingHint: 'The first index of the session logs can take tens of seconds, depending on how many sessions exist',
      retry: 'Retry',
      emptyTitle: 'No sessions to measure yet',
      emptyBody: 'No session log has been recorded on this machine yet. Start a conversation and come back.',
      heroTotalLabel: 'Tokens this period',
      heroTotalAll: 'Tokens, all time',
      heroDaily: 'Daily average',
      heroRequests: 'Requests',
      heroCost: 'Cost',
      kpiTokens: 'Tokens used',
      kpiSessions: 'Sessions',
      kpiCost: 'Estimated cost',
      scopeAll: 'All time',
      scopePeriod: 'This period',
      tokenBreakdown: 'In {input} · Out {output} · Cache hit {cacheRead}',
      sessionsBreakdown: 'With usage {used} · Live {live}',
      sessionsAllTime: '{count} sessions all time',
      costHint: 'Estimated from the configured prices',
      avgPerRequest: '{tokens} tokens per request on average',
      dailyCost: '{amount} per day',
      deltaUp: 'Up from the previous period',
      deltaDown: 'Down from the previous period',
      deltaFlat: 'Unchanged from the previous period',
      deltaTitle: 'vs the previous {days} complete days: {value}',
      timelineTitle: 'Token timeline',
      timelineDaily: 'Daily buckets · {range}',
      timelineWeekly: 'Weekly buckets · {range}',
      timelineRangeTotal: '{tokens} tokens · {cost}',
      legendInput: 'Input',
      legendOutput: 'Output',
      legendCacheRead: 'Cache read',
      legendCacheWrite: 'Cache write',
      chartAria: 'Token timeline with {count} data points',
      chartHint: 'Hover or use the left and right arrow keys for per-day details',
      chartEmptyTitle: 'No usage in this period',
      chartEmptyBody: 'Pick another range, or rescan to re-index the session logs.',
      bucketSummary: '{day}: {tokens} tokens, {cost}, {requests} requests',
      tipTokens: 'Tokens',
      tipCost: 'Cost',
      tipRequests: 'Requests',
      avgLabel: 'Daily average {value}',
      peakLabel: 'Peak {value} on {day}',
      costTitle: 'Cost breakdown',
      costSubtitle: 'By model · {range}',
      costByTokens: 'No prices configured, so models are ordered by tokens',
      costOther: '{count} other models',
      providerDeepseekAccount: 'DeepSeek account',
      providerDeepseekOfficial: 'DeepSeek official API',
      providerOpencodeGo: 'OpenCode Go',
      providerOpencode: 'OpenCode',
      providerBailian: 'Alibaba Bailian',
      providerStepfun: 'StepFun',
      providerIntern: 'Intern',
      providerOpenasi: 'OpenASI',
      providerOpenai: 'OpenAI',
      providerAnthropic: 'Anthropic',
      providerGoogle: 'Google',
      costUnpriced: 'Fallback price applied',
      costCalls: '{count} calls',
      modelsCount: '{count} models',
      costRowLabel: 'Model {model}: {cost}, {share} of the total',
      costEmptyBody: 'The per-model cost breakdown appears once sessions report usage.',
      pricesNote: 'Prices are per 1M tokens ({currency}); edit prices / fallback in the Host config',
      priceTitle: 'Price per 1M tokens: in {input} · out {output} · cache read {cacheRead} · cache write {cacheWrite}',
      fallbackPriceTitle: 'Fallback price per 1M tokens: in {input} · out {output} · cache read {cacheRead} · cache write {cacheWrite}',
      peakPriceTitle: 'Peak/off-peak per 1M tokens (in/out/cache read): peak {peakIn} / {peakOut} / {peakCache}; off-peak {offIn} / {offOut} / {offCache}',
      sessionsTitle: 'Sessions',
      sessionsInRange: '{range} · {count} sessions',
      sessionsInRangeFiltered: '{range} · {shown} of {total} sessions',
      searchPlaceholder: 'Search title, path, or model',
      searchLabel: 'Search sessions',
      clearSearch: 'Clear search',
      colSession: 'Session',
      colModel: 'Model',
      colTokens: 'Tokens',
      colCost: 'Cost',
      colLastActivity: 'Last activity',
      sortBy: 'Sort by {column}',
      expandRow: 'Expand session details',
      collapseRow: 'Collapse session details',
      untitled: 'Untitled session',
      liveBadge: 'Live',
      subagentBadge: 'Subagent',
      detailTokens: 'Token breakdown',
      cacheHitLabel: 'Cache hit rate',
      detailActivity: 'Activity',
      detailRequests: 'Requests',
      detailTurns: 'Turns',
      detailUserMessages: 'User messages',
      detailToolCalls: 'Tool calls',
      detailTimes: 'Timeline',
      detailCreated: 'Created',
      detailFirst: 'First activity',
      detailLast: 'Last activity',
      detailEnv: 'Environment',
      detailCwd: 'Working directory',
      detailModels: 'Models used',
      detailPreset: 'Agent preset',
      detailOrigin: 'Origin',
      detailAllTime: 'All time: {tokens} tokens · {cost}',
      tokenBreakdownLong: 'In {input} · Out {output} · Cache read {cacheRead} · Cache write {cacheWrite}',
      noMatchTitle: 'No matching sessions',
      noMatchBody: 'Try another keyword, or press Escape to clear the search.',
      sessionsEmptyTitle: 'No sessions recorded',
      sessionsEmptyBody: 'No measurable session log exists on this machine yet.',
      pagePrev: 'Previous',
      pageNext: 'Next',
      pageOf: 'Page {page} of {total}',
      sourceNote: 'Source: local session logs, read-only',
      versionLabel: 'v{version}',
      scanElapsed: 'Last index {value}',
      scanNever: 'No completed index yet',
      exactValue: 'Exact value {value}',
      durMs: '{value} ms',
      durSec: '{value} s',
      durMin: '{m}m {s}s',
      durHour: '{h}h {m}m',
      durDay: '{d}d {h}h',
    }

    // ── coercion ───────────────────────────────────────────────────────────

    /** A JSON number, or 0. Everything numeric in the payload goes through here. */
    function num(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    /** A JSON number, or null, for fields where "absent" and "zero" mean different things. */
    function maybeNum(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    function hasNum(value) {
      return typeof value === 'number' && Number.isFinite(value)
    }

    function str(value) {
      return typeof value === 'string' ? value : ''
    }

    function listOf(value) {
      return Array.isArray(value) ? value : []
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    // ── formatting ─────────────────────────────────────────────────────────

    const EXACT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
    const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const SHORT_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const FULL_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

    /** One decimal, with a trailing `.0` removed: 1200 -> "1.2", 2000 -> "2". */
    function trimDecimal(value) {
      const text = value.toFixed(1)
      return text.endsWith('.0') ? text.slice(0, -2) : text
    }

    /** K/M/B so token counts stay short in every locale. */
    function compact(value) {
      if (!Number.isFinite(value)) return '—'
      const size = Math.abs(value)
      if (size < 1000) return String(Math.round(value))
      if (size < 1e6) return trimDecimal(value / 1e3) + 'K'
      if (size < 1e9) return trimDecimal(value / 1e6) + 'M'
      return trimDecimal(value / 1e9) + 'B'
    }

    function exact(value) {
      return Number.isFinite(value) ? EXACT.format(Math.round(value)) : '—'
    }

    /** Money with enough precision for fractions of a cent, never rounded to $0.00. */
    function usd(value) {
      if (!Number.isFinite(value)) return '—'
      const size = Math.abs(value)
      if (size === 0) return '$0'
      if (size < 0.01) return '$' + value.toFixed(4)
      if (size < 1) return '$' + value.toFixed(3)
      return '$' + value.toFixed(2)
    }

    function usdExact(value) {
      return Number.isFinite(value) ? '$' + value.toFixed(4) : '—'
    }

    /** A 0..1 share as a percentage. */
    function percentOf(fraction) {
      return Number.isFinite(fraction) ? Math.round(clamp(fraction, 0, 1) * 100) + '%' : '—'
    }

    /** Human duration from milliseconds, in the UI language. */
    function durationText(t, valueMs) {
      if (!Number.isFinite(valueMs) || valueMs < 0) return '—'
      const totalSeconds = Math.floor(valueMs / 1000)
      if (totalSeconds < 1) return t('durMs', { value: String(Math.max(0, Math.round(valueMs))) })
      if (totalSeconds < 60) return t('durSec', { value: String(totalSeconds) })
      const minutes = Math.floor(totalSeconds / 60)
      if (minutes < 60) return t('durMin', { m: String(minutes), s: String(totalSeconds % 60) })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('durHour', { h: String(hours), m: String(minutes % 60) })
      return t('durDay', { d: String(Math.floor(hours / 24)), h: String(hours % 24) })
    }

    function formatTime(formatter, ms) {
      if (ms === null) return '—'
      try {
        const date = new Date(ms)
        return Number.isNaN(date.getTime()) ? '—' : formatter.format(date)
      } catch (_error) {
        return '—'
      }
    }

    function clockText(ms) {
      return formatTime(CLOCK, maybeNum(ms))
    }

    function shortDateText(ms) {
      return formatTime(SHORT_TIME, maybeNum(ms))
    }

    function fullDateText(ms) {
      return formatTime(FULL_TIME, maybeNum(ms))
    }

    /** The last two path segments; Windows paths keep their backslashes. */
    function tailPath(cwd) {
      if (cwd === '') return ''
      const parts = cwd.split(/[\\/]+/).filter((part) => part !== '')
      if (parts.length <= 2) return cwd
      const separator = cwd.indexOf('\\') === -1 ? '/' : '\\'
      return '…' + separator + parts.slice(-2).join(separator)
    }

    /** `provider/model` -> `model`; keys without a provider are returned untouched. */
    function modelName(key) {
      const cut = key.lastIndexOf('/')
      return cut === -1 ? key : key.slice(cut + 1)
    }

    /** Provider ids the panel can name; anything else is shown by its raw id. */
    const PROVIDER_LABEL_KEYS = {
      'deepseek-account': 'providerDeepseekAccount',
      'deepseek-official': 'providerDeepseekOfficial',
      'opencode-go': 'providerOpencodeGo',
      opencode: 'providerOpencode',
      bailian: 'providerBailian',
      stepfun: 'providerStepfun',
      intern: 'providerIntern',
      openasi: 'providerOpenasi',
      openai: 'providerOpenai',
      anthropic: 'providerAnthropic',
      google: 'providerGoogle',
    }

    /** The vendor shown before a model name, e.g. "DeepSeek 官方 API". */
    function providerName(key, t) {
      const cut = key.indexOf('/')
      const provider = cut === -1 ? '' : key.slice(0, cut)
      if (provider === '') return ''
      const labelKey = PROVIDER_LABEL_KEYS[provider]
      return labelKey === undefined ? provider : t(labelKey)
    }

    /** `provider/model` -> "vendor · model"; a bare key stays its model name. */
    function modelLabel(key, t) {
      const provider = providerName(key, t)
      return provider === '' ? modelName(key) : provider + ' · ' + modelName(key)
    }

    function rangeLabelText(t, days) {
      if (days === 0) return t('rangeAll')
      if (days === 7) return t('range7')
      if (days === 30) return t('range30')
      if (days === 90) return t('range90')
      return t('rangeDays', { count: exact(days) })
    }

    /** Round up to 1/2/5 x 10^n so the y gridlines land on readable numbers. */
    function niceCeil(value) {
      if (!(value > 0)) return 1
      const exponent = Math.pow(10, Math.floor(Math.log10(value)))
      const normalized = value / exponent
      const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
      return step * exponent
    }

    /** ISO week start (Monday) of a `YYYY-MM-DD` local day, as another `YYYY-MM-DD`. */
    function weekStart(day) {
      const date = new Date(day + 'T00:00:00Z')
      if (Number.isNaN(date.getTime())) return day
      const offset = (date.getUTCDay() + 6) % 7
      date.setUTCDate(date.getUTCDate() - offset)
      return date.toISOString().slice(0, 10)
    }

    function shortDay(day) {
      return day.length >= 10 ? day.slice(5) : day
    }

    /** Daily buckets, or weekly ones when "all time" covers a lot of days. */
    function buildBuckets(timeline, days) {
      const weekly = days === 0 && timeline.length > WEEKLY_THRESHOLD
      const buckets = new Map()
      for (const row of timeline) {
        const key = weekly ? weekStart(row.day) : row.day
        let bucket = buckets.get(key)
        if (bucket === undefined) {
          bucket = { key, from: row.day, to: row.day, days: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0, requests: 0 }
          buckets.set(key, bucket)
        }
        bucket.to = row.day
        bucket.days += 1
        bucket.input += row.input
        bucket.output += row.output
        bucket.cacheRead += row.cacheRead
        bucket.cacheWrite += row.cacheWrite
        bucket.total += row.input + row.output + row.cacheRead + row.cacheWrite
        bucket.costUsd += row.costUsd
        bucket.requests += row.requests
      }
      return { rows: Array.from(buckets.values()), weekly }
    }

    function bucketDayText(bucket) {
      return bucket.from === bucket.to ? bucket.from : bucket.from + ' – ' + bucket.to
    }

    /** How many days the selected range covers, for per-day averages. */
    function spanOf(rangeDays, timeline) {
      if (rangeDays > 0) return rangeDays
      return timeline.length > 0 ? timeline.length : 1
    }

    // ── payload normalization ──────────────────────────────────────────────
    // The Host owns the contract, but a missing block must never break the panel:
    // every reader below sees exactly the shape it was written against. Only the
    // fields the panel renders are kept, so a contract addition stays Host-side.

    function normalizeTokens(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const input = num(source.input)
      const output = num(source.output)
      const cacheRead = num(source.cacheRead)
      const cacheWrite = num(source.cacheWrite)
      const total = hasNum(source.total) ? source.total : input + output + cacheRead + cacheWrite
      return { input, output, cacheRead, cacheWrite, reasoning: num(source.reasoning), total }
    }

    function normalizeScan(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        state: source.state === 'scanning' ? 'scanning' : 'idle',
        total: num(source.total),
        scanned: num(source.scanned),
        elapsedMs: maybeNum(source.elapsedMs),
        lastError: str(source.lastError) === '' ? null : str(source.lastError),
      }
    }

    function normalizeTotals(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        sessions: num(source.sessions),
        sessionsWithUsage: num(source.sessionsWithUsage),
        liveSessions: num(source.liveSessions),
        tokens: normalizeTokens(source.tokens),
        costUsd: num(source.costUsd),
      }
    }

    function normalizeTimeline(raw) {
      const rows = []
      for (const item of listOf(raw)) {
        if (item === null || typeof item !== 'object') continue
        const day = str(item.day)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
        const input = num(item.input)
        const output = num(item.output)
        const cacheRead = num(item.cacheRead)
        const cacheWrite = num(item.cacheWrite)
        rows.push({
          day,
          input,
          output,
          cacheRead,
          cacheWrite,
          costUsd: num(item.costUsd),
          requests: num(item.requests),
        })
      }
      return rows
    }

    /**
     * The equal-length comparison windows the Host computed for the delta chips:
     * the finished days of this range against the equally long window before it.
     * Null when the selected range has no complete day to compare.
     */
    function normalizeDelta(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const current = raw.current
      const previous = raw.previous
      if (current === null || typeof current !== 'object' || previous === null || typeof previous !== 'object') return null
      return {
        days: num(raw.days),
        current: { tokens: normalizeTokens(current.tokens), costUsd: num(current.costUsd), requests: num(current.requests) },
        previous: { tokens: normalizeTokens(previous.tokens), costUsd: num(previous.costUsd), requests: num(previous.requests) },
      }
    }

    /** One model row; the range-scoped `range.models` list is the only models source. */
    function normalizeModel(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const key = str(raw.key)
      if (key === '') return null
      return {
        key,
        calls: num(raw.calls),
        tokens: normalizeTokens(raw.tokens),
        costUsd: num(raw.costUsd),
        priced: raw.priced !== false,
      }
    }

    function normalizeModels(raw) {
      const models = []
      for (const item of listOf(raw)) {
        const model = normalizeModel(item)
        if (model !== null) models.push(model)
      }
      return models
    }

    /** A session's whole-life figures, kept alongside the range-scoped row numbers. */
    function normalizeAllTime(raw) {
      if (raw === null || typeof raw !== 'object') return null
      return {
        tokens: normalizeTokens(raw.tokens),
        costUsd: num(raw.costUsd),
        requests: num(raw.requests),
        turns: num(raw.turns),
        userMessages: num(raw.userMessages),
        toolCalls: num(raw.toolCalls),
      }
    }

    function normalizeSession(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const id = str(raw.id)
      if (id === '') return null
      const tokens = normalizeTokens(raw.tokens)
      const cacheBase = tokens.input + tokens.cacheRead
      const cacheHitRate = hasNum(raw.cacheHitRate)
        ? clamp(raw.cacheHitRate, 0, 1)
        : cacheBase > 0
          ? tokens.cacheRead / cacheBase
          : 0
      return {
        id,
        title: str(raw.title),
        cwd: str(raw.cwd),
        agentPreset: str(raw.agentPreset),
        subagent: raw.origin === 'subagent',
        live: raw.live === true,
        createdAt: maybeNum(raw.createdAt),
        firstActivity: maybeNum(raw.firstActivity),
        lastActivity: maybeNum(raw.lastActivity),
        turns: num(raw.turns),
        requests: num(raw.requests),
        userMessages: num(raw.userMessages),
        toolCalls: num(raw.toolCalls),
        tokens,
        costUsd: num(raw.costUsd),
        cacheHitRate,
        models: listOf(raw.models).filter((entry) => typeof entry === 'string' && entry !== ''),
        priced: raw.priced !== false,
        allTime: normalizeAllTime(raw.allTime),
      }
    }

    function normalizePrices(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const table = source.models !== null && typeof source.models === 'object' ? source.models : {}
      const flatten = (block) => {
        const row = block !== null && typeof block === 'object' ? block : {}
        return {
          input: num(row.input),
          output: num(row.output),
          cacheRead: num(row.cacheRead),
          cacheWrite: num(row.cacheWrite),
        }
      }
      const rates = {}
      for (const key of Object.keys(table)) {
        const row = table[key] !== null && typeof table[key] === 'object' ? table[key] : {}
        // A model billed by time of day ships both blocks; a flat model ships one.
        rates[key] =
          row.peak !== undefined || row.offPeak !== undefined
            ? { peak: flatten(row.peak), offPeak: flatten(row.offPeak) }
            : flatten(row)
      }
      const fallback = source.fallback !== null && typeof source.fallback === 'object' ? source.fallback : {}
      return {
        currency: str(source.currency) === '' ? 'USD' : str(source.currency),
        rates,
        fallback: flatten(fallback),
      }
    }

    function normalizeRange(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      return {
        days: num(source.days),
        from: maybeNum(source.from),
        to: maybeNum(source.to),
        tokens: normalizeTokens(source.tokens),
        costUsd: num(source.costUsd),
        requests: num(source.requests),
        sessions: num(source.sessions),
        sessionsWithUsage: num(source.sessionsWithUsage),
        models: normalizeModels(source.models),
        delta: normalizeDelta(source.delta),
        timeline: normalizeTimeline(source.timeline),
      }
    }

    function normalizeFull(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const sessions = []
      for (const item of listOf(raw.sessions)) {
        const session = normalizeSession(item)
        if (session !== null) sessions.push(session)
      }
      // `models` is gone from the top level: cost composition is range-scoped and
      // lives in `range.models`, where `normalizeRange` reads it.
      return {
        revision: num(raw.revision),
        generatedAt: maybeNum(raw.generatedAt),
        scan: normalizeScan(raw.scan),
        totals: normalizeTotals(raw.totals),
        range: normalizeRange(raw.range),
        sessions,
        prices: normalizePrices(raw.prices),
      }
    }

    /** The live payload is exactly `version, revision, generatedAt, scan, totals`. */
    function normalizeLive(raw) {
      if (raw === null || typeof raw !== 'object') return null
      return {
        revision: num(raw.revision),
        generatedAt: maybeNum(raw.generatedAt),
        scan: normalizeScan(raw.scan),
        totals: normalizeTotals(raw.totals),
      }
    }

    // ── network ────────────────────────────────────────────────────────────

    /** Same-origin JSON fetch; errors carry the Host's own message when it sent one. */
    async function getJson(path, options) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
      })
      if (!response.ok) {
        let message = 'HTTP ' + response.status
        try {
          const body = await response.json()
          const error = body !== null && typeof body === 'object' ? body.error : null
          if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') {
            message = error.message
          }
        } catch (_error) {
          /* the status line is a good enough message */
        }
        throw new Error(message)
      }
      return response.json()
    }

    // ── glyphs ─────────────────────────────────────────────────────────────

    const GLYPH_PATHS = {
      refresh: ['M2.6 8a5.4 5.4 0 0 1 9.2-3.8', 'M13.4 8a5.4 5.4 0 0 1-9.2 3.8', 'M11.9 1.9v3h-3', 'M4.1 14.1v-3h3'],
      search: ['M7 2.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4Z', 'M10.1 10.1 13.6 13.6'],
      close: ['M4 4l8 8', 'M12 4l-8 8'],
      chevronRight: ['M6 3.5 10.5 8 6 12.5'],
      chevronDown: ['M3.5 6 8 10.5 12.5 6'],
      arrowUp: ['M8 12.5v-9', 'M4 7.5 8 3.5l4 4'],
      arrowDown: ['M8 3.5v9', 'M4 8.5 8 12.5l4-4'],
      sort: ['M5 3.5v9', 'M2.8 10.3 5 12.5l2.2-2.2', 'M11 12.5v-9', 'M8.8 5.7 11 3.5l2.2 2.2'],
      alert: ['M8 2.7 14 13H2L8 2.7Z', 'M8 6.5v3.1', 'M8 11.5v.2'],
      tokens: ['M3 12.6h10', 'M4.9 12.4V7.6', 'M8 12.4V3.8', 'M11.1 12.4V9.4'],
      sessions: ['M2.8 3.6h10.4c.5 0 .9.4.9.9v4.9c0 .5-.4.9-.9.9H6.6l-2.6 2.3v-2.3H2.8c-.5 0-.9-.4-.9-.9V4.5c0-.5.4-.9.9-.9Z'],
      cost: ['M8 2.4v11.2', 'M10.6 5.1c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.2 0-2.2-.5-2.6-1.4'],
    }

    /** One outline glyph from the platform-neutral table above. */
    function Glyph(props) {
      const { name, size = 16 } = props
      const paths = GLYPH_PATHS[name]
      if (paths === undefined) return null
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', flex: 'none' },
        },
        paths.map((d, index) =>
          h('path', {
            key: index,
            d,
            stroke: 'currentColor',
            strokeWidth: 1.25,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      )
    }

    /** Bar-chart glyph the sidebar renders for this panel at 16px/18px. */
    function UsageStatsIcon(props) {
      const source = props !== null && typeof props === 'object' ? props : {}
      const size = typeof source.size === 'number' ? source.size : 16
      const weight = source.active === true ? 1.9 : 1.6
      const bar = (d) => h('path', { d, stroke: 'currentColor', strokeWidth: weight, strokeLinecap: 'round' })
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', { d: 'M2.4 13.5h11.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        bar('M4.9 13.2V8.1'),
        bar('M8 13.2V4.3'),
        bar('M11.1 13.2V9.9'),
      )
    }

    // ── delta ──────────────────────────────────────────────────────────────

    /**
     * Compare the current period with the previous one. Returns null when there is
     * nothing to compare against — the chip is hidden for a null previous window and
     * for a previous value of exactly zero, where a percentage would be meaningless.
     */
    function deltaOf(current, previous) {
      if (previous === null || previous === 0) return null
      const change = (current - previous) / Math.abs(previous)
      return { change, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat' }
    }

    /** A relative change as percent text; anything under one percent stays honest. */
    function deltaText(change) {
      const percent = Math.abs(change) * 100
      if (percent > 0 && percent < 1) return '<1%'
      return exact(Math.round(percent)) + '%'
    }

    /** ▲/▼ plus the percentage change versus `range.previous`. */
    function DeltaChip(props) {
      const { t, delta, previousText, windowDays } = props
      // Absent (a card with no counterpart metric) and null (no previous window, or a
      // previous value of zero) both mean "render no chip".
      if (delta === null || delta === undefined) return null
      const direction = delta.direction
      const spoken = direction === 'up' ? t('deltaUp') : direction === 'down' ? t('deltaDown') : t('deltaFlat')
      return h(
        'span',
        {
          className: 'us-delta is-' + direction,
          title: t('deltaTitle', { days: exact(windowDays), value: previousText }),
          'aria-label': t('deltaTitle', { days: exact(windowDays), value: previousText }) + ' ' + spoken + ' ' + deltaText(delta.change),
        },
        direction === 'flat'
          ? h('span', { className: 'us-delta-mark', 'aria-hidden': 'true' }, '–')
          : h(Glyph, { name: direction === 'up' ? 'arrowUp' : 'arrowDown', size: 10 }),
        h('span', { className: 'us-delta-value' }, deltaText(delta.change)),
      )
    }

    // ── small shared pieces ────────────────────────────────────────────────

    function EmptyBlock(props) {
      const { icon = 'chart', title, body } = props
      return h(
        'div',
        { className: 'us-empty' },
        h('span', { className: 'us-empty-glyph' }, icon === 'alert' ? h(Glyph, { name: 'alert', size: 30 }) : h(UsageStatsIcon, { size: 34 })),
        h('p', { className: 'us-empty-title' }, title),
        body === undefined ? null : h('p', { className: 'us-empty-body' }, body),
      )
    }

    function ErrorBlock(props) {
      const { t, message, onRetry } = props
      return h(
        'div',
        { className: 'us-empty' },
        h('span', { className: 'us-empty-glyph' }, h(Glyph, { name: 'alert', size: 30 })),
        h('p', { className: 'us-empty-title' }, t('loadFailedTitle')),
        h('p', { className: 'us-empty-body' }, t('loadFailed', { message })),
        h('button', { type: 'button', className: 'us-button us-button-primary', onClick: onRetry }, t('retry')),
      )
    }

    /** Static skeleton: the first paint has a shape, so nothing jumps when data lands. */
    function LoadingBlock(props) {
      const { t } = props
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'us-loading-text', role: 'status' },
          h('span', { className: 'us-loading-title' }, t('loading')),
          h('span', { className: 'us-loading-hint' }, t('loadingHint')),
        ),
        h(
          'div',
          { className: 'us-skeleton', 'aria-hidden': 'true' },
          h('div', { className: 'us-skel us-skel-hero' }),
          h(
            'div',
            { className: 'us-skel-kpis' },
            [0, 1, 2].map((index) => h('div', { key: index, className: 'us-skel us-skel-kpi' })),
          ),
          h('div', { className: 'us-skel us-skel-chart' }),
          h('div', { className: 'us-skel us-skel-side' }),
          h(
            'div',
            { className: 'us-skel-table' },
            [0, 1, 2, 3, 4].map((index) => h('div', { key: index, className: 'us-skel us-skel-row' })),
          ),
        ),
      )
    }

    function Notice(props) {
      const { icon, children, action } = props
      return h(
        'div',
        { className: 'us-notice', role: 'status' },
        h(Glyph, { name: icon, size: 14 }),
        h('span', { className: 'us-notice-text' }, children),
        action === undefined ? null : action,
      )
    }

    // ── range hero ─────────────────────────────────────────────────────────

    /**
     * The compact band directly under the header: this period's total tokens as the
     * headline figure, with the daily average, requests, period cost and the range
     * itself as supporting facts on one line.
     */
    function RangeHero(props) {
      const { t, rangeDays, range, span } = props
      const total = range.tokens.total
      const daily = total / (span > 0 ? span : 1)
      const facts = [
        { label: t('heroDaily'), value: compact(daily), title: t('exactValue', { value: exact(Math.round(daily)) }) },
        {
          label: t('heroRequests'),
          value: exact(range.requests),
          title: t('avgPerRequest', { tokens: compact(range.requests > 0 ? total / range.requests : 0) }),
        },
        { label: t('heroCost'), value: usd(range.costUsd), title: t('costHint') },
        { label: t('rangeLabel'), value: rangeLabelText(t, rangeDays) },
      ]
      return h(
        'div',
        { className: 'us-hero' },
        h(
          'div',
          { className: 'us-hero-figure' },
          h('span', { className: 'us-hero-label' }, t(rangeDays === 0 ? 'heroTotalAll' : 'heroTotalLabel')),
          h('span', { className: 'us-hero-value', title: t('exactValue', { value: exact(total) }) }, compact(total)),
        ),
        h(
          'div',
          { className: 'us-hero-facts' },
          facts.map((fact) =>
            h(
              'div',
              { key: fact.label, className: 'us-hero-fact' },
              h('span', { className: 'us-hero-fact-label' }, fact.label),
              h('span', { className: 'us-hero-fact-value', title: fact.title }, fact.value),
            ),
          ),
        ),
      )
    }

    // ── KPI row ────────────────────────────────────────────────────────────

    /**
     * One KPI tile: icon chip, label, scope tag, the number, an optional delta chip and
     * a supporting line.
     */
    function KpiCard(props) {
      const { t, label, scope, icon, tone, value, exactTitle, hint, delta, previousText, windowDays } = props
      return h(
        'div',
        { className: 'us-kpi' },
        h(
          'div',
          { className: 'us-kpi-head' },
          h('span', { className: 'us-kpi-icon ' + tone, 'aria-hidden': 'true' }, h(Glyph, { name: icon, size: 14 })),
          h('span', { className: 'us-kpi-label' }, label),
          h('span', { className: 'us-kpi-scope' }, scope),
        ),
        h(
          'div',
          { className: 'us-kpi-line' },
          h('span', { className: 'us-kpi-value', title: exactTitle }, value),
          h(DeltaChip, { t, delta, previousText, windowDays }),
        ),
        hint === undefined ? null : h('div', { className: 'us-kpi-sub' }, hint),
      )
    }

    /**
     * Three tiles across the top: the range's tokens and cost (each with a delta versus
     * the previous window) and the range's session count.
     */
    function KpiRow(props) {
      const { t, totals, range, delta, span } = props
      const tokenTotal = range.tokens.total
      // The chips compare the finished days of this range with the equally long window
      // before it, so a partial today can never fake a decline in spend.
      const tokenDelta = delta === null ? null : deltaOf(delta.current.tokens.total, delta.previous.tokens.total)
      const costDelta = delta === null ? null : deltaOf(delta.current.costUsd, delta.previous.costUsd)
      const windowDays = delta === null ? 0 : delta.days
      const previousTokens = delta === null ? '—' : compact(delta.previous.tokens.total)
      const previousCost = delta === null ? '—' : usd(delta.previous.costUsd)
      const scope = range.days === 0 ? t('scopeAll') : t('scopePeriod')
      const perDay = span > 0 ? span : 1
      const tiles = [
        {
          label: t('kpiTokens'),
          icon: 'tokens',
          tone: 'is-brand',
          value: compact(tokenTotal),
          exactTitle: t('exactValue', { value: exact(tokenTotal) }),
          hint: t('tokenBreakdown', {
            input: compact(range.tokens.input),
            output: compact(range.tokens.output),
            cacheRead: compact(range.tokens.cacheRead),
          }),
          delta: tokenDelta,
          previousText: previousTokens,
        },
        {
          label: t('kpiSessions'),
          icon: 'sessions',
          tone: 'is-business',
          value: compact(range.sessions),
          exactTitle: t('exactValue', { value: exact(range.sessions) }),
          // For all time the tile value already is the all-time count, so the extra
          // reference would just repeat it.
          hint:
            t('sessionsBreakdown', { used: exact(range.sessionsWithUsage), live: exact(totals.liveSessions) }) +
            (range.days === 0 ? '' : ' · ' + t('sessionsAllTime', { count: exact(totals.sessions) })),
        },
        {
          label: t('kpiCost'),
          icon: 'cost',
          tone: 'is-success',
          value: usd(range.costUsd),
          exactTitle: t('exactValue', { value: usdExact(range.costUsd) }),
          hint: t('dailyCost', { amount: usd(range.costUsd / perDay) }),
          delta: costDelta,
          previousText: previousCost,
        },
      ]
      return h(
        'div',
        { className: 'us-kpis' },
        tiles.map((tile) => h(KpiCard, { key: tile.label, t, scope, windowDays, ...tile })),
      )
    }

    // ── token timeline ─────────────────────────────────────────────────────

    function ChartTooltip(props) {
      const { t, bucket, index, count, maxValue } = props
      const plotWidth = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right
      const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom
      const band = plotWidth / Math.max(1, count)
      const centerX = CHART_PAD.left + (index + 0.5) * band
      const left = clamp((centerX / CHART_WIDTH) * 100, 5, 95)
      const barTop = CHART_PAD.top + plotHeight * (1 - clamp(bucket.total / maxValue, 0, 1))
      const top = clamp((barTop / CHART_HEIGHT) * 100, 2, 94)
      const rows = []
      for (const segment of SEGMENTS) {
        const value = bucket[segment.key]
        if (value <= 0) continue
        rows.push(
          h(
            'div',
            { key: segment.key, className: 'us-tip-row' },
            h(
              'span',
              { className: 'us-tip-label' },
              h('span', { className: 'us-swatch us-bar-' + segment.key }),
              t(segment.labelKey),
            ),
            h('span', { className: 'us-tip-value' }, compact(value)),
          ),
        )
      }
      return h(
        'div',
        {
          className: 'us-chart-tip',
          style: { left: left + '%', top: top + '%' },
          'aria-hidden': 'true',
        },
        h('p', { className: 'us-tip-day' }, bucketDayText(bucket)),
        rows,
        h('div', { className: 'us-tip-sep' }),
        h(
          'div',
          { className: 'us-tip-row' },
          h('span', { className: 'us-tip-label' }, t('tipTokens')),
          h('span', { className: 'us-tip-value' }, exact(bucket.total)),
        ),
        h(
          'div',
          { className: 'us-tip-row' },
          h('span', { className: 'us-tip-label' }, t('tipCost')),
          h('span', { className: 'us-tip-value' }, usd(bucket.costUsd)),
        ),
        h(
          'div',
          { className: 'us-tip-row' },
          h('span', { className: 'us-tip-label' }, t('tipRequests')),
          h('span', { className: 'us-tip-value' }, exact(bucket.requests)),
        ),
      )
    }

    /**
     * Stacked bar chart. Hover lives in local state so a pointer move re-renders only
     * this chart, never the page; keyboard users arrow through the buckets and the
     * same tooltip is announced through a polite live region.
     */
    function TimelineChart(props) {
      const { t, rows } = props
      const [activeIndex, setActiveIndex] = useState(-1)
      const count = rows.length
      const plotWidth = CHART_WIDTH - CHART_PAD.left - CHART_PAD.right
      const plotHeight = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom
      const band = plotWidth / Math.max(1, count)
      const barWidth = Math.max(2.5, Math.min(30, band * 0.6))
      const corner = Math.min(2.5, barWidth / 2)

      const stats = useMemo(() => {
        let peak = 0
        let peakIndex = -1
        let sum = 0
        let days = 0
        for (let index = 0; index < rows.length; index += 1) {
          const value = rows[index].total
          sum += value
          days += rows[index].days > 0 ? rows[index].days : 1
          if (value > peak) {
            peak = value
            peakIndex = index
          }
        }
        return {
          maxValue: niceCeil(peak),
          // A weekly bucket covers seven days, so the dashed line stays a per-day figure.
          average: days > 0 ? sum / days : 0,
          peak,
          peakIndex,
        }
      }, [rows])

      const tickStep = Math.max(1, Math.ceil(count / 8))
      const active = activeIndex >= 0 && activeIndex < count ? rows[activeIndex] : null
      const averageY = CHART_PAD.top + plotHeight * (1 - clamp(stats.average / stats.maxValue, 0, 1))
      const peakBucket = stats.peakIndex >= 0 && stats.peakIndex < count ? rows[stats.peakIndex] : null
      const peakY = CHART_PAD.top + plotHeight * (1 - clamp(stats.peak / stats.maxValue, 0, 1))
      const peakX = clamp(CHART_PAD.left + (stats.peakIndex + 0.5) * band, CHART_PAD.left + 34, CHART_PAD.left + plotWidth - 34)

      const onKeyDown = (event) => {
        if (count === 0) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          const forward = event.key === 'ArrowRight'
          setActiveIndex((current) => {
            if (current === -1) return forward ? 0 : count - 1
            return clamp(current + (forward ? 1 : -1), 0, count - 1)
          })
        } else if (event.key === 'Home') {
          event.preventDefault()
          setActiveIndex(0)
        } else if (event.key === 'End') {
          event.preventDefault()
          setActiveIndex(count - 1)
        } else if (event.key === 'Escape') {
          setActiveIndex(-1)
        }
      }

      const grid = []
      for (let index = 0; index <= 4; index += 1) {
        const y = CHART_PAD.top + plotHeight - (index / 4) * plotHeight
        grid.push(
          h('line', {
            key: 'grid-' + index,
            className: index === 0 ? 'us-axis-line' : 'us-grid-line',
            x1: CHART_PAD.left,
            y1: y,
            x2: CHART_PAD.left + plotWidth,
            y2: y,
          }),
        )
        grid.push(
          h(
            'text',
            { key: 'grid-label-' + index, x: CHART_PAD.left - 10, y, textAnchor: 'end', dominantBaseline: 'middle' },
            compact((stats.maxValue * index) / 4),
          ),
        )
      }

      const bars = []
      const hits = []
      const ticks = []
      for (let index = 0; index < count; index += 1) {
        const bucket = rows[index]
        const bandX = CHART_PAD.left + index * band
        const barX = bandX + (band - barWidth) / 2
        let stack = 0
        let layer = 0
        for (const segment of SEGMENTS) {
          const value = bucket[segment.key]
          if (value <= 0) continue
          const height = (value / stats.maxValue) * plotHeight
          const inset = layer === 0 ? 0 : SEGMENT_GAP
          if (height > inset + 0.4) {
            bars.push(
              h('rect', {
                key: bucket.key + '-' + segment.key,
                className: 'us-bar us-bar-' + segment.key,
                x: barX,
                y: CHART_PAD.top + plotHeight - stack - height + inset,
                width: barWidth,
                height: Math.max(0.6, height - inset),
                rx: corner,
              }),
            )
          }
          stack += height
          layer += 1
        }
        hits.push(
          h('rect', {
            key: 'hit-' + bucket.key,
            className: 'us-hit',
            x: bandX,
            y: CHART_PAD.top,
            width: band,
            height: plotHeight,
            onPointerEnter: () => setActiveIndex(index),
          }),
        )
        if (index % tickStep === 0) {
          ticks.push(
            h(
              'text',
              { key: 'tick-' + bucket.key, x: bandX + band / 2, y: CHART_HEIGHT - 12, textAnchor: 'middle' },
              shortDay(bucket.from),
            ),
          )
        }
      }

      return h(
        'div',
        { className: 'us-chart-wrap' },
        // The plot wrapper exists so the tooltip's percentage anchors resolve against
        // the SVG box only, not against the taller legend-and-hint block below it.
        h(
          'div',
          { className: 'us-chart-plot' },
          h(
            'svg',
            {
              className: 'us-chart',
              viewBox: '0 0 ' + CHART_WIDTH + ' ' + CHART_HEIGHT,
              role: 'group',
              tabIndex: 0,
              'aria-label': t('chartAria', { count: exact(count) }),
              onKeyDown,
              onFocus: () => {
                if (activeIndex === -1) setActiveIndex(count - 1)
              },
              onBlur: () => setActiveIndex(-1),
              onPointerLeave: () => setActiveIndex(-1),
            },
            // Everything drawn in the plot is decoration: the value of the focused day
            // reaches assistive technology through the polite live region below, and the
            // axis labels would otherwise be read out as loose numbers.
            h(
              'g',
              { 'aria-hidden': 'true' },
              grid,
              active === null
                ? null
                : h('rect', {
                    className: 'us-active-band',
                    x: CHART_PAD.left + activeIndex * band,
                    y: CHART_PAD.top,
                    width: band,
                    height: plotHeight,
                    rx: Math.min(6, band / 3),
                  }),
              stats.average > 0
                ? h('line', {
                    className: 'us-avg-line',
                    x1: CHART_PAD.left,
                    y1: averageY,
                    x2: CHART_PAD.left + plotWidth,
                    y2: averageY,
                  })
                : null,
              bars,
              hits,
              peakBucket === null
                ? null
                : h(
                    'text',
                    { className: 'us-peak-label', x: peakX, y: clamp(peakY - 8, CHART_PAD.top + 10, CHART_PAD.top + plotHeight - 4), textAnchor: 'middle' },
                    t('peakLabel', { day: shortDay(peakBucket.from), value: compact(stats.peak) }),
                  ),
              ticks,
            ),
          ),
          active === null ? null : h(ChartTooltip, { t, bucket: active, index: activeIndex, count, maxValue: stats.maxValue }),
          h(
            'div',
            { className: 'us-visually-hidden', 'aria-live': 'polite' },
            active === null
              ? ''
              : t('bucketSummary', {
                  day: bucketDayText(active),
                  tokens: exact(active.total),
                  cost: usd(active.costUsd),
                  requests: exact(active.requests),
                }),
          ),
        ),
        h(
          'div',
          { className: 'us-legend' },
          LEGEND_SEGMENTS.map((segment) =>
            h(
              'span',
              { key: segment.key, className: 'us-legend-item' },
              h('span', { className: 'us-swatch us-bar-' + segment.key }),
              t(segment.labelKey),
            ),
          ),
          // The dashed line stays in the plot but its value lives here, so a tall bar
          // can never collide with the annotation.
          stats.average > 0
            ? h(
                'span',
                { key: 'avg', className: 'us-legend-item us-legend-avg', title: t('exactValue', { value: exact(Math.round(stats.average)) }) },
                h('span', { className: 'us-avg-swatch', 'aria-hidden': 'true' }),
                t('avgLabel', { value: compact(stats.average) }),
              )
            : null,
        ),
        h('p', { className: 'us-chart-hint' }, t('chartHint')),
      )
    }

    const TimelineCard = React.memo(function TimelineCard(props) {
      const { t, rows, weekly, rangeLabel, rangeTokens, rangeCost } = props
      const empty = rows.length === 0 || rows.every((row) => row.total === 0)
      return h(
        'section',
        { className: 'us-card' },
        h(
          'header',
          { className: 'us-card-head' },
          h(
            'div',
            null,
            h('h2', { className: 'us-card-title' }, t('timelineTitle')),
            h('p', { className: 'us-card-sub' }, t(weekly ? 'timelineWeekly' : 'timelineDaily', { range: rangeLabel })),
          ),
          h('span', { className: 'us-card-tool' }, t('timelineRangeTotal', { tokens: compact(rangeTokens), cost: usd(rangeCost) })),
        ),
        empty ? h(EmptyBlock, { title: t('chartEmptyTitle'), body: t('chartEmptyBody') }) : h(TimelineChart, { t, rows }),
      )
    })

    // ── cost breakdown ─────────────────────────────────────────────────────

    function priceTitleText(t, prices, key) {
      // A price may be configured under `provider/model` or a bare `model`; the Host
      // resolves both, so the tooltip must look up both before calling it a fallback.
      const slash = key.indexOf('/')
      const modelKey = slash === -1 ? key : key.slice(slash + 1)
      const configured = prices.rates[key] !== undefined ? prices.rates[key] : prices.rates[modelKey]
      if (configured !== undefined && (configured.peak !== undefined || configured.offPeak !== undefined)) {
        // Billed by time of day: show both windows so the estimate is explainable.
        const peak = configured.peak ?? {}
        const offPeak = configured.offPeak ?? {}
        return t('peakPriceTitle', {
          peakIn: usd(peak.input),
          peakOut: usd(peak.output),
          peakCache: usd(peak.cacheRead),
          offIn: usd(offPeak.input),
          offOut: usd(offPeak.output),
          offCache: usd(offPeak.cacheRead),
        })
      }
      const rates = configured === undefined ? prices.fallback : configured
      const values = {
        input: usd(rates.input),
        output: usd(rates.output),
        cacheRead: usd(rates.cacheRead),
        cacheWrite: usd(rates.cacheWrite),
      }
      return configured === undefined ? t('fallbackPriceTitle', values) : t('priceTitle', values)
    }

    /** Top models by cost (by tokens when nothing is priced), rest folded into one slice. */
    function buildCostRows(models) {
      const totalCost = models.reduce((sum, model) => sum + model.costUsd, 0)
      const totalTokens = models.reduce((sum, model) => sum + model.tokens.total, 0)
      const byCost = totalCost > 0
      const sorted = models
        .slice()
        .sort((left, right) => (byCost ? right.costUsd - left.costUsd : right.tokens.total - left.tokens.total))
      const top = sorted.slice(0, TOP_MODELS)
      const rows = top.map((model, index) => ({
        key: model.key,
        color: index % TOP_MODELS,
        tokens: model.tokens.total,
        costUsd: model.costUsd,
        calls: model.calls,
        priced: model.priced,
        other: false,
        count: 0,
      }))
      const rest = sorted.slice(TOP_MODELS)
      if (rest.length > 0) {
        rows.push({
          key: 'us-other',
          color: -1,
          tokens: rest.reduce((sum, model) => sum + model.tokens.total, 0),
          costUsd: rest.reduce((sum, model) => sum + model.costUsd, 0),
          calls: rest.reduce((sum, model) => sum + model.calls, 0),
          priced: rest.every((model) => model.priced),
          other: true,
          count: rest.length,
        })
      }
      const shareBase = byCost ? totalCost : totalTokens
      for (const row of rows) {
        row.share = shareBase > 0 ? clamp((byCost ? row.costUsd : row.tokens) / shareBase, 0, 1) : 0
      }
      return { rows, byCost, totalCost, totalTokens, modelCount: models.length }
    }

    /** The ring: one stroke per slice, with the total cost and the model count in the hole. */
    function CostDonut(props) {
      const { t, rows, totalCost, modelCount, activeKey, onActivate } = props
      const gap = rows.length > 1 ? 0.7 : 0
      const slices = []
      let offset = 0
      for (const row of rows) {
        const percent = row.share * 100
        const dash = Math.max(0.6, percent - gap)
        slices.push(
          h('circle', {
            key: row.key,
            className:
              'us-slice us-cfill-' +
              (row.other ? 'other' : row.color) +
              (activeKey === null ? '' : activeKey === row.key ? ' is-active' : ' is-dim'),
            cx: 100,
            cy: 100,
            r: 72,
            pathLength: 100,
            strokeDasharray: dash.toFixed(3) + ' ' + Math.max(0, 100 - dash).toFixed(3),
            strokeDashoffset: (-offset).toFixed(3),
            onPointerEnter: () => onActivate(row.key),
            onPointerLeave: () => onActivate(null),
          }),
        )
        offset += percent
      }
      return h(
        'div',
        { className: 'us-donut' },
        h(
          'svg',
          { viewBox: '0 0 200 200', 'aria-hidden': 'true', focusable: 'false' },
          h('circle', { className: 'us-donut-track', cx: 100, cy: 100, r: 72 }),
          h('g', { transform: 'rotate(-90 100 100)' }, slices),
        ),
        h(
          'div',
          { className: 'us-donut-center' },
          h('span', { className: 'us-donut-total', title: t('exactValue', { value: usdExact(totalCost) }) }, usd(totalCost)),
          h('span', { className: 'us-donut-count' }, t('modelsCount', { count: exact(modelCount) })),
        ),
      )
    }

    const CostCard = React.memo(function CostCard(props) {
      const { t, models, prices, rangeLabel } = props
      const [activeKey, setActiveKey] = useState(null)
      const view = useMemo(() => buildCostRows(models), [models])
      return h(
        'section',
        { className: 'us-card' },
        h(
          'header',
          { className: 'us-card-head' },
          h('div', null, h('h2', { className: 'us-card-title' }, t('costTitle')), h('p', { className: 'us-card-sub' }, t('costSubtitle', { range: rangeLabel }))),
        ),
        models.length === 0
          ? h(EmptyBlock, { title: t('chartEmptyTitle'), body: t('costEmptyBody') })
          : h(
              React.Fragment,
              null,
              view.byCost ? null : h('p', { className: 'us-note us-note-first' }, t('costByTokens')),
              h(
                'div',
                { className: 'us-cost-body' },
                h(CostDonut, {
                  t,
                  rows: view.rows,
                  totalCost: view.totalCost,
                  modelCount: view.modelCount,
                  activeKey,
                  onActivate: setActiveKey,
                }),
                h(
                'div',
                { className: 'us-cost-list', role: 'list' },
                view.rows.map((row) => {
                  const label = row.other ? t('costOther', { count: exact(row.count) }) : modelLabel(row.key, t)
                  return h(
                    'div',
                    {
                      key: row.key,
                      className: 'us-cost-row' + (activeKey === row.key ? ' is-active' : ''),
                      role: 'listitem',
                      tabIndex: 0,
                      'aria-label': t('costRowLabel', { model: label, cost: usd(row.costUsd), share: percentOf(row.share) }),
                      onPointerEnter: () => setActiveKey(row.key),
                      onPointerLeave: () => setActiveKey(null),
                      onFocus: () => setActiveKey(row.key),
                      onBlur: () => setActiveKey(null),
                    },
                    h('span', { className: 'us-swatch us-cfill-' + (row.other ? 'other' : row.color) }),
                    h('span', { className: 'us-cost-name', title: row.other ? undefined : priceTitleText(t, prices, row.key) }, label),
                    row.priced ? null : h('span', { className: 'us-cost-flag' }, t('costUnpriced')),
                    h('span', { className: 'us-cost-value', title: t('costCalls', { count: exact(row.calls) }) }, usd(row.costUsd)),
                    h('span', { className: 'us-cost-share' }, percentOf(row.share)),
                  )
                }),
              ),
              ),
              h('p', { className: 'us-note' }, t('pricesNote', { currency: prices.currency })),
            ),
      )
    })

    // ── session table ──────────────────────────────────────────────────────

    function sessionMatches(session, needle) {
      if (session.title.toLowerCase().includes(needle)) return true
      if (session.cwd.toLowerCase().includes(needle)) return true
      for (const model of session.models) {
        if (model.toLowerCase().includes(needle)) return true
      }
      return false
    }

    const SORTERS = {
      title: (left, right) => (left.title === '' ? left.id : left.title).localeCompare(right.title === '' ? right.id : right.title),
      model: (left, right) => (left.models[0] === undefined ? '' : left.models[0]).localeCompare(right.models[0] === undefined ? '' : right.models[0]),
      tokens: (left, right) => left.tokens.total - right.tokens.total,
      cost: (left, right) => left.costUsd - right.costUsd,
      last: (left, right) => (left.lastActivity === null ? 0 : left.lastActivity) - (right.lastActivity === null ? 0 : right.lastActivity),
    }

    function SortHeader(props) {
      const { t, label, sortKey, sort, onSort, numeric } = props
      const active = sort.key === sortKey
      return h(
        'th',
        {
          scope: 'col',
          className: 'us-th' + (active ? ' is-sorted' : '') + (numeric === true ? ' is-num' : ''),
          'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
        },
        h(
          'button',
          { type: 'button', className: 'us-sort', onClick: () => onSort(sortKey), 'aria-label': t('sortBy', { column: label }) },
          h('span', null, label),
          h(Glyph, { name: active ? (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort', size: 11 }),
        ),
      )
    }

    function DetailItem(props) {
      const { label, value, title, block } = props
      return h(
        'div',
        { className: 'us-detail-item' + (block === true ? ' is-block' : '') },
        h('span', { className: 'us-detail-label' }, label),
        h('span', { className: 'us-detail-value', title }, value),
      )
    }

    function TokenSplit(props) {
      const { t, tokens } = props
      const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
      return h(
        'div',
        { className: 'us-split' },
        h(
          'div',
          { className: 'us-split-bar', 'aria-hidden': 'true' },
          SEGMENTS.map((segment) =>
            tokens[segment.key] > 0
              ? h('span', {
                  key: segment.key,
                  className: 'us-split-seg us-bar-' + segment.key,
                  style: { width: total > 0 ? (tokens[segment.key] / total) * 100 + '%' : '0%' },
                })
              : null,
          ),
        ),
        h(
          'div',
          { className: 'us-split-rows' },
          SEGMENTS.map((segment) =>
            h(
              'div',
              { key: segment.key, className: 'us-split-row' },
              h('span', { className: 'us-swatch us-bar-' + segment.key }),
              h('span', { className: 'us-split-label' }, t(segment.labelKey)),
              h('span', { className: 'us-split-value', title: exact(tokens[segment.key]) }, compact(tokens[segment.key])),
            ),
          ),
        ),
      )
    }

    function SessionDetail(props) {
      const { t, session } = props
      const models = session.models.length === 0 ? '—' : session.models.map((key) => modelLabel(key, t)).join(', ')
      /** Build one column: a title plus its rows, each rendered as a DetailItem. */
      const column = (titleKey, rows) =>
        h(
          'div',
          { className: 'us-detail-col' },
          h('h3', { className: 'us-detail-title' }, t(titleKey)),
          rows
            .filter((row) => row !== undefined)
            .map((row) =>
              row.node !== undefined ? row.node : h(DetailItem, { key: row.label, label: row.label, value: row.value, title: row.title, block: row.block }),
            ),
        )
      return h(
        'div',
        { className: 'us-detail' },
        h(
          'div',
          { className: 'us-detail-col' },
          h('h3', { className: 'us-detail-title' }, t('detailTokens')),
          h(TokenSplit, { t, tokens: session.tokens }),
          h(DetailItem, { label: t('cacheHitLabel'), value: percentOf(session.cacheHitRate) }),
        ),
        column('detailActivity', [
          { label: t('detailRequests'), value: exact(session.requests) },
          { label: t('detailTurns'), value: exact(session.turns) },
          { label: t('detailUserMessages'), value: exact(session.userMessages) },
          { label: t('detailToolCalls'), value: exact(session.toolCalls) },
        ]),
        column('detailTimes', [
          { label: t('detailCreated'), value: fullDateText(session.createdAt) },
          { label: t('detailFirst'), value: fullDateText(session.firstActivity) },
          { label: t('detailLast'), value: fullDateText(session.lastActivity) },
        ]),
        column('detailEnv', [
          { label: t('detailCwd'), value: session.cwd === '' ? '—' : tailPath(session.cwd), title: session.cwd, block: true },
          { label: t('detailModels'), value: models, title: session.models.join(', '), block: true },
          { label: t('detailPreset'), value: session.agentPreset === '' ? '—' : session.agentPreset },
          { label: t('detailOrigin'), value: session.subagent ? t('subagentBadge') : '—' },
          session.priced ? undefined : { node: h('span', { className: 'us-cost-flag' }, t('costUnpriced')) },
        ]),
        // The columns above are range-scoped; the session's whole-life totals stay
        // available as one quieter reference line.
        session.allTime === null
          ? null
          : h(
              'p',
              { className: 'us-detail-alltime' },
              t('detailAllTime', { tokens: compact(session.allTime.tokens.total), cost: usd(session.allTime.costUsd) }),
            ),
      )
    }

    const SessionRow = React.memo(function SessionRow(props) {
      // `localeStamp` is not read here: it only breaks the memo comparison when the UI
      // language changes, so an open table never keeps copy from the previous locale.
      const { t, session, expanded, zebra, onToggle } = props
      const detailId = 'us-session-detail-' + session.id.replace(/[^A-Za-z0-9_-]/g, '_')
      const title = session.title === '' ? t('untitled') : session.title
      const primaryModel = session.models[0] === undefined ? '—' : modelLabel(session.models[0], t)
      const extraModels = session.models.length - 1
      const tokens = session.tokens
      const tokenTitle = t('tokenBreakdownLong', {
        input: exact(tokens.input),
        output: exact(tokens.output),
        cacheRead: exact(tokens.cacheRead),
        cacheWrite: exact(tokens.cacheWrite),
      })
      return h(
        React.Fragment,
        null,
        h(
          'tr',
          { className: 'us-row' + (zebra ? ' is-zebra' : '') + (expanded ? ' is-expanded' : '') },
          h(
            'td',
            { className: 'us-cell' },
            h(
              'div',
              { className: 'us-session' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'us-expand',
                  'aria-expanded': expanded,
                  'aria-controls': expanded ? detailId : undefined,
                  'aria-label': expanded ? t('collapseRow') : t('expandRow'),
                  title: expanded ? t('collapseRow') : t('expandRow'),
                  onClick: () => onToggle(session.id),
                },
                h(Glyph, { name: expanded ? 'chevronDown' : 'chevronRight', size: 11 }),
              ),
              h('span', { className: 'us-session-name', title }, title),
              session.live ? h('span', { className: 'us-live' }, h('span', { className: 'us-live-dot', 'aria-hidden': 'true' }), t('liveBadge')) : null,
              session.subagent ? h('span', { className: 'us-tag' }, t('subagentBadge')) : null,
            ),
          ),
          h(
            'td',
            { className: 'us-cell' },
            h(
              'span',
              { className: 'us-model', title: session.models.length === 0 ? '—' : session.models.join(', ') },
              h('span', { className: 'us-trunc' }, primaryModel),
              extraModels > 0 ? h('span', { className: 'us-more' }, '+' + extraModels) : null,
            ),
          ),
          h('td', { className: 'us-cell us-cell-num' }, h('span', { className: 'us-num', title: tokenTitle }, compact(tokens.total))),
          h('td', { className: 'us-cell us-cell-num' }, h('span', { className: 'us-num', title: usdExact(session.costUsd) }, usd(session.costUsd))),
          h(
            'td',
            { className: 'us-cell us-cell-time' },
            h('span', { title: fullDateText(session.lastActivity) }, shortDateText(session.lastActivity)),
          ),
        ),
        expanded ? h('tr', { className: 'us-row-detail' }, h('td', { className: 'us-cell us-detail-cell', colSpan: 5, id: detailId }, h(SessionDetail, { t, session }))) : null,
      )
    })

    const SessionsTable = React.memo(function SessionsTable(props) {
      const { t, sessions, rangeLabel, localeStamp } = props
      const [query, setQuery] = useState('')
      const [sort, setSort] = useState({ key: 'cost', dir: 'desc' })
      const [expandedId, setExpandedId] = useState(null)
      const [page, setPage] = useState(0)

      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const rows = needle === '' ? sessions.slice() : sessions.filter((session) => sessionMatches(session, needle))
        const compare = SORTERS[sort.key]
        rows.sort((left, right) => (sort.dir === 'asc' ? compare(left, right) : compare(right, left)))
        return rows
      }, [sessions, query, sort])

      const pageSize = visible.length > PAGE_LIMIT ? PAGE_SIZE : Math.max(1, visible.length)
      const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
      const currentPage = Math.min(page, pageCount - 1)
      const pageRows = visible.slice(currentPage * pageSize, currentPage * pageSize + pageSize)

      const onSort = useCallback((key) => {
        setSort((current) =>
          current.key === key
            ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: key === 'title' || key === 'model' ? 'asc' : 'desc' },
        )
        setPage(0)
      }, [])

      const onQuery = useCallback((value) => {
        setQuery(value)
        setPage(0)
      }, [])

      const toggle = useCallback((id) => {
        setExpandedId((current) => (current === id ? null : id))
      }, [])

      const subtitle =
        query === ''
          ? t('sessionsInRange', { range: rangeLabel, count: exact(sessions.length) })
          : t('sessionsInRangeFiltered', { range: rangeLabel, shown: exact(visible.length), total: exact(sessions.length) })

      return h(
        'section',
        { className: 'us-card' },
        h(
          'header',
          { className: 'us-card-head' },
          h('div', null, h('h2', { className: 'us-card-title' }, t('sessionsTitle')), h('p', { className: 'us-card-sub' }, subtitle)),
          h(
            'div',
            { className: 'us-search' },
            h(Glyph, { name: 'search', size: 14 }),
            h('input', {
              type: 'search',
              value: query,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchLabel'),
              onChange: (event) => onQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Escape' && query !== '') {
                  event.preventDefault()
                  onQuery('')
                }
              },
            }),
            query === ''
              ? null
              : h(
                  'button',
                  { type: 'button', className: 'us-search-clear', 'aria-label': t('clearSearch'), title: t('clearSearch'), onClick: () => onQuery('') },
                  h(Glyph, { name: 'close', size: 12 }),
                ),
          ),
        ),
        h(
          'div',
          { className: 'us-table-wrap' },
          h(
            'table',
            { className: 'us-table' },
            h('colgroup', null, h('col', { className: 'us-col-session' }), h('col', { className: 'us-col-model' }), h('col', { className: 'us-col-num' }), h('col', { className: 'us-col-num' }), h('col', { className: 'us-col-time' })),
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h(SortHeader, { t, label: t('colSession'), sortKey: 'title', sort, onSort }),
                h(SortHeader, { t, label: t('colModel'), sortKey: 'model', sort, onSort }),
                h(SortHeader, { t, label: t('colTokens'), sortKey: 'tokens', sort, onSort, numeric: true }),
                h(SortHeader, { t, label: t('colCost'), sortKey: 'cost', sort, onSort, numeric: true }),
                h(SortHeader, { t, label: t('colLastActivity'), sortKey: 'last', sort, onSort }),
              ),
            ),
            h(
              'tbody',
              null,
              pageRows.length === 0
                ? h(
                    'tr',
                    null,
                    h(
                      'td',
                      { className: 'us-cell us-table-empty', colSpan: 5 },
                      query === '' ? h(EmptyBlock, { title: t('sessionsEmptyTitle'), body: t('sessionsEmptyBody') }) : h(EmptyBlock, { title: t('noMatchTitle'), body: t('noMatchBody') }),
                    ),
                  )
                : pageRows.map((session, index) =>
                    h(SessionRow, {
                      key: session.id,
                      t,
                      session,
                      zebra: index % 2 === 1,
                      expanded: expandedId === session.id,
                      localeStamp,
                      onToggle: toggle,
                    }),
                  ),
            ),
          ),
        ),
        pageCount > 1
          ? h(
              'div',
              { className: 'us-pager' },
              h('button', { type: 'button', className: 'us-button', disabled: currentPage === 0, onClick: () => setPage(currentPage - 1) }, t('pagePrev')),
              h('span', { className: 'us-pager-info' }, t('pageOf', { page: exact(currentPage + 1), total: exact(pageCount) })),
              h('button', { type: 'button', className: 'us-button', disabled: currentPage >= pageCount - 1, onClick: () => setPage(currentPage + 1) }, t('pageNext')),
            )
          : null,
      )
    })

    // ── page header ────────────────────────────────────────────────────────

    function PageHeader(props) {
      const { t, days, onRange, onRefresh, refreshBusy, scan, generatedAt } = props
      const scanning = scan.state === 'scanning'
      return h(
        'header',
        { className: 'us-head' },
        h(
          'div',
          { className: 'us-head-text' },
          h('h1', { className: 'us-title' }, t('title')),
          h('p', { className: 'us-subtitle' }, t('subtitle')),
        ),
        h(
          'div',
          { className: 'us-head-tools' },
          scanning
            ? h(
                'span',
                { className: 'us-pill us-pill-live', 'aria-live': 'polite' },
                h('span', { className: 'us-pill-dot', 'aria-hidden': 'true' }),
                t('scanningPill', { scanned: exact(scan.scanned), total: exact(scan.total) }),
              )
            : null,
          h(
            'div',
            { className: 'us-seg', role: 'group', 'aria-label': t('rangeLabel') },
            RANGE_OPTIONS.map((option) =>
              h(
                'button',
                {
                  key: option.days,
                  type: 'button',
                  className: 'us-seg-btn' + (days === option.days ? ' is-active' : ''),
                  'aria-pressed': days === option.days,
                  onClick: () => onRange(option.days),
                },
                t(option.label),
              ),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'us-icon-button' + (refreshBusy ? ' is-busy' : ''),
              'aria-label': t('refresh'),
              title: t('refreshHint'),
              'aria-busy': refreshBusy,
              disabled: refreshBusy,
              onClick: onRefresh,
            },
            h(Glyph, { name: 'refresh', size: 15 }),
          ),
          h('span', { className: 'us-updated' }, generatedAt === null ? t('notUpdated') : t('updatedAt', { time: clockText(generatedAt) })),
        ),
      )
    }

    // ── page ───────────────────────────────────────────────────────────────

    const EMPTY_CHART = Object.freeze({ rows: [], weekly: false })

    function UsageStatsPage(props) {
      const t = props.t
      // A locale switch does not change `t`'s identity, so the memoized cards would
      // compare equal; this stamp changes with the language and re-renders their copy.
      const localeStamp = t('panel')
      const [days, setDays] = useState(DEFAULT_DAYS)
      const [fullPayload, setFullPayload] = useState(null)
      const [live, setLive] = useState(null)
      const [fullError, setFullError] = useState(null)
      const [refreshError, setRefreshError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshBusy, setRefreshBusy] = useState(false)

      const aliveRef = useRef(true)
      const daysRef = useRef(days)
      const revisionRef = useRef(-1)
      const payloadRef = useRef(null)
      const fullAbortRef = useRef(null)
      const liveAbortRef = useRef(null)
      const refreshBusyRef = useRef(false)
      const sawScanningRef = useRef(false)
      const refreshTimerRef = useRef(0)
      const refreshStartedAtRef = useRef(0)

      const setBusy = useCallback((value) => {
        refreshBusyRef.current = value
        setRefreshBusy(value)
        window.clearTimeout(refreshTimerRef.current)
        if (!value) {
          refreshTimerRef.current = 0
          return
        }
        refreshTimerRef.current = window.setTimeout(() => {
          refreshBusyRef.current = false
          setRefreshBusy(false)
        }, REFRESH_TIMEOUT_MS)
      }, [])

      // Every network path is cancelled on unmount; nothing sets state afterwards.
      useEffect(() => {
        aliveRef.current = true
        return () => {
          aliveRef.current = false
          window.clearTimeout(refreshTimerRef.current)
          if (fullAbortRef.current !== null) fullAbortRef.current.abort()
          if (liveAbortRef.current !== null) liveAbortRef.current.abort()
        }
      }, [])

      useEffect(() => {
        daysRef.current = days
      }, [days])

      const loadFull = useCallback(async (nextDays) => {
        if (fullAbortRef.current !== null) fullAbortRef.current.abort()
        const controller = new AbortController()
        fullAbortRef.current = controller
        // Only the very first payload (or a retry after an error) replaces the page
        // with a skeleton; range changes and post-scan refetches keep the old content.
        const replace = payloadRef.current === null
        if (replace) setLoading(true)
        try {
          const data = normalizeFull(await getJson('/dsh-usage-stats?days=' + nextDays, { signal: controller.signal }))
          if (!aliveRef.current || controller.signal.aborted || data === null) return
          payloadRef.current = data
          revisionRef.current = data.revision
          setFullPayload(data)
          setFullError(null)
          setRefreshError(null)
          setLoading(false)
        } catch (error) {
          if (!aliveRef.current || controller.signal.aborted) return
          const message = error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
          if (payloadRef.current === null) setFullError(message)
          setLoading(false)
        } finally {
          if (fullAbortRef.current === controller) fullAbortRef.current = null
        }
      }, [])

      // First load and every range change.
      useEffect(() => {
        loadFull(days)
      }, [days, loadFull])

      const requestRefresh = useCallback(async () => {
        if (refreshBusyRef.current) return
        setBusy(true)
        refreshStartedAtRef.current = Date.now()
        sawScanningRef.current = false
        setRefreshError(null)
        try {
          await getJson('/dsh-usage-stats/refresh', { method: 'POST' })
        } catch (error) {
          if (!aliveRef.current) return
          setBusy(false)
          const message = error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error)
          setRefreshError(message)
          return
        }
        // Reload immediately so the scan's partial progress is visible, then let the
        // poll pick up each further revision bump until the scan goes idle.
        if (aliveRef.current) loadFull(daysRef.current)
      }, [setBusy, loadFull])

      // The cheap poll: updates the summary, refetches the full payload only when the
      // Host revision moved, and stops itself while the page is hidden.
      useEffect(() => {
        let disposed = false
        let timer = 0
        let inFlight = false

        function clearTimer() {
          if (timer !== 0) {
            window.clearTimeout(timer)
            timer = 0
          }
        }

        function schedule() {
          clearTimer()
          if (disposed) return
          timer = window.setTimeout(run, POLL_MS)
        }

        async function run() {
          timer = 0
          if (disposed) return
          if (document.hidden) {
            schedule()
            return
          }
          if (inFlight) {
            schedule()
            return
          }
          inFlight = true
          try {
            const controller = new AbortController()
            liveAbortRef.current = controller
            const data = normalizeLive(await getJson('/dsh-usage-stats/live', { signal: controller.signal }))
            if (liveAbortRef.current === controller) liveAbortRef.current = null
            if (disposed || !aliveRef.current || data === null) return
            setLive(data)
            // A revision bump — or a first load that never succeeded — refetches the
            // full payload; an in-flight fetch is aborted by loadFull itself.
            if (fullAbortRef.current === null && data.revision !== revisionRef.current) {
              loadFull(daysRef.current)
            }
            if (refreshBusyRef.current) {
              if (data.scan.state === 'scanning') {
                sawScanningRef.current = true
              } else if (
                sawScanningRef.current ||
                data.revision !== revisionRef.current ||
                Date.now() - refreshStartedAtRef.current > REFRESH_STALL_MS
              ) {
                sawScanningRef.current = false
                setBusy(false)
              }
            }
          } catch (_error) {
            /* keep the last good state; the next tick retries */
          } finally {
            inFlight = false
            schedule()
          }
        }

        function onVisibilityChange() {
          if (!document.hidden) {
            clearTimer()
            run()
          }
        }

        document.addEventListener('visibilitychange', onVisibilityChange)
        run()
        return () => {
          disposed = true
          clearTimer()
          document.removeEventListener('visibilitychange', onVisibilityChange)
          if (liveAbortRef.current !== null) {
            liveAbortRef.current.abort()
            liveAbortRef.current = null
          }
        }
      }, [days, loadFull, setBusy])

      const chart = useMemo(() => (fullPayload === null ? EMPTY_CHART : buildBuckets(fullPayload.range.timeline, fullPayload.range.days)), [fullPayload])

      const onRange = useCallback((next) => {
        setDays(next)
      }, [])

      const summary = live !== null ? live : fullPayload
      const scan = summary !== null ? summary.scan : null
      const scanning = scan !== null && scan.state === 'scanning'
      const hasData = fullPayload !== null
      const isEmpty = hasData && summary.totals.sessions === 0 && fullPayload.sessions.length === 0
      // The Host echoes the range it served; fall back to the requested window so the
      // label, the daily average and the chart never disagree with the control.
      const rangeDays = fullPayload === null ? days : fullPayload.range.days > 0 ? fullPayload.range.days : days
      const span = fullPayload === null ? 1 : spanOf(rangeDays, fullPayload.range.timeline)
      // One label shared by the cards that now describe the selected range.
      const rangeLabel = rangeLabelText(t, rangeDays)

      // One entry per problem worth telling the user about; each can offer a retry.
      const notices = []
      const pushNotice = (key, message, onRetry) => {
        notices.push(
          h(
            Notice,
            {
              key,
              icon: 'alert',
              action: onRetry === undefined ? undefined : h('button', { type: 'button', className: 'us-notice-action', onClick: onRetry }, t('retry')),
            },
            message,
          ),
        )
      }
      if (scan !== null && scan.lastError !== null) pushNotice('scan-failed', t('lastScanFailed', { message: scan.lastError }), requestRefresh)
      if (refreshError !== null) pushNotice('refresh-failed', t('refreshFailed', { message: refreshError }))
      // A failed refetch keeps the last good payload on screen; say so instead of
      // silently showing stale numbers.
      if (hasData && fullError !== null) pushNotice('refetch-failed', t('loadFailed', { message: fullError }), () => loadFull(days))

      let body
      if (!hasData) {
        body = fullError !== null ? h(ErrorBlock, { t, message: fullError, onRetry: () => loadFull(days) }) : h(LoadingBlock, { t })
      } else if (isEmpty) {
        // A cold first index has no sessions yet: show the skeleton, not "no data",
        // while the progress pill keeps counting in the header.
        body = scanning ? h(LoadingBlock, { t }) : h(EmptyBlock, { title: t('emptyTitle'), body: t('emptyBody') })
      } else {
        body = h(
          React.Fragment,
          null,
          h(RangeHero, { t, rangeDays, range: fullPayload.range, span }),
          h(KpiRow, {
            t,
            totals: summary.totals,
            range: fullPayload.range,
            delta: fullPayload.range.delta,
            span,
          }),
          h(TimelineCard, {
            t,
            localeStamp,
            rows: chart.rows,
            weekly: chart.weekly,
            rangeLabel,
            rangeTokens: fullPayload.range.tokens.total,
            rangeCost: fullPayload.range.costUsd,
          }),
          // Both sections are single full-width cards stacked vertically.
          h(CostCard, { t, localeStamp, models: fullPayload.range.models, prices: fullPayload.prices, rangeLabel }),
          h(SessionsTable, { t, localeStamp, sessions: fullPayload.sessions, rangeLabel }),
          h(
            'footer',
            { className: 'us-foot' },
            h('span', null, t('sourceNote')),
            h('span', { className: 'us-foot-sep', 'aria-hidden': 'true' }, '·'),
            h('span', null, t('versionLabel', { version: VERSION })),
            h('span', { className: 'us-foot-sep', 'aria-hidden': 'true' }, '·'),
            h('span', null, scan !== null && scan.elapsedMs !== null ? t('scanElapsed', { value: durationText(t, scan.elapsedMs) }) : t('scanNever')),
          ),
        )
      }

      return h(
        'section',
        { className: 'us-page', 'data-usage-stats': 'true', 'aria-busy': loading },
        h(
          'div',
          { className: 'us-scroll' },
          h(
            'div',
            { className: 'us-content' },
            h(PageHeader, {
              t,
              days,
              onRange,
              onRefresh: requestRefresh,
              refreshBusy,
              scan: scan !== null ? scan : { state: 'idle', total: 0, scanned: 0 },
              generatedAt: summary !== null ? summary.generatedAt : null,
            }),
            notices,
            body,
          ),
        ),
      )
    }

    // ── styles ─────────────────────────────────────────────────────────────

    /** Plugin-owned global stylesheet: only `--dsw-*` tokens carry color. */
    const STYLES = `
.us-page{--us-seg-input:var(--dsw-alias-state-business-primary);--us-seg-output:var(--dsw-alias-state-warn-primary);--us-seg-cacheRead:var(--dsw-alias-brand-primary);--us-seg-cacheWrite:color-mix(in srgb,var(--dsw-alias-label-tertiary) 70%,transparent);position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:1.6}
.us-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.us-content{max-width:1264px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 72px}
.us-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:16px}
[data-platform=darwin] .us-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.us-head-text{min-width:0}
.us-title{margin:0;font-size:22px;font-weight:600;line-height:30px;letter-spacing:-.01em}
.us-subtitle{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.us-head-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.us-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}
.us-pill-live{color:var(--dsw-alias-label-secondary)}
.us-pill-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);animation:us-pulse 1.4s ease-in-out infinite}
.us-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:.5px solid var(--dsw-alias-border-l3);border-radius:11px;background:var(--dsw-alias-bg-layer-1)}
.us-seg-btn{height:26px;padding:0 10px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s}
.us-seg-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.us-seg-btn.is-active{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:500}
.us-icon-button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:15px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s,opacity .15s}
.us-icon-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.us-icon-button:disabled{opacity:.55;cursor:default}
.us-icon-button.is-busy svg{animation:us-spin .9s linear infinite}
.us-updated{color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px;white-space:nowrap;font-variant-numeric:tabular-nums}
.us-notice{display:flex;align-items:center;gap:8px;margin:0 0 14px;padding:8px 12px;border:.5px solid var(--dsw-alias-border-l3);border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.us-notice-text{min-width:0;overflow-wrap:anywhere}
.us-notice-action{flex:none;margin-left:auto;height:24px;padding:0 10px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.us-notice-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.us-hero{display:flex;flex-wrap:wrap;align-items:center;gap:clamp(18px,3vw,40px);margin-bottom:14px;padding:16px 20px;border:.5px solid var(--dsw-alias-border-l3);border-left:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 60%,transparent);border-radius:18px;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1) 62%)}
.us-hero-figure{display:flex;flex-direction:column;gap:2px;min-width:0}
.us-hero-label{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;letter-spacing:.02em;white-space:nowrap}
.us-hero-value{font-size:clamp(34px,3.4vw,40px);font-weight:600;line-height:1.05;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.us-hero-facts{display:flex;flex-wrap:wrap;align-items:flex-start;gap:clamp(16px,2.4vw,36px);min-width:0;padding-left:clamp(16px,2.4vw,36px);border-left:.5px solid var(--dsw-alias-border-l3)}
.us-hero-fact{display:flex;flex-direction:column;gap:1px;min-width:0}
.us-hero-fact-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.us-hero-fact-value{color:var(--dsw-alias-label-primary);font-size:15px;line-height:22px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap}
.us-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}
.us-kpi{display:flex;flex-direction:column;gap:8px;min-width:0;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
.us-kpi-head{display:flex;align-items:center;gap:8px;min-height:22px}
.us-kpi-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.us-kpi-icon.is-brand{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary)}
.us-kpi-icon.is-business{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);color:var(--dsw-alias-state-business-primary)}
.us-kpi-icon.is-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary)}
.us-kpi-icon.is-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent);color:var(--dsw-alias-state-warn-primary)}
.us-kpi-label{min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.us-kpi-scope{margin-left:auto;flex:none;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap}
.us-kpi-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;min-width:0}
.us-kpi-value{font-size:26px;font-weight:600;line-height:32px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.us-kpi-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.us-delta{display:inline-flex;align-items:center;gap:2px;flex:none;height:20px;padding:0 6px 0 5px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}
.us-delta.is-up{color:var(--dsw-alias-state-success-primary)}
.us-delta.is-down{color:var(--dsw-alias-label-secondary)}
.us-delta.is-flat{color:var(--dsw-alias-label-caption)}
.us-delta-mark{font-size:11px;line-height:1}
.us-delta-value{font-weight:500}
.us-card{margin-bottom:16px;padding:16px 18px 18px;border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
.us-card-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:14px}
.us-card-title{margin:0;font-size:15px;font-weight:600;line-height:22px}
.us-card-sub{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.us-card-tool{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.us-chart-wrap{position:relative}
.us-chart-plot{position:relative}
.us-chart{display:block;width:100%;height:auto;touch-action:pan-y}
.us-chart text{fill:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.us-grid-line{stroke:var(--dsw-alias-border-l2);stroke-width:1;stroke-dasharray:2 4}
.us-axis-line{stroke:var(--dsw-alias-border-l3);stroke-width:1}
.us-hit{fill:transparent;cursor:pointer}
.us-active-band{fill:var(--dsw-alias-interactive-bg-hover);opacity:.7}
.us-bar{pointer-events:none}
.us-bar-input{fill:var(--us-seg-input);background:var(--us-seg-input)}
.us-bar-output{fill:var(--us-seg-output);background:var(--us-seg-output)}
.us-bar-cacheRead{fill:var(--us-seg-cacheRead);background:var(--us-seg-cacheRead)}
.us-bar-cacheWrite{fill:var(--us-seg-cacheWrite);background:var(--us-seg-cacheWrite)}
.us-avg-line{stroke:var(--dsw-alias-label-caption);stroke-width:1;stroke-dasharray:4 4;opacity:.75}
.us-peak-label{fill:var(--dsw-alias-label-secondary);font-size:10px;font-weight:500}
.us-chart-tip{position:absolute;z-index:2;min-width:150px;max-width:230px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv2);font-size:12px;line-height:18px;pointer-events:none;transform:translate(-50%,calc(-100% - 6px))}
.us-tip-day{margin:0 0 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums}
.us-tip-row{display:flex;align-items:center;justify-content:space-between;gap:12px;white-space:nowrap}
.us-tip-label{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary)}
.us-tip-value{font-variant-numeric:tabular-nums}
.us-tip-sep{height:1px;margin:4px 0;background:var(--dsw-alias-border-l2)}
.us-swatch{display:inline-block;width:8px;height:8px;border-radius:2px;flex:none}
.us-legend{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:8px}
.us-legend-item{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.us-legend-avg{margin-left:2px;padding-left:12px;border-left:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
.us-avg-swatch{display:inline-block;width:18px;height:0;border-top:1.5px dashed var(--dsw-alias-label-caption);opacity:.9}
.us-chart-hint{margin:6px 0 0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.us-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.us-donut{position:relative;width:min(200px,100%);aspect-ratio:1;flex:none;margin:0}
/* One full-width card: the ring on the left, its ranked legend on the right. */
.us-cost-body{display:grid;grid-template-columns:minmax(170px,220px) minmax(0,1fr);gap:28px;align-items:center}
@media (width<=820px){.us-cost-body{grid-template-columns:minmax(0,1fr);gap:16px}.us-donut{margin:0 auto}}
.us-donut svg{display:block;width:100%;height:100%;overflow:visible}
.us-donut-track{fill:none;stroke:var(--dsw-alias-bg-layer-2);stroke-width:30}
.us-slice{fill:none;stroke:var(--us-slice);stroke-width:30;cursor:pointer;transition:opacity .15s,stroke-width .15s}
.us-slice.is-dim{opacity:.3}
.us-slice.is-active{stroke-width:34}
.us-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:0 18px;text-align:center;pointer-events:none}
.us-donut-total{font-size:20px;font-weight:600;line-height:26px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.us-donut-count{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.us-cfill-0{--us-slice:var(--dsw-alias-brand-primary);background:var(--us-slice)}
.us-cfill-1{--us-slice:var(--dsw-alias-state-business-primary);background:var(--us-slice)}
.us-cfill-2{--us-slice:var(--dsw-alias-state-warn-primary);background:var(--us-slice)}
.us-cfill-3{--us-slice:var(--dsw-alias-state-success-primary);background:var(--us-slice)}
.us-cfill-4{--us-slice:color-mix(in srgb,var(--dsw-alias-brand-primary) 58%,var(--dsw-alias-label-primary));background:var(--us-slice)}
.us-cfill-5{--us-slice:color-mix(in srgb,var(--dsw-alias-state-success-primary) 52%,var(--dsw-alias-label-tertiary));background:var(--us-slice)}
.us-cfill-6{--us-slice:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 52%,var(--dsw-alias-label-tertiary));background:var(--us-slice)}
.us-cfill-7{--us-slice:color-mix(in srgb,var(--dsw-alias-state-business-primary) 48%,var(--dsw-alias-state-success-primary));background:var(--us-slice)}
.us-cfill-other{--us-slice:color-mix(in srgb,var(--dsw-alias-label-tertiary) 55%,transparent);background:var(--us-slice)}
.us-cost-list{display:flex;flex-direction:column;gap:2px;width:100%;min-width:0}
.us-cost-row{display:flex;align-items:center;gap:8px;min-width:0;padding:6px;border-radius:8px;cursor:default;transition:background .12s}
.us-cost-row.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.us-cost-row .us-swatch{width:10px;height:10px;border-radius:3px}
.us-cost-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}
.us-cost-value{flex:none;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.us-cost-share{flex:none;width:38px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}
.us-cost-flag{padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:11px;line-height:16px;white-space:nowrap}
.us-note{margin:12px 0 0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:17px}
.us-note-first{margin:0 0 12px}
.us-search{display:flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);transition:border-color .15s}
.us-search:hover{border-color:var(--dsw-alias-border-l2)}
.us-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.us-search input{width:200px;min-width:0;padding:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.us-search input::placeholder{color:var(--dsw-alias-label-caption)}
.us-search input::-webkit-search-cancel-button{display:none}
.us-search-clear{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.us-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* The list scrolls inside a viewport exactly six rows tall. */
.us-table-wrap{--us-row-h:40px;max-height:calc(30px + var(--us-row-h) * 6);overflow:auto;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.us-row>.us-cell{height:var(--us-row-h)}
.us-table{width:100%;min-width:660px;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:13px}
.us-col-session{width:38%}
.us-col-model{width:20%}
.us-col-num{width:12%}
.us-col-time{width:18%}
.us-th{position:sticky;top:0;z-index:1;padding:0 10px 8px;border-bottom:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:12px;line-height:18px;text-align:left;white-space:nowrap}
.us-th:first-child{padding-left:2px}
.us-th.is-sorted{color:var(--dsw-alias-label-secondary)}
.us-th.is-num{text-align:right}
.us-sort{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
.us-sort:hover{color:var(--dsw-alias-label-primary)}
.us-th.is-num .us-sort{flex-direction:row-reverse}
.us-cell{padding:9px 10px;border-bottom:.5px solid var(--dsw-alias-border-l3);text-align:left;vertical-align:middle;font-variant-numeric:tabular-nums;transition:background .12s}
.us-cell:first-child{padding-left:2px}
.us-cell-num{text-align:right}
.us-cell-time{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.us-row.is-zebra .us-cell{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 42%,transparent)}
.us-row:hover .us-cell{background:var(--dsw-alias-interactive-bg-hover)}
.us-row.is-expanded .us-cell{background:var(--dsw-alias-bg-layer-2)}
.us-session{display:flex;align-items:center;gap:6px;min-width:0}
.us-expand{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.us-expand:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.us-session-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.us-live{flex:none;display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary);font-size:11px;line-height:16px;white-space:nowrap}
.us-live-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.us-tag{flex:none;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.us-model{display:inline-flex;align-items:center;gap:3px;max-width:100%;min-width:0;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
.us-model .us-trunc{min-width:0}
.us-trunc{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.us-more{margin-left:4px;color:var(--dsw-alias-label-caption);font-size:11px}
.us-num{font-variant-numeric:tabular-nums}
.us-row-detail .us-cell{padding:0;border-bottom:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.us-row-detail .us-detail-cell{padding:0 0 14px}
.us-detail{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px 22px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.us-detail-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.us-detail-title{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.us-detail-item{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0}
.us-detail-item.is-block{flex-direction:column;align-items:flex-start;gap:1px}
.us-detail-label{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.us-detail-value{min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.us-detail-item.is-block .us-detail-value{text-align:left}
.us-detail-alltime{grid-column:1/-1;margin:0;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.us-split{min-width:0}
.us-split-bar{display:flex;height:6px;margin-bottom:6px;border-radius:3px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.us-split-seg{height:100%}
.us-split-rows{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px}
.us-split-row{display:flex;align-items:center;gap:5px;min-width:0;font-size:11px;line-height:16px}
.us-split-label{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.us-split-value{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.us-table-empty{padding:0;background:transparent}
.us-pager{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px}
.us-pager-info{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.us-button{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background .15s,opacity .15s}
.us-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.us-button:disabled{opacity:.45;cursor:default}
.us-button-primary{margin-top:14px;border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.us-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.us-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:44px 24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.us-empty-glyph{color:var(--dsw-alias-label-caption)}
.us-empty-title{margin:10px 0 0;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:500;line-height:22px}
.us-empty-body{max-width:420px;margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:21px;overflow-wrap:anywhere}
.us-loading-text{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:16px}
.us-loading-title{color:var(--dsw-alias-label-secondary);font-size:13px}
.us-loading-hint{color:var(--dsw-alias-label-caption);font-size:12px}
.us-skeleton{display:flex;flex-direction:column;gap:14px}
.us-skel-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.us-skel{position:relative;overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.us-skel::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,var(--dsw-alias-bg-layer-2),transparent);transform:translateX(-100%);animation:us-shimmer 1.6s ease-in-out infinite}
.us-skel-hero{height:104px;border-radius:18px}
.us-skel-kpi{height:118px}
.us-skel-chart{height:320px}
.us-skel-side{height:190px}
.us-skel-table{display:flex;flex-direction:column;gap:8px}
.us-skel-row{height:34px;border-radius:8px}
.us-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:22px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-caption);font-size:11px;line-height:17px}
.us-foot-sep{opacity:.6}
.us-page :focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
@keyframes us-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes us-spin{to{transform:rotate(360deg)}}
@keyframes us-shimmer{100%{transform:translateX(100%)}}
@media (hover:none){.us-row:hover .us-cell{background:transparent}.us-row.is-zebra .us-cell{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 42%,transparent)}}
@media (width<=1100px){.us-skel-table{display:flex}}
@media (width<=760px){.us-search input{width:120px}.us-content{padding-bottom:48px}.us-kpi-value{font-size:22px;line-height:28px}.us-head{align-items:flex-start}.us-hero{padding:14px 16px}.us-hero-facts{padding-left:0;border-left:0}}
@media (prefers-reduced-motion:reduce){.us-pill-dot,.us-icon-button.is-busy svg,.us-skel::after{animation:none}.us-slice,.us-cost-row,.us-seg-btn,.us-icon-button,.us-button,.us-search,.us-cell{transition:none}}
`

    // ── plugin ─────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale']

    /**
     * Contribute the sidebar entry, its panel page, and the shared stylesheet.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-stats: dictionaries')

      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'usage-stats'
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => {
          style.remove()
        }
      }, 'usage-stats: styles')

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            locale: NS,
            label: () => t('panel'),
          },
          UsageStatsIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
          },
          UsageStatsPage,
        ),
      )
    }

    return { inject, apply }
  },
})
