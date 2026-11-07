/**
 * Sticky Wall — the browser half of `@local/dsh-sticky-wall`.
 *
 * Two registrations, both made through slot declarations so they survive the
 * sidebar or layout re-declaring its slots:
 *  - `sidebar.panellist` — the left-sidebar row and its icon;
 *  - `main` (key `sticky-wall`) — the wall page itself.
 *
 * Notes live in this browser's local storage: switching panels, reloading the
 * page, or restarting the app keeps them. Nothing here talks to the Host, so
 * the Host half of the bundle is an empty row.
 *
 * Bundle format: the client module system executes only the factory below and
 * materializes it lazily. React comes from the platform module table, so this
 * file requires nothing else and declares no `dsh.client.external`.
 *
 * Styling: every color is a `--dsw-*` theme token or a `color-mix()` of a note
 * color with one. Dark mode is the palette behind `body[data-ds-dark-theme]`,
 * toggled by the theme service, so the paper tints, borders, and elevation get
 * their own values there instead of reusing the light surfaces.
 *
 * @module @local/dsh-sticky-wall/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-sticky-wall',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const NS = 'stickyWall'
    const PANEL_ID = 'sticky-wall'
    const NOTES_KEY = 'dsh.sticky-wall.notes.v1'
    const PREFS_KEY = 'dsh.sticky-wall.prefs.v1'
    const MAX_TEXT = 4000
    const TOAST_MS = 6000

    /** Paper hues, used only inside `color-mix()`; they are not UI colors. */
    const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange']
    const PAPER = {
      yellow: '#F2C14E',
      pink: '#EF9BAF',
      blue: '#7FB2F0',
      green: '#7FC49A',
      purple: '#B29AF0',
      orange: '#F0A469',
    }

    const STRINGS = {
      zh: {
        panel: '便签墙',
        title: '便签墙',
        subtitle: '灵感来的一瞬间，先记下来',
        countUnit: '条便签',
        autoSaved: '便签自动保存在本机',
        searchPlaceholder: '搜索便签',
        searchLabel: '搜索便签',
        clearSearch: '清空搜索',
        composerPlaceholder: '记下此刻的灵感…',
        composerHint: '⌘/Ctrl + Enter 保存',
        save: '保存便签',
        saved: '已保存，随时回来看看',
        emptyTitle: '还没有便签',
        emptyBody: '在上面写下第一条灵感。便签会自动保存在本机，离开这个页面也不会丢。',
        emptyFilteredTitle: '没有匹配的便签',
        emptyFilteredBody: '换一个关键词，或者清空搜索看看全部便签。',
        pin: '置顶',
        unpin: '取消置顶',
        copy: '复制',
        copied: '便签内容已复制',
        copyFailed: '浏览器不允许访问剪贴板',
        edit: '编辑便签',
        editHint: 'Ctrl + Enter 保存，Esc 取消',
        editByDoubleClick: '双击便签即可编辑',
        delete: '删除便签',
        deleted: '便签已删除',
        undo: '撤销',
        cancel: '取消',
        saveEdit: '保存修改',
        colorLabel: '便签颜色',
      },
      en: {
        panel: 'Sticky Wall',
        title: 'Sticky Wall',
        subtitle: 'Catch an idea the moment it arrives',
        countUnit: 'notes',
        autoSaved: 'Notes are saved on this device',
        searchPlaceholder: 'Search notes',
        searchLabel: 'Search notes',
        clearSearch: 'Clear search',
        composerPlaceholder: 'Write down the idea…',
        composerHint: '⌘/Ctrl + Enter to save',
        save: 'Save note',
        saved: 'Saved — come back any time',
        emptyTitle: 'No notes yet',
        emptyBody: 'Write the first idea above. Notes are saved on this device, so they stay when you leave this page.',
        emptyFilteredTitle: 'No matching notes',
        emptyFilteredBody: 'Try another keyword, or clear the search to see every note.',
        pin: 'Pin',
        unpin: 'Unpin',
        copy: 'Copy',
        copied: 'Note copied to the clipboard',
        copyFailed: 'The browser blocked clipboard access',
        edit: 'Edit note',
        editHint: 'Ctrl + Enter to save, Esc to cancel',
        editByDoubleClick: 'Double-click a note to edit it',
        delete: 'Delete note',
        deleted: 'Note deleted',
        undo: 'Undo',
        cancel: 'Cancel',
        saveEdit: 'Save changes',
        colorLabel: 'Note color',
      },
    }

    // ── storage ────────────────────────────────────────────────────────────

    /** Read one JSON value; unreadable or absent storage reads as `null`. */
    function readStore(key) {
      try {
        const raw = window.localStorage.getItem(key)
        return raw === null ? null : JSON.parse(raw)
      } catch (_error) {
        return null
      }
    }

    /** Write one JSON value; a blocked or full storage keeps the wall usable. */
    function writeStore(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch (_error) {
        /* keep the in-memory wall usable without persistence */
      }
    }

    function newId() {
      return 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    /** Coerce one stored entry into the current shape, dropping entries without text. */
    function normalizeNote(value) {
      if (value === null || typeof value !== 'object') return null
      const text = typeof value.text === 'string' ? value.text.trim() : ''
      if (text === '') return null
      const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now()
      return {
        id: typeof value.id === 'string' && value.id !== '' ? value.id : newId(),
        text: text.slice(0, MAX_TEXT),
        color: COLORS.includes(value.color) ? value.color : 'yellow',
        pinned: value.pinned === true,
        createdAt,
        updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt,
      }
    }

    /** Read the whole wall: notes plus the composer's last paper color. */
    function loadState() {
      const stored = readStore(NOTES_KEY)
      const notes = Array.isArray(stored) ? stored.map(normalizeNote).filter((note) => note !== null) : []
      const prefs = readStore(PREFS_KEY)
      return { notes, color: prefs !== null && COLORS.includes(prefs.color) ? prefs.color : 'yellow' }
    }

    // ── time ───────────────────────────────────────────────────────────────

    const TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    function shortTime(ms) {
      try {
        return TIME.format(new Date(ms))
      } catch (_error) {
        return ''
      }
    }

    function fullTime(ms) {
      try {
        return new Date(ms).toLocaleString()
      } catch (_error) {
        return ''
      }
    }

    // ── glyphs ─────────────────────────────────────────────────────────────

    /** Outline glyphs on a 16px grid; strokes take `currentColor`. */
    const GLYPHS = {
      pin: ['M8 1.9c1.9 0 3.5 1.5 3.5 3.4 0 1.3-.7 2.4-1.7 3l.7 3H5.5l.7-3a3.5 3.5 0 0 1-1.7-3C4.5 3.4 6.1 1.9 8 1.9Z', 'M8 11.3v2.6'],
      trash: ['M2.9 4.4h10.2', 'M6.1 4.4V3c0-.5.4-.9.9-.9h2c.5 0 .9.4.9.9v1.4', 'M4.5 4.4 5.1 13c0 .5.4.9.9.9h4c.5 0 .9-.4.9-.9l.6-8.6', 'M6.7 7v4', 'M9.3 7v4'],
      copy: ['M5.6 2.5h7c.6 0 1 .5 1 1v7c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.5.4-1 1-1Z', 'M10.6 11.5v1c0 .8-.7 1.5-1.5 1.5H3.5C2.7 14 2 13.3 2 12.5V7c0-.8.7-1.5 1.5-1.5h1.1'],
      pencil: ['M11 2.6 13.4 5 5.6 12.8l-3.2.8.8-3.2L11 2.6Z', 'M9.6 4l2.4 2.4'],
      search: ['M7 2.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4Z', 'M10.1 10.1 13.6 13.6'],
      plus: ['M8 3v10', 'M3 8h10'],
      check: ['M3 8.4l3.1 3.1L13 4.9'],
      close: ['M4 4l8 8', 'M12 4l-8 8'],
    }

    function Glyph({ name, size = 16 }) {
      const paths = GLYPHS[name]
      if (paths === undefined) return null
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false', style: { display: 'block', flex: 'none' } },
        paths.map((d, index) => h('path', { key: index, d, stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      )
    }

    /** The sticky-note glyph the sidebar renders at 16px (18px when collapsed). */
    function StickyWallIcon({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M3.1 1.7h6.6l3.2 3.2v8.3c0 .7-.6 1.2-1.3 1.2H3.1c-.7 0-1.3-.5-1.3-1.2V2.9c0-.7.6-1.2 1.3-1.2Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        h('path', { d: 'M9.5 1.8v3.3h3.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        h('path', { d: 'M4.6 7.2h4.8M4.6 9.6h5.8M4.6 12h3.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    // ── pieces ─────────────────────────────────────────────────────────────

    /** Paper-color picker shared by the composer and an editing note. */
    function ColorSwatches({ t, value, onChange, small = false }) {
      return h(
        'div',
        { className: 'sw-swatches', role: 'group', 'aria-label': t('colorLabel') },
        COLORS.map((color) =>
          h('button', {
            key: color,
            type: 'button',
            className: 'sw-swatch' + (color === value ? ' is-selected' : '') + (small ? ' is-small' : ''),
            style: { '--swatch': PAPER[color] },
            'aria-label': color,
            'aria-pressed': color === value,
            onClick: () => onChange(color),
          }),
        ),
      )
    }

    /** The always-visible quick-capture card above the wall. */
    function Composer({ t, draft, color, onDraft, onColor, onSave, inputRef }) {
      return h(
        'div',
        { className: 'sw-composer' },
        h('textarea', {
          ref: inputRef,
          className: 'sw-composer-input',
          value: draft,
          rows: 2,
          autoFocus: true,
          maxLength: MAX_TEXT,
          placeholder: t('composerPlaceholder'),
          'aria-label': t('composerPlaceholder'),
          onChange: (event) => onDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              onSave()
            }
          },
        }),
        h(
          'div',
          { className: 'sw-composer-bar' },
          h(ColorSwatches, { t, value: color, onChange: onColor }),
          h(
            'div',
            { className: 'sw-composer-actions' },
            h('span', { className: 'sw-hint' }, t('composerHint')),
            h(
              'button',
              { type: 'button', className: 'sw-button sw-button-primary', disabled: draft.trim() === '', onClick: onSave },
              h(Glyph, { name: 'plus', size: 14 }),
              h('span', null, t('save')),
            ),
          ),
        ),
      )
    }

    /** One sticky note: its reading state, or its editing state. */
    function NoteCard({ note, t, edit, onPin, onCopy, onStartEdit, onDelete, onEdit }) {
      const editing = edit !== null
      const action = (key, glyph, label, onClick, extraClass = '') =>
        h(
          'button',
          { key, type: 'button', className: 'sw-icon-button' + extraClass, 'aria-label': label, title: label, onClick },
          h(Glyph, { name: glyph, size: 14 }),
        )

      return h(
        'article',
        {
          className: 'sw-note' + (note.pinned ? ' sw-note-pinned' : ''),
          style: { '--sw-color': PAPER[note.color] },
          role: 'listitem',
          'aria-label': note.text.slice(0, 80),
        },
        h(
          'div',
          { className: 'sw-note-head' },
          h('time', { className: 'sw-note-time', dateTime: new Date(note.updatedAt).toISOString(), title: fullTime(note.updatedAt) }, shortTime(note.updatedAt)),
          h(
            'div',
            { className: 'sw-note-actions' },
            h(
              'button',
              {
                key: 'pin',
                type: 'button',
                className: 'sw-icon-button' + (note.pinned ? ' is-active' : ''),
                'aria-pressed': note.pinned,
                'aria-label': note.pinned ? t('unpin') : t('pin'),
                title: note.pinned ? t('unpin') : t('pin'),
                onClick: () => onPin(note),
              },
              h(Glyph, { name: 'pin', size: 14 }),
            ),
            action('copy', 'copy', t('copy'), () => onCopy(note)),
            action('edit', 'pencil', t('editByDoubleClick'), () => onStartEdit(note)),
            action('delete', 'trash', t('delete'), () => onDelete(note), ' sw-danger'),
          ),
        ),
        editing
          ? h(
              'div',
              { className: 'sw-note-edit' },
              h('textarea', {
                className: 'sw-note-textarea',
                value: edit.text,
                maxLength: MAX_TEXT,
                autoFocus: true,
                'aria-label': t('edit'),
                onChange: (event) => onEdit.text(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    onEdit.save()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    onEdit.cancel()
                  }
                },
              }),
              h(
                'div',
                { className: 'sw-edit-bar' },
                h(ColorSwatches, { t, value: edit.color, onChange: onEdit.color, small: true }),
                h('span', { className: 'sw-hint' }, t('editHint')),
                h(
                  'div',
                  { className: 'sw-edit-actions' },
                  h('button', { type: 'button', className: 'sw-button', onClick: onEdit.cancel }, t('cancel')),
                  h('button', { type: 'button', className: 'sw-button sw-button-primary', onClick: onEdit.save }, t('saveEdit')),
                ),
              ),
            )
          : h('div', { className: 'sw-note-body', onDoubleClick: () => onStartEdit(note) }, h('p', { className: 'sw-note-text' }, note.text)),
      )
    }

    /** First-use and no-search-result states. */
    function emptyState(t, filtered) {
      return h(
        'div',
        { className: 'sw-empty' },
        h('span', { className: 'sw-empty-glyph' }, h(StickyWallIcon, { size: 34 })),
        h('p', { className: 'sw-empty-title' }, filtered ? t('emptyFilteredTitle') : t('emptyTitle')),
        h('p', { className: 'sw-empty-body' }, filtered ? t('emptyFilteredBody') : t('emptyBody')),
      )
    }

    /** Pinned first, then most recently touched. */
    function visibleNotes(notes, query) {
      const needle = query.trim().toLowerCase()
      const rows = needle === '' ? notes.slice() : notes.filter((note) => note.text.toLowerCase().includes(needle))
      return rows.sort((left, right) => (left.pinned === right.pinned ? right.updatedAt - left.updatedAt : left.pinned ? -1 : 1))
    }

    // ── page ───────────────────────────────────────────────────────────────

    /** The wall panel: quick capture, search, and the grid of notes. */
    function StickyWallPage({ t }) {
      const [notes, setNotes] = useState(() => loadState().notes)
      const [color, setColor] = useState(() => loadState().color)
      const [query, setQuery] = useState('')
      const [draft, setDraft] = useState('')
      const [editing, setEditing] = useState(null)
      const [toast, setToast] = useState(null)
      const composerRef = useRef(null)
      const toastTimer = useRef(0)

      useEffect(() => {
        writeStore(NOTES_KEY, notes)
      }, [notes])

      useEffect(() => {
        writeStore(PREFS_KEY, { color })
      }, [color])

      // Another window of the same page may have changed the notes.
      useEffect(() => {
        const sync = (event) => {
          if (event.key === NOTES_KEY) setNotes(loadState().notes)
        }
        window.addEventListener('storage', sync)
        return () => window.removeEventListener('storage', sync)
      }, [])

      useEffect(() => () => window.clearTimeout(toastTimer.current), [])

      function showToast(message, action = null) {
        window.clearTimeout(toastTimer.current)
        setToast({ message, action })
        toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
      }

      function dismissToast() {
        window.clearTimeout(toastTimer.current)
        setToast(null)
      }

      function addNote() {
        const text = draft.trim()
        if (text === '') {
          composerRef.current?.focus()
          return
        }
        const now = Date.now()
        setNotes((prev) => [{ id: newId(), text: text.slice(0, MAX_TEXT), color, pinned: false, createdAt: now, updatedAt: now }, ...prev])
        setDraft('')
        showToast(t('saved'))
        composerRef.current?.focus()
      }

      function togglePin(note) {
        setNotes((prev) => prev.map((item) => (item.id === note.id ? { ...item, pinned: !item.pinned, updatedAt: Date.now() } : item)))
      }

      function removeNote(note) {
        setNotes((prev) => prev.filter((item) => item.id !== note.id))
        setEditing((current) => (current !== null && current.id === note.id ? null : current))
        showToast(t('deleted'), {
          label: t('undo'),
          run: () => setNotes((prev) => (prev.some((item) => item.id === note.id) ? prev : [note, ...prev])),
        })
      }

      async function copyNote(note) {
        try {
          await navigator.clipboard.writeText(note.text)
          showToast(t('copied'))
        } catch (_error) {
          showToast(t('copyFailed'))
        }
      }

      function startEdit(note) {
        setEditing({ id: note.id, text: note.text, color: note.color })
      }

      function saveEdit() {
        const current = editing
        if (current === null) return
        const text = current.text.trim()
        setEditing(null)
        if (text === '') return
        setNotes((prev) => prev.map((item) => (item.id === current.id ? { ...item, text: text.slice(0, MAX_TEXT), color: current.color, updatedAt: Date.now() } : item)))
        showToast(t('saved'))
      }

      const editActions = {
        text: (value) => setEditing((current) => (current === null ? current : { ...current, text: value })),
        color: (next) => setEditing((current) => (current === null ? current : { ...current, color: next })),
        save: saveEdit,
        cancel: () => setEditing(null),
      }

      const visible = visibleNotes(notes, query)

      return h(
        'section',
        { className: 'sw-page' },
        h(
          'div',
          { className: 'sw-scroll' },
          h(
            'div',
            { className: 'sw-content' },
            h(
              'header',
              { className: 'sw-head' },
              h('div', null, h('h1', { className: 'sw-title' }, t('title')), h('p', { className: 'sw-subtitle' }, t('subtitle'))),
              h(
                'div',
                { className: 'sw-head-tools' },
                h('span', { className: 'sw-count', title: t('autoSaved') }, h(Glyph, { name: 'check', size: 12 }), h('span', null, notes.length + ' ' + t('countUnit'))),
                h(
                  'label',
                  { className: 'sw-search' },
                  h(Glyph, { name: 'search', size: 14 }),
                  h('input', {
                    type: 'search',
                    value: query,
                    placeholder: t('searchPlaceholder'),
                    'aria-label': t('searchLabel'),
                    onChange: (event) => setQuery(event.target.value),
                  }),
                  query === ''
                    ? null
                    : h('button', { type: 'button', className: 'sw-search-clear', 'aria-label': t('clearSearch'), onClick: () => setQuery('') }, h(Glyph, { name: 'close', size: 12 })),
                ),
              ),
            ),
            h(Composer, { t, draft, color, inputRef: composerRef, onDraft: setDraft, onColor: setColor, onSave: addNote }),
            visible.length === 0
              ? emptyState(t, query.trim() !== '')
              : h(
                  'div',
                  { className: 'sw-wall', role: 'list' },
                  visible.map((note) =>
                    h(NoteCard, {
                      key: note.id,
                      note,
                      t,
                      edit: editing !== null && editing.id === note.id ? editing : null,
                      onPin: togglePin,
                      onCopy: copyNote,
                      onStartEdit: startEdit,
                      onDelete: removeNote,
                      onEdit: editActions,
                    }),
                  ),
                ),
          ),
        ),
        toast === null
          ? null
          : h(
              'div',
              { className: 'sw-toast', role: 'status', 'aria-live': 'polite' },
              h(Glyph, { name: 'check', size: 14 }),
              h('span', null, toast.message),
              toast.action === null
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'sw-toast-action',
                      onClick: () => {
                        toast.action.run()
                        dismissToast()
                      },
                    },
                    toast.action.label,
                  ),
            ),
      )
    }

    // ── styles ─────────────────────────────────────────────────────────────

    /**
     * Plugin-owned global stylesheet. Light and dark share one set of layout
     * rules; only surfaces, borders, and paper tints change in the dark block.
     */
    const STYLES = `
.sw-page{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:1.6}
.sw-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.sw-content{max-width:1120px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 72px}
.sw-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:18px}
[data-platform=darwin] .sw-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.sw-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.sw-subtitle{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.sw-head-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.sw-count{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border-radius:14px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap}
.sw-search{display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;color:var(--dsw-alias-label-tertiary);transition:border-color .15s}
.sw-search:hover{border-color:var(--dsw-alias-border-l4)}
.sw-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.sw-search input{width:190px;min-width:0;padding:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.sw-search input::placeholder{color:var(--dsw-alias-label-caption)}
.sw-search input::-webkit-search-cancel-button{display:none}
.sw-search-clear{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.sw-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sw-composer{margin-bottom:22px;padding:12px 14px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-module-platform);transition:border-color .15s,box-shadow .15s}
.sw-composer:focus-within{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--dsw-alias-state-business-primary) 14%,transparent)}
.sw-composer-input{display:block;width:100%;min-height:52px;max-height:220px;padding:2px 2px 8px;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:24px;resize:none;field-sizing:content;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.sw-composer-input::placeholder{color:var(--dsw-alias-label-caption)}
.sw-composer-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.sw-swatches{display:flex;align-items:center;gap:7px}
.sw-swatch{width:18px;height:18px;padding:0;border:1.5px solid transparent;border-radius:50%;background:var(--swatch);cursor:pointer;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l4);transition:transform .12s}
.sw-swatch.is-small{width:15px;height:15px}
.sw-swatch:hover{transform:scale(1.12)}
.sw-swatch.is-selected{border-color:var(--dsw-alias-label-primary);transform:scale(1.12)}
.sw-composer-actions{display:flex;align-items:center;gap:10px}
.sw-hint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px}
.sw-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:15px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.sw-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sw-button:disabled{opacity:.5;cursor:default}
.sw-button-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.sw-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.sw-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:14px;align-items:start}
.sw-note{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px 12px 12px;border:.5px solid var(--dsw-alias-border-l3);border-top:3px solid var(--sw-color);border-radius:12px;background:color-mix(in oklab,var(--sw-color) 12%,var(--dsw-alias-bg-layer-1));transition:transform .15s,box-shadow .15s,background .15s}
.sw-note:hover{transform:translateY(-1px);background:color-mix(in oklab,var(--sw-color) 17%,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-elevation-stroke),var(--dsw-shadow-lv2)}
.sw-note-pinned{background:color-mix(in oklab,var(--sw-color) 16%,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-elevation-stroke),var(--dsw-shadow-lv2)}
.sw-note-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:22px}
.sw-note-time{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.sw-note-actions{display:flex;align-items:center;gap:1px;opacity:0;transition:opacity .12s}
.sw-note:hover .sw-note-actions,.sw-note:focus-within .sw-note-actions{opacity:1}
.sw-icon-button{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background .12s,color .12s}
.sw-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sw-icon-button.is-active{color:var(--dsw-alias-state-business-primary)}
.sw-icon-button.sw-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.sw-note-body{flex:1;min-width:0;cursor:text}
.sw-note-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:22px}
.sw-note-edit{display:flex;flex-direction:column;gap:8px}
.sw-note-textarea{width:100%;min-height:84px;max-height:320px;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;resize:vertical;field-sizing:content}
.sw-note-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.sw-edit-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.sw-edit-actions{display:flex;align-items:center;gap:6px}
.sw-edit-actions .sw-button{height:26px;padding:0 10px;font-size:12px}
.sw-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:64px 24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.sw-empty-glyph{color:var(--dsw-alias-label-caption)}
.sw-empty-title{margin:12px 0 0;color:var(--dsw-alias-label-secondary);font-size:15px;font-weight:500;line-height:22px}
.sw-empty-body{max-width:400px;margin:0;font-size:13px;line-height:21px}
.sw-toast{position:absolute;bottom:22px;left:50%;z-index:2;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100% - 48px));padding:8px 10px 8px 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:22px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-stroke),var(--dsw-shadow-lv2);font-size:13px;line-height:20px;transform:translateX(-50%)}
.sw-toast span{min-width:0;overflow-wrap:anywhere}
.sw-toast-action{flex:none;height:26px;padding:0 10px;border:0;border-radius:13px;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.sw-toast-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sw-page :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sw-composer-input:focus-visible,.sw-note-textarea:focus-visible,.sw-search input:focus-visible{outline:none}
@media (hover:none){.sw-note-actions{opacity:1}}
@media (width<=760px){.sw-search input{width:120px}.sw-wall{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.sw-content{padding-bottom:48px}}
@media (prefers-reduced-motion:reduce){.sw-note,.sw-swatch,.sw-button,.sw-icon-button{transition:none}.sw-note:hover{transform:none}}
/* Dark palette: the same layout, mixed against the raised dark layers. The
   light layers are all white, so paper tints there need a white base; here
   they need the dark surface, or every note turns into a pale sticker. */
body[data-ds-dark-theme] .sw-note{background:color-mix(in oklab,var(--sw-color) 9%,var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-border-l2)}
body[data-ds-dark-theme] .sw-note:hover{background:color-mix(in oklab,var(--sw-color) 13%,var(--dsw-alias-bg-layer-2))}
body[data-ds-dark-theme] .sw-note-pinned{background:color-mix(in oklab,var(--sw-color) 13%,var(--dsw-alias-bg-layer-2))}
body[data-ds-dark-theme] .sw-composer{background:var(--dsw-alias-bg-layer-2)}
`

    // ── plugin ─────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale']

    /**
     * Contribute the sidebar entry, its panel page, and the shared stylesheet.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, STRINGS), 'sticky-wall: dictionaries')

      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'sticky-wall'
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => style.remove()
      }, 'sticky-wall: styles')

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, StickyWallIcon),
      )

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, StickyWallPage))
    }

    return { inject, apply }
  },
})
