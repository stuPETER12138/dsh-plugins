/**
 * Session share — browser half of `@local/dsh-session-share`.
 *
 * Contributes one Conversation View tab ("分享") next to Chat, Trajectory and
 * Statistics. The tab body lists the current Session's messages with
 * checkboxes and exports the selection as Markdown, a PNG image, or a PDF.
 *
 * Conversation text comes from the Host half over
 * `GET /dsh-session-share/transcript`; this module never opens a session log.
 * The export engine (`createExportCore`) is inlined above this file by
 * `tools/build-client.mjs` — edit src/export-core.js and rebuild.
 *
 * View tabs are ordinary `conversation.view` list-slot registrations: the
 * shipped Conversation shell lists every occupant of that slot as a tab and
 * renders the selected one with `renderSlot(..., { only: id })`. No
 * Conversation target definition is needed because this view renders its own
 * data instead of conversation nodes.
 *
 * All UI color comes from `--dsw-alias-*` theme tokens; every resource is owned
 * by the plugin fiber, so disabling the plugin removes the tab and styles.
 *
 * @module @local/dsh-session-share/client
 */

const NS = 'sessionShare'
const ROUTE_TRANSCRIPT = '/dsh-session-share/transcript'
const PREFS_KEY = 'dsh.session-share.prefs.v1'
const DIALOG_MAX_ITEMS = 4000

// ── locale ──────────────────────────────────────────────────────────────────

const zh = {
  viewShare: '分享',
  panelTitle: '分享当前对话',
  panelSubtitle: '选择要分享的消息，导出为 Markdown、图片或 PDF。',
  refresh: '刷新',
  refreshTitle: '重新读取这个会话的消息',
  roleUser: '你',
  roleAssistant: '助手',
  roleTool: '工具调用',
  roleNote: '备注',
  selectAll: '全选',
  selectNone: '清空',
  selectedPrefix: '已选 ',
  selectedUnit: ' 条消息',
  charsPrefix: '约 ',
  charsUnit: ' 字',
  formatLabel: '导出格式',
  formatMd: 'Markdown',
  formatImage: '图片',
  formatPdf: 'PDF',
  includeTools: '包含工具调用',
  includeTimes: '包含时间',
  copy: '复制 Markdown',
  copied: '已复制到剪贴板。',
  copyFailed: '浏览器不允许访问剪贴板，请改用下载。',
  downloadMd: '下载 .md',
  downloadImage: '下载图片',
  downloadPdf: '下载 PDF',
  generatingImage: '正在生成图片…',
  generatingPdf: '正在生成 PDF…',
  generatingMd: '正在准备 Markdown…',
  exported: '已开始下载。',
  exportFailed: '导出失败：',
  loadFailed: '读取会话失败：',
  retry: '重试',
  loading: '正在读取会话…',
  empty: '这个会话还没有可分享的内容。',
  noSession: '无法确定当前会话，请先打开一个会话再试。',
  truncatedBanner: '会话内容较长，这里只包含最近的部分消息。',
  partialBanner: '这个会话较早的历史还没加载出来，当前列表可能不完整；稍等片刻再点「刷新」。',
  privacyNote: '导出文件只保存在本机，不会上传。',
  imageScaled: '内容较长，图片已按比例缩小；PDF 不受影响。',
  pdfPagesPrefix: '共 ',
  pdfPagesUnit: ' 页',
}

const en = {
  viewShare: 'Share',
  panelTitle: 'Share this conversation',
  panelSubtitle: 'Pick the messages to share and export them as Markdown, an image, or a PDF.',
  refresh: 'Refresh',
  refreshTitle: 'Read this conversation again',
  roleUser: 'You',
  roleAssistant: 'Assistant',
  roleTool: 'Tool calls',
  roleNote: 'Note',
  selectAll: 'Select all',
  selectNone: 'Clear',
  selectedPrefix: 'Selected ',
  selectedUnit: ' messages',
  charsPrefix: '~',
  charsUnit: ' chars',
  formatLabel: 'Format',
  formatMd: 'Markdown',
  formatImage: 'Image',
  formatPdf: 'PDF',
  includeTools: 'Include tool calls',
  includeTimes: 'Include timestamps',
  copy: 'Copy Markdown',
  copied: 'Copied to the clipboard.',
  copyFailed: 'The browser blocked clipboard access; use the download instead.',
  downloadMd: 'Download .md',
  downloadImage: 'Download image',
  downloadPdf: 'Download PDF',
  generatingImage: 'Generating image…',
  generatingPdf: 'Generating PDF…',
  generatingMd: 'Preparing Markdown…',
  exported: 'Download started.',
  exportFailed: 'Export failed: ',
  loadFailed: 'Could not read the conversation: ',
  retry: 'Retry',
  loading: 'Reading the conversation…',
  empty: 'This conversation has nothing to share yet.',
  noSession: 'The current conversation could not be determined; open a conversation and retry.',
  truncatedBanner: 'The conversation is long, so only its most recent messages are listed.',
  partialBanner: 'Older history for this conversation is not available yet, so this list may be incomplete; wait a moment and press Refresh.',
  privacyNote: 'Exported files stay on this machine and are never uploaded.',
  imageScaled: 'The content is long, so the image was scaled down; the PDF is unaffected.',
  pdfPagesPrefix: '',
  pdfPagesUnit: ' pages',
}

// ── glyphs ──────────────────────────────────────────────────────────────────

/** 16px outline glyphs; strokes take `currentColor`. */
const GLYPHS = {
  share: ['M6 10.2V3.4m0 0L3.4 6M6 3.4 8.6 6', 'M3 11.7v.9c0 .5.4.9.9.9h4.2c.5 0 .9-.4.9-.9v-.9'],
  refresh: ['M13.2 8a5.2 5.2 0 1 1-1.6-3.8', 'M13.4 2.6v2.9h-2.9'],
  check: ['M3 8.4l3.1 3.1L13 4.9'],
  copy: [
    'M5.6 2.5h7c.6 0 1 .5 1 1v7c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.5.4-1 1-1Z',
    'M10.6 11.5v1c0 .8-.7 1.5-1.5 1.5H3.5C2.7 14 2 13.3 2 12.5V7c0-.8.7-1.5 1.5-1.5h1.1',
  ],
  download: ['M8 2.6v8.6', 'M4.9 8.4 8 11.5l3.1-3.1', 'M2.8 13.4h10.4'],
  markdown: ['M2.6 4.4h10.8v7.2H2.6z', 'M4.6 9.6V6.6l1.5 1.8 1.5-1.8v3', 'M9.9 6.6v3m0 0 1.1-1.1M10.9 9.6l-1-1.1'],
  image: ['M2.6 3.4h10.8v9.2H2.6z', 'M2.6 10.6 6 7.4l2.4 2.2 1.9-1.6 3.1 2.6', 'M10.6 6.3a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0Z'],
  file: ['M4.1 1.9h4.6l3.2 3.2v9H4.1z', 'M8.6 2v3.2h3.2', 'M5.9 8.4h4.2M5.9 10.8h4.2'],
}

function Glyph({ name, size = 16 }) {
  const paths = GLYPHS[name]
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
    paths.map((d, index) => h('path', { key: index, d, stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' })),
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Locale translator for a slot component, with the plugin binding as fallback. */
let fallbackT = (key) => key
function translatorOf(props) {
  return typeof props?.t === 'function' ? props.t : fallbackT
}

function useAbsentSnapshot() {
  return undefined
}

/** The Session id published by the slot's standard props, or the main-view one. */
function mainSessionIdOf(byId) {
  if (byId === null || byId === undefined || typeof byId !== 'object') return null
  for (const id of Object.keys(byId)) {
    if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return null
}

/**
 * Session-scoped slots publish the Session id as a plain `sessionId` prop plus
 * the `useSessions` standard hook; read both and keep the hook call stable.
 */
function useSessionId(props) {
  const useList = typeof props?.useSessions === 'function' ? props.useSessions : useAbsentSnapshot
  const sessions = useList((snapshot) => snapshot)
  if (typeof props?.sessionId === 'string' && props.sessionId !== '') return props.sessionId
  const nested = props?.session?.id ?? props?.session?.sessionId
  if (typeof nested === 'string' && nested !== '') return nested
  return mainSessionIdOf(sessions?.byId)
}

function shortTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  } catch (_error) {
    return ''
  }
}

function readPrefs() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null')
    if (parsed === null || typeof parsed !== 'object') return {}
    return parsed
  } catch (_error) {
    return {}
  }
}

function writePrefs(patch) {
  try {
    const next = { ...readPrefs(), ...patch }
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next))
  } catch (_error) {
    /* a blocked store only loses the remembered choices */
  }
}

function safeFilename(text) {
  return String(text ?? '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

function exportFilename(session, extension) {
  const title = safeFilename(session?.title) || '会话分享'
  const stamp = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const time = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
  return `${title}-${time}.${extension}`
}

function roleKey(kind) {
  if (kind === 'user') return 'roleUser'
  if (kind === 'assistant') return 'roleAssistant'
  if (kind === 'tool') return 'roleTool'
  return 'roleNote'
}

function primaryLabel(t, format) {
  if (format === 'image') return t('downloadImage')
  if (format === 'pdf') return t('downloadPdf')
  return t('downloadMd')
}

function busyLabel(t, format) {
  if (format === 'image') return t('generatingImage')
  if (format === 'pdf') return t('generatingPdf')
  return t('generatingMd')
}

/** First two lines of an item, collapsed for the list row. */
function firstLines(text) {
  if (typeof text !== 'string') return ''
  const lines = text.split('\n')
  const head = []
  for (const line of lines) {
    if (line.trim() === '') continue
    head.push(line.trim())
    if (head.length === 2) break
  }
  return head.join(' ').slice(0, 220)
}

// ── share view ──────────────────────────────────────────────────────────────

const FORMATS = [
  { id: 'md', labelKey: 'formatMd', glyph: 'markdown' },
  { id: 'image', labelKey: 'formatImage', glyph: 'image' },
  { id: 'pdf', labelKey: 'formatPdf', glyph: 'file' },
]

/**
 * The "分享" Conversation View body: a compact single-column transcript list
 * with per-message checkboxes, the format choice, and the export action.
 */
function ShareView(props) {
  const t = translatorOf(props)
  const sessionId = useSessionId(props)

  const [state, setState] = useState({ phase: 'loading' })
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [selection, setSelection] = useState(() => new Set())
  const [format, setFormat] = useState(() => {
    const prefs = readPrefs()
    // Prefs v2 stores an explicit format. Older builds defaulted to Markdown,
    // so their saved value is ignored and today's default (PDF) applies.
    if (prefs.version === 2 && (prefs.format === 'md' || prefs.format === 'image' || prefs.format === 'pdf')) return prefs.format
    return 'pdf'
  })
  const [includeTools, setIncludeTools] = useState(() => readPrefs().includeTools === true)
  const [includeTimes, setIncludeTimes] = useState(() => readPrefs().includeTimes === true)
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)

  // Read the transcript on mount, when the Session changes, and on refresh.
  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    setNotice(null)
    setBusy(null)
    const url = sessionId === null ? ROUTE_TRANSCRIPT : `${ROUTE_TRANSCRIPT}?sessionId=${encodeURIComponent(sessionId)}`
    fetch(url, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok || body === null || body.version !== 1 || !Array.isArray(body.items)) {
          const reason = body?.error?.message ?? `HTTP ${response.status}`
          throw new Error(reason)
        }
        return body
      })
      .then((body) => {
        if (cancelled) return
        const selectable = body.items.filter((item) => item.kind !== 'tool')
        setSelection(new Set(selectable.map((item) => item.id)))
        setState({ phase: 'ready', payload: body })
      })
      .catch((error) => {
        if (cancelled) return
        setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, refreshNonce])

  useEffect(() => {
    writePrefs({ version: 2, format })
  }, [format])

  useEffect(() => {
    writePrefs({ includeTools })
  }, [includeTools])

  useEffect(() => {
    writePrefs({ includeTimes })
  }, [includeTimes])

  const items = state.phase === 'ready' ? state.payload.items : []
  const visibleItems = useMemo(
    () => items.filter((item) => item.kind !== 'tool' || includeTools),
    [items, includeTools],
  )
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selection.has(item.id)),
    [visibleItems, selection],
  )
  const selectedChars = useMemo(
    () => selectedItems.reduce((total, item) => total + (typeof item.text === 'string' ? item.text.length : 0), 0),
    [selectedItems],
  )
  const view = useMemo(
    () => ({
      session: state.phase === 'ready' ? state.payload.session : null,
      items: selectedItems,
      // Message images resolved by the Host into data URLs; the export engine
      // draws these into PNG/PDF so the shared file keeps the input pictures.
      attachments: state.phase === 'ready' ? state.payload.attachments : undefined,
    }),
    [state, selectedItems],
  )

  const refresh = () => {
    if (busy !== null) return
    setRefreshNonce((value) => value + 1)
  }

  const toggleItem = (id) => {
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelection(new Set(visibleItems.map((item) => item.id)))
  const selectNone = () => setSelection(new Set())

  const toggleTools = () => {
    const next = !includeTools
    setIncludeTools(next)
    if (next) {
      // Turning tool calls on also selects them, so the list, the count and the
      // exported Markdown all change together instead of showing unselected rows.
      setSelection((selected) => {
        const merged = new Set(selected)
        for (const item of items) {
          if (item.kind === 'tool') merged.add(item.id)
        }
        return merged
      })
      return
    }
    // Hiding tool calls also drops them from the selection, so the footer never
    // claims to export rows the list no longer shows.
    setSelection((selected) => {
      const filtered = new Set()
      for (const id of selected) {
        const item = items.find((candidate) => candidate.id === id)
        if (item !== undefined && item.kind !== 'tool') filtered.add(id)
      }
      return filtered
    })
  }

  const exportOptions = () => ({
    title: state.phase === 'ready' ? state.payload.session?.title : undefined,
    includeToolCalls: includeTools,
    includeTimestamps: includeTimes,
    generatedAt: Date.now(),
  })

  const runExport = async () => {
    if (state.phase !== 'ready' || selectedItems.length === 0 || busy !== null) return
    const options = exportOptions()
    const session = state.payload.session
    setNotice(null)
    try {
      if (format === 'md') {
        setBusy('md')
        const text = exportCore.serializeMarkdown(view, options)
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
        exportCore.download(blob, exportFilename(session, 'md'))
        setNotice({ kind: 'ok', message: t('exported') })
      } else if (format === 'image') {
        setBusy('image')
        const result = await exportCore.renderImage(view, options)
        exportCore.download(result.blob, exportFilename(session, 'png'))
        setNotice({
          kind: 'ok',
          message: result.scaled === true ? t('exported') + ' ' + t('imageScaled') : t('exported'),
        })
      } else {
        setBusy('pdf')
        const result = await exportCore.renderPdf(view, options)
        exportCore.download(result.blob, exportFilename(session, 'pdf'))
        setNotice({
          kind: 'ok',
          message: t('exported') + ' ' + t('pdfPagesPrefix') + String(result.pages) + t('pdfPagesUnit'),
        })
      }
    } catch (error) {
      setNotice({ kind: 'error', message: t('exportFailed') + (error instanceof Error ? error.message : String(error)) })
    } finally {
      setBusy(null)
    }
  }

  const copyMarkdown = async () => {
    if (state.phase !== 'ready' || selectedItems.length === 0 || busy !== null) return
    try {
      await navigator.clipboard.writeText(exportCore.serializeMarkdown(view, exportOptions()))
      setNotice({ kind: 'ok', message: t('copied') })
    } catch (_error) {
      setNotice({ kind: 'error', message: t('copyFailed') })
    }
  }

  return h(
    'section',
    { className: 'ss-page', 'aria-label': t('panelTitle'), 'data-session-share': '' },
    h(
      'div',
      { className: 'ss-shell' },
      h(
        'header',
        { className: 'ss-head' },
        h(
          'div',
          { className: 'ss-head-text' },
          h(
            'h1',
            { className: 'ss-title' },
            h('span', { className: 'ss-title-glyph' }, h(Glyph, { name: 'share', size: 16 })),
            h('span', null, t('panelTitle')),
          ),
          h('p', { className: 'ss-subtitle' }, t('panelSubtitle')),
        ),
        h(
          'button',
          { type: 'button', className: 'ss-refresh', title: t('refreshTitle'), onClick: refresh, disabled: busy !== null },
          h(Glyph, { name: 'refresh', size: 13 }),
          h('span', null, t('refresh')),
        ),
      ),
      h(
        'div',
        { className: 'ss-body' },
        h(
          'section',
          { className: 'ss-list-pane', 'aria-label': t('formatLabel') },
          h(
            'div',
            { className: 'ss-toolbar' },
            h(
              'div',
              { className: 'ss-toolbar-left' },
              h('button', { type: 'button', className: 'ss-text-button', onClick: selectAll, disabled: visibleItems.length === 0 }, t('selectAll')),
              h('button', { type: 'button', className: 'ss-text-button', onClick: selectNone, disabled: selectedItems.length === 0 }, t('selectNone')),
              h(
                'span',
                { className: 'ss-count' },
                t('selectedPrefix') + String(selectedItems.length) + t('selectedUnit'),
                h('span', { className: 'ss-count-dim' }, t('charsPrefix') + String(selectedChars) + t('charsUnit')),
              ),
            ),
            h(
              'label',
              { className: 'ss-toggle' },
              h('input', { type: 'checkbox', checked: includeTools, onChange: toggleTools }),
              h('span', null, t('includeTools')),
            ),
            h(
              'label',
              { className: 'ss-toggle' },
              h('input', { type: 'checkbox', checked: includeTimes, onChange: () => setIncludeTimes((value) => !value) }),
              h('span', null, t('includeTimes')),
            ),
          ),
          state.phase === 'loading'
            ? h('div', { className: 'ss-placeholder' }, h('span', { className: 'ss-spinner', 'aria-hidden': 'true' }), h('span', null, t('loading')))
            : null,
          state.phase === 'error'
            ? h(
                'div',
                { className: 'ss-placeholder ss-placeholder-error' },
                h('p', { className: 'ss-error-text' }, t('loadFailed') + state.message),
                h('button', { type: 'button', className: 'ss-button', onClick: refresh }, t('retry')),
              )
            : null,
          state.phase === 'ready' && state.payload.truncated === true
            ? h('div', { className: 'ss-banner' }, t('truncatedBanner'))
            : null,
          state.phase === 'ready' && state.payload.partial === true
            ? h('div', { className: 'ss-banner' }, t('partialBanner'))
            : null,
          state.phase === 'ready' && visibleItems.length === 0
            ? h('div', { className: 'ss-placeholder' }, sessionId === null ? t('noSession') : t('empty'))
            : null,
          state.phase === 'ready' && visibleItems.length > 0
            ? h(
                'div',
                { className: 'ss-items', role: 'group', 'aria-label': t('panelTitle') },
                visibleItems.slice(0, DIALOG_MAX_ITEMS).map((item) =>
                  h(
                    'label',
                    {
                      key: item.id,
                      className:
                        'ss-item' +
                        (selection.has(item.id) ? ' is-selected' : '') +
                        (item.kind === 'tool' ? ' is-tool' : '') +
                        ' is-' + String(item.kind),
                    },
                    h('input', {
                      type: 'checkbox',
                      className: 'ss-item-check',
                      checked: selection.has(item.id),
                      onChange: () => toggleItem(item.id),
                    }),
                    h(
                      'span',
                      { className: 'ss-item-main' },
                      h(
                        'span',
                        { className: 'ss-item-meta' },
                        h('span', { className: 'ss-role ss-role-' + String(item.kind) }, t(roleKey(item.kind))),
                        includeTimes && typeof item.time === 'number'
                          ? h('span', { className: 'ss-item-time' }, shortTime(item.time))
                          : null,
                        item.kind === 'assistant' && typeof item.model === 'string' && item.model !== ''
                          ? h('span', { className: 'ss-item-model' }, item.model)
                          : null,
                        typeof item.images === 'number' && item.images > 0
                          ? h('span', { className: 'ss-item-images' }, '🖼 ' + String(item.images))
                          : null,
                      ),
                      h('span', { className: 'ss-item-text' }, firstLines(item.text)),
                    ),
                  ),
                ),
              )
            : null,
        ),
      ),
      h(
        'footer',
        { className: 'ss-foot' },
        h(
          'div',
          { className: 'ss-foot-left' },
          h(
            'div',
            { className: 'ss-formats', role: 'group', 'aria-label': t('formatLabel') },
            FORMATS.map((entry) =>
              h(
                'button',
                {
                  key: entry.id,
                  type: 'button',
                  className: 'ss-format' + (format === entry.id ? ' is-active' : ''),
                  'aria-pressed': format === entry.id,
                  onClick: () => setFormat(entry.id),
                  disabled: busy !== null,
                },
                h(Glyph, { name: entry.glyph, size: 14 }),
                h('span', null, t(entry.labelKey)),
              ),
            ),
          ),
          h('p', { className: 'ss-privacy' }, t('privacyNote')),
        ),
        h(
          'div',
          { className: 'ss-foot-actions' },
          notice === null
            ? null
            : h(
                'span',
                {
                  className: 'ss-notice' + (notice.kind === 'error' ? ' is-error' : ''),
                  role: 'status',
                  'aria-live': 'polite',
                },
                notice.message,
              ),
          format === 'md'
            ? h(
                'button',
                { type: 'button', className: 'ss-button', onClick: copyMarkdown, disabled: busy !== null || selectedItems.length === 0 },
                h(Glyph, { name: 'copy', size: 13 }),
                h('span', null, t('copy')),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'ss-button ss-button-primary',
              onClick: () => {
                void runExport()
              },
              disabled: state.phase !== 'ready' || selectedItems.length === 0 || busy !== null,
            },
            busy === null ? h(Glyph, { name: 'download', size: 13 }) : h('span', { className: 'ss-spinner ss-spinner-small', 'aria-hidden': 'true' }),
            h('span', null, busy === null ? primaryLabel(t, format) : busyLabel(t, format)),
          ),
        ),
      ),
    ),
  )
}

// ── styles ──────────────────────────────────────────────────────────────────

const STYLES = `
.ss-page{display:flex;flex-direction:column;width:100%;min-height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:20px}
.ss-shell{display:flex;flex-direction:column;width:100%;max-width:760px;margin:0 auto;padding:0 clamp(16px,3vw,36px)}
.ss-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.ss-head-text{min-width:0}
.ss-title{display:flex;align-items:center;gap:7px;margin:0;font-size:16px;font-weight:600;line-height:24px}
.ss-title-glyph{display:inline-flex;color:var(--dsw-alias-state-business-primary)}
.ss-subtitle{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.ss-refresh{display:inline-flex;align-items:center;gap:5px;flex:none;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.ss-refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4)}
.ss-refresh:disabled{opacity:.5;cursor:default}
.ss-body{display:flex;height:min(70vh,860px);min-height:360px;min-width:0}
.ss-list-pane{display:flex;flex:1;flex-direction:column;min-width:0}
.ss-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:10px 12px 10px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.ss-toolbar-left{display:flex;align-items:center;gap:10px;min-width:0}
.ss-text-button{padding:2px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;cursor:pointer}
.ss-text-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ss-text-button:disabled{color:var(--dsw-alias-label-caption);cursor:default}
.ss-count{display:inline-flex;align-items:baseline;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.ss-count-dim{color:var(--dsw-alias-label-caption)}
.ss-toggle{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;cursor:pointer}
.ss-toggle input{width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-state-business-primary)}
.ss-items{flex:1;min-height:0;overflow:auto;padding:8px 10px 12px 0;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.ss-item{display:flex;align-items:flex-start;gap:9px;padding:8px 9px;border-radius:10px;cursor:pointer;transition:background .12s}
.ss-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ss-item.is-selected{background:color-mix(in oklab,var(--dsw-alias-state-business-primary) 8%,transparent)}
.ss-item-check{flex:none;width:14px;height:14px;margin:2px 0 0;accent-color:var(--dsw-alias-state-business-primary)}
.ss-item-main{display:flex;flex-direction:column;gap:3px;min-width:0}
.ss-item-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.ss-role{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:9px;font-size:11px;line-height:16px;font-weight:500}
.ss-role-user{background:color-mix(in oklab,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.ss-role-assistant{background:color-mix(in oklab,var(--dsw-alias-state-success-primary) 15%,transparent);color:var(--dsw-alias-state-success-primary)}
.ss-role-tool,.ss-role-note{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary)}
.ss-item-time,.ss-item-model{color:var(--dsw-alias-label-caption);font-size:11px;white-space:nowrap}
.ss-item-images{color:var(--dsw-alias-label-tertiary);font-size:11px}
.ss-item-text{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ss-placeholder{display:flex;align-items:center;justify-content:center;gap:8px;flex:1;padding:36px 24px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;text-align:center}
.ss-placeholder-error{flex-direction:column;align-items:center;color:var(--dsw-alias-label-secondary)}
.ss-error-text{margin:0;max-width:520px;color:var(--dsw-alias-state-error-primary)}
.ss-banner{margin:8px 12px 0 0;padding:6px 10px;border-radius:8px;background:color-mix(in oklab,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary));font-size:12px}
.ss-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 0 16px;border-top:.5px solid var(--dsw-alias-border-l2)}
.ss-foot-left{display:flex;align-items:center;gap:14px;min-width:0}
.ss-formats{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}
.ss-format{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.ss-format:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.ss-format.is-active{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-stroke,0 0 0 .5px var(--dsw-alias-border-l2))}
.ss-format:disabled{opacity:.5;cursor:default}
.ss-privacy{margin:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.ss-foot-actions{display:flex;align-items:center;gap:10px;min-width:0}
.ss-notice{max-width:340px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;overflow-wrap:anywhere}
.ss-notice.is-error{color:var(--dsw-alias-state-error-primary)}
.ss-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:15px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.ss-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ss-button:disabled{opacity:.5;cursor:default}
.ss-button-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.ss-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.ss-spinner{width:14px;height:14px;border:2px solid color-mix(in oklab,currentColor 25%,transparent);border-top-color:currentColor;border-radius:50%;animation:ss-spin .8s linear infinite}
.ss-spinner-small{width:12px;height:12px;border-width:1.6px}
@keyframes ss-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ss-spinner{animation-duration:2.4s}}
.ss-page :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
@media (width<=860px){.ss-foot{flex-wrap:wrap}.ss-privacy{display:none}}
@media (width<=560px){.ss-head{padding-top:12px}.ss-refresh span{display:none}.ss-foot-actions{flex-wrap:wrap}}
`

// ── plugin ──────────────────────────────────────────────────────────────────

/** Services this browser plugin needs before it activates. */
const inject = ['slots', 'locale']

/**
 * Register the locale dictionaries, the plugin stylesheet, and the one
 * `conversation.view` tab: the shipped Conversation shell lists every occupant
 * of that slot as a tab beside Chat, Trajectory and Statistics and renders the
 * selected occupant inside its view area.
 *
 * @param ctx - the browser plugin context.
 */
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-share: dictionaries')
  fallbackT = ctx.locale.bind(NS)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPlugin = 'session-share'
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'session-share: styles')

  ctx.effect(
    () =>
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'share',
            order: 50,
            locale: NS,
            label: () => fallbackT('viewShare'),
          },
          ShareView,
        ),
      ),
    'session-share: view tab',
  )
}
