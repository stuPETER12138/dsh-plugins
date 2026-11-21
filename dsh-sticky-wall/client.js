/**
 * Sticky Wall — the browser half of `@local/dsh-sticky-wall`.
 *
 * Registrations, all made through slot declarations so they survive the
 * sidebar or layout re-declaring its slots:
 *  - `sidebar.panellist` — the left-sidebar row and its icon;
 *  - `main` (key `sticky-wall`) — the notes wall / bookmark index page;
 *  - `conversation.chat.text-interaction` — the floating selection action.
 *
 * Notes and bookmarks live in this browser's local storage: switching panels,
 * reloading the page, or restarting the app keeps them. Bookmarks additionally
 * remember the Session they came from; archiving that Session removes them.
 * Nothing here talks to the Host, so the Host half of the bundle is an empty
 * row.
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
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'stickyWall'
    const PANEL_ID = 'sticky-wall'
    const NOTES_KEY = 'dsh.sticky-wall.notes.v1'
    const BOOKMARKS_KEY = 'dsh.sticky-wall.bookmarks.v1'
    const PREFS_KEY = 'dsh.sticky-wall.prefs.v1'
    const BOOKMARK_INTERACTION_ID = 'sticky-wall-bookmark'
    /** The shipped quote surface this plugin replaces with a quote + bookmark bar. */
    const QUOTE_INTERACTION_ID = 'quote'
    const MAX_TEXT = 4000
    const MAX_BOOKMARKS = 300
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
        countUnit: '条便签',
        countUnitOne: '条便签',
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
        tabNotes: '便签',
        tabBookmarks: '书签',
        bookmarkCountUnit: '条书签',
        bookmarkCountUnitOne: '条书签',
        bookmarkHint: '在会话中选中文字，点浮出的「收藏」加入书签；点书签跳回原文字，会话归档后自动消失。',
        bookmarkSearchPlaceholder: '搜索书签',
        bookmarkSearchLabel: '搜索书签',
        bookmarkEmptyTitle: '还没有书签',
        bookmarkEmptyBody: '在会话中选中文字，点浮出的「收藏」即可加入。点书签正文可跳回原位置；会话归档后自动消失。',
        bookmarkEmptyFilteredTitle: '没有匹配的书签',
        bookmarkEmptyFilteredBody: '换一个关键词，或者清空搜索看看全部书签。',
        bookmarkAdd: '收藏',
        bookmarkAddLabel: '收藏所选文字',
        selectionLabel: '选中文字操作',
        bookmarkAdded: '已收藏',
        bookmarkExists: '已在书签中',
        bookmarkArchived: '会话已归档',
        bookmarkFailed: '收藏失败',
        quoteText: '引用文本',
        bookmarkSessionUnknown: '未知会话',
        bookmarkOpen: '打开会话',
        bookmarkOpenFailed: '无法打开这个会话',
        bookmarkJump: '跳到这段文字',
        bookmarkJumpFailed: '无法跳转到这个书签的位置',
        bookmarkTurn: '第 {n} 轮',
        bookmarkDeleted: '书签已删除',
        bookmarkRestoreFailed: '会话已归档，书签无法恢复',
        bookmarkArchivedRemovedOne: '会话已归档，1 条书签已移除',
        bookmarkArchivedRemoved: '会话已归档，{n} 条书签已移除',
        bookmarkCopied: '书签文字已复制',
        bookmarkCopyFailed: '浏览器不允许访问剪贴板',
        bookmarkExpand: '展开',
        bookmarkCollapse: '收起',
      },
      en: {
        panel: 'Sticky Wall',
        title: 'Sticky Wall',
        countUnit: 'notes',
        countUnitOne: 'note',
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
        tabNotes: 'Notes',
        tabBookmarks: 'Bookmarks',
        bookmarkCountUnit: 'bookmarks',
        bookmarkCountUnitOne: 'bookmark',
        bookmarkHint: 'Select text and choose Bookmark; open a bookmark to jump back to those exact words. Archiving the session removes its bookmarks.',
        bookmarkSearchPlaceholder: 'Search bookmarks',
        bookmarkSearchLabel: 'Search bookmarks',
        bookmarkEmptyTitle: 'No bookmarks yet',
        bookmarkEmptyBody: 'Select text in a conversation and choose Bookmark. Open a bookmark to jump back to that spot; it disappears when its session is archived.',
        bookmarkEmptyFilteredTitle: 'No matching bookmarks',
        bookmarkEmptyFilteredBody: 'Try another keyword, or clear the search to see every bookmark.',
        bookmarkAdd: 'Bookmark',
        bookmarkAddLabel: 'Bookmark selected text',
        selectionLabel: 'Selected text actions',
        bookmarkAdded: 'Bookmarked',
        bookmarkExists: 'Already bookmarked',
        bookmarkArchived: 'Session archived',
        bookmarkFailed: 'Could not bookmark',
        quoteText: 'Quote text',
        bookmarkSessionUnknown: 'Unknown session',
        bookmarkOpen: 'Open session',
        bookmarkOpenFailed: 'Could not open this session',
        bookmarkJump: 'Jump to this text',
        bookmarkJumpFailed: 'Could not jump to this bookmark position',
        bookmarkTurn: 'Turn {n}',
        bookmarkDeleted: 'Bookmark deleted',
        bookmarkRestoreFailed: 'The session is archived; this bookmark cannot be restored',
        bookmarkArchivedRemovedOne: 'Session archived; 1 bookmark removed',
        bookmarkArchivedRemoved: 'Session archived; {n} bookmarks removed',
        bookmarkCopied: 'Bookmark copied to the clipboard',
        bookmarkCopyFailed: 'The browser blocked clipboard access',
        bookmarkExpand: 'Show more',
        bookmarkCollapse: 'Show less',
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

    /** Read the whole wall: notes, the composer's last paper color, and the open tab. */
    function loadState() {
      const stored = readStore(NOTES_KEY)
      const notes = Array.isArray(stored) ? stored.map(normalizeNote).filter((note) => note !== null) : []
      const prefs = readStore(PREFS_KEY)
      return {
        notes,
        color: prefs !== null && COLORS.includes(prefs.color) ? prefs.color : 'yellow',
        tab: prefs !== null && prefs.tab === 'bookmarks' ? 'bookmarks' : 'notes',
      }
    }

    function newBookmarkId() {
      return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    /** Coerce one stored bookmark, dropping entries without text or a Session. */
    /** A bounded child-index path accepted from persisted bookmark data. */
    function validPath(value) {
      return Array.isArray(value) && value.length <= 64
        && value.every((index) => Number.isInteger(index) && index >= 0)
    }

    /** Stable non-cryptographic fingerprint for one rendered message source. */
    function textHash(text) {
      let hash = 2166136261
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      return (hash >>> 0).toString(36)
    }

    function normalizeBookmark(value) {
      if (value === null || typeof value !== 'object') return null
      const text = typeof value.text === 'string' ? value.text.trim() : ''
      const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
      if (text === '' || sessionId === '') return null
      const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now()
      const turn = Number.isInteger(value.turn) && value.turn > 0 ? value.turn : undefined
      const seq = Number.isInteger(value.seq) && value.seq >= 0 ? value.seq : undefined
      const offset = Number.isInteger(value.offset) && value.offset >= 0 ? value.offset : undefined
      const sourceIndex = Number.isInteger(value.sourceIndex) && value.sourceIndex >= 0 ? value.sourceIndex : undefined
      const startOffset = Number.isInteger(value.startOffset) && value.startOffset >= 0 ? value.startOffset : undefined
      const endOffset = Number.isInteger(value.endOffset) && value.endOffset >= 0 ? value.endOffset : undefined
      const startPath = validPath(value.startPath) ? value.startPath.slice() : undefined
      const endPath = validPath(value.endPath) ? value.endPath.slice() : undefined
      const sourceHash = typeof value.sourceHash === 'string' && value.sourceHash !== '' ? value.sourceHash : undefined
      const sourceLength = Number.isInteger(value.sourceLength) && value.sourceLength >= 0 ? value.sourceLength : undefined
      return {
        id: typeof value.id === 'string' && value.id !== '' ? value.id : newBookmarkId(),
        text: text.slice(0, MAX_TEXT),
        sessionId,
        sessionTitle: typeof value.sessionTitle === 'string' && value.sessionTitle !== '' ? value.sessionTitle : undefined,
        createdAt,
        ...(turn === undefined ? {} : { turn }),
        ...(seq === undefined ? {} : { seq }),
        ...(offset === undefined ? {} : { offset }),
        ...(sourceIndex === undefined ? {} : { sourceIndex }),
        ...(startPath === undefined ? {} : { startPath }),
        ...(startOffset === undefined ? {} : { startOffset }),
        ...(endPath === undefined ? {} : { endPath }),
        ...(endOffset === undefined ? {} : { endOffset }),
        ...(sourceHash === undefined ? {} : { sourceHash }),
        ...(sourceLength === undefined ? {} : { sourceLength }),
        ...(typeof value.nodeKey === 'string' && value.nodeKey !== '' ? { nodeKey: value.nodeKey } : {}),
        ...(typeof value.flowKey === 'string' && value.flowKey !== '' ? { flowKey: value.flowKey } : {}),
        ...(typeof value.prefix === 'string' && value.prefix !== '' ? { prefix: value.prefix } : {}),
        ...(typeof value.suffix === 'string' && value.suffix !== '' ? { suffix: value.suffix } : {}),
      }
    }

    /** Read every stored bookmark, newest first. */
    function loadBookmarks() {
      const stored = readStore(BOOKMARKS_KEY)
      const items = Array.isArray(stored) ? stored.map(normalizeBookmark).filter((item) => item !== null) : []
      return items.sort((left, right) => right.createdAt - left.createdAt)
    }

    /**
     * Browser-local bookmark index. The page and the selection surface are two
     * owners of one array, so the store owns persistence and publication.
     */
    function createBookmarkStore() {
      let items = loadBookmarks()
      const listeners = new Set()

      function publish(next) {
        items = next
        writeStore(BOOKMARKS_KEY, items)
        for (const listener of listeners) listener()
      }

      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot() {
          return items
        },
        reload() {
          items = loadBookmarks()
          for (const listener of listeners) listener()
        },
        /** @returns `added`, `duplicate`, or `empty`. */
        add(text, sessionId, sessionTitle, location = {}) {
          const normalized = text.trim()
          if (normalized === '') return 'empty'
          if (items.some((item) => item.sessionId === sessionId && item.text === normalized)) return 'duplicate'
          const bookmark = {
            id: newBookmarkId(),
            text: normalized.slice(0, MAX_TEXT),
            sessionId,
            sessionTitle,
            createdAt: Date.now(),
            ...(Number.isInteger(location.turn) && location.turn > 0 ? { turn: location.turn } : {}),
            ...(Number.isInteger(location.seq) && location.seq >= 0 ? { seq: location.seq } : {}),
            ...(Number.isInteger(location.offset) && location.offset >= 0 ? { offset: location.offset } : {}),
            ...(Number.isInteger(location.sourceIndex) && location.sourceIndex >= 0 ? { sourceIndex: location.sourceIndex } : {}),
            ...(validPath(location.startPath) ? { startPath: location.startPath.slice() } : {}),
            ...(Number.isInteger(location.startOffset) && location.startOffset >= 0 ? { startOffset: location.startOffset } : {}),
            ...(validPath(location.endPath) ? { endPath: location.endPath.slice() } : {}),
            ...(Number.isInteger(location.endOffset) && location.endOffset >= 0 ? { endOffset: location.endOffset } : {}),
            ...(typeof location.sourceHash === 'string' && location.sourceHash !== '' ? { sourceHash: location.sourceHash } : {}),
            ...(Number.isInteger(location.sourceLength) && location.sourceLength >= 0 ? { sourceLength: location.sourceLength } : {}),
            ...(typeof location.nodeKey === 'string' && location.nodeKey !== '' ? { nodeKey: location.nodeKey } : {}),
            ...(typeof location.flowKey === 'string' && location.flowKey !== '' ? { flowKey: location.flowKey } : {}),
            ...(typeof location.prefix === 'string' && location.prefix !== '' ? { prefix: location.prefix } : {}),
            ...(typeof location.suffix === 'string' && location.suffix !== '' ? { suffix: location.suffix } : {}),
          }
          publish([bookmark, ...items].slice(0, MAX_BOOKMARKS))
          return 'added'
        },
        remove(id) {
          const next = items.filter((item) => item.id !== id)
          if (next.length !== items.length) publish(next)
        },
        restore(bookmark) {
          if (items.some((item) => item.id === bookmark.id)) return true
          publish([bookmark, ...items].slice(0, MAX_BOOKMARKS))
          return true
        },
        /** Drop every bookmark whose id is listed; used when its Session is archived. */
        purge(ids) {
          const doomed = new Set(ids)
          const next = items.filter((item) => !doomed.has(item.id))
          if (next.length !== items.length) publish(next)
        },
      }
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
      check: ['M3 8.4l3.1 3.1L13 4.9'],
      close: ['M4 4l8 8', 'M12 4l-8 8'],
      bookmark: ['M4.1 2.4h7.8c.6 0 1.1.5 1.1 1.1v10.1L8 10.9l-5 2.7V3.5c0-.6.5-1.1 1.1-1.1Z'],
      jump: ['M8 2.6v8.2', 'M4.7 7.6 8 10.9l3.3-3.3', 'M3 13.2h10'],
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
          h(
            'div',
            { className: 'sw-note-left' },
            note.pinned ? h('span', { className: 'sw-note-pin', title: t('pin') }, h(Glyph, { name: 'pin', size: 11 })) : null,
            h('time', { className: 'sw-note-time', dateTime: new Date(note.updatedAt).toISOString(), title: fullTime(note.updatedAt) }, shortTime(note.updatedAt)),
          ),
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

    /** First-use and no-search-result states for the bookmark tab. */
    function bookmarkEmptyState(t, filtered) {
      return h(
        'div',
        { className: 'sw-empty' },
        h('p', { className: 'sw-empty-title' }, filtered ? t('bookmarkEmptyFilteredTitle') : t('bookmarkEmptyTitle')),
        h('p', { className: 'sw-empty-body' }, filtered ? t('bookmarkEmptyFilteredBody') : t('bookmarkEmptyBody')),
      )
    }

    /** Filter bookmarks by their own text or their Session title. */
    function visibleBookmarks(bookmarks, query, titleOf) {
      const needle = query.trim().toLowerCase()
      if (needle === '') return bookmarks
      return bookmarks.filter((bookmark) =>
        bookmark.text.toLowerCase().includes(needle)
        || titleOf(bookmark.sessionId, bookmark.sessionTitle).toLowerCase().includes(needle),
      )
    }

    /** A stable paper hue per Session, so one Session keeps one card tint. */
    function sessionColor(sessionId) {
      let hash = 0
      for (let index = 0; index < sessionId.length; index += 1) hash = (hash * 31 + sessionId.charCodeAt(index)) >>> 0
      return COLORS[hash % COLORS.length]
    }

    /** Newest bookmark first, grouped by the Session it came from. */
    function groupBookmarks(bookmarks, titleOf) {
      const groups = new Map()
      for (const bookmark of bookmarks) {
        let group = groups.get(bookmark.sessionId)
        if (group === undefined) {
          group = {
            sessionId: bookmark.sessionId,
            title: titleOf(bookmark.sessionId, bookmark.sessionTitle),
            color: sessionColor(bookmark.sessionId),
            items: [],
          }
          groups.set(bookmark.sessionId, group)
        }
        group.items.push(bookmark)
      }
      return [...groups.values()].sort((left, right) => right.items[0].createdAt - left.items[0].createdAt)
    }

    /** Notes / Bookmarks switch shared by the page header. */
    function Tabs({ t, tab, noteCount, bookmarkCount, onChange }) {
      const move = (event, id) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
        if (!keys.includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home'
          ? 'notes'
          : event.key === 'End'
            ? 'bookmarks'
            : id === 'notes' ? 'bookmarks' : 'notes'
        onChange(next)
        // The new selection renders in the same commit; move focus afterwards.
        window.requestAnimationFrame(() => document.getElementById('sticky-wall-tab-' + next)?.focus())
      }
      const button = (id, label, count) =>
        h(
          'button',
          {
            key: id,
            id: 'sticky-wall-tab-' + id,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === id,
            'aria-controls': 'sticky-wall-panel-' + id,
            'data-tab': id,
            tabIndex: tab === id ? 0 : -1,
            className: 'sw-tab' + (tab === id ? ' is-active' : ''),
            onClick: () => onChange(id),
            onKeyDown: (event) => move(event, id),
          },
          h('span', null, label),
          h('span', { className: 'sw-tab-count' }, String(count)),
        )
      return h(
        'div',
        { className: 'sw-tabs', role: 'tablist', 'aria-label': t('title') },
        button('notes', t('tabNotes'), noteCount),
        button('bookmarks', t('tabBookmarks'), bookmarkCount),
      )
    }

    /** One indexed bookmark card, tinted like the notes wall. */
    function BookmarkCard({ bookmark, color, t, onJump, onCopy, onDelete }) {
      const [expanded, setExpanded] = useState(false)
      const [overflowing, setOverflowing] = useState(false)
      const textRef = useRef(null)

      // Show the toggle only when the clamped paragraph actually hides text;
      // an expanded card keeps the control so it can be collapsed again.
      useLayoutEffect(() => {
        const element = textRef.current
        if (element === null) return
        if (expanded) {
          setOverflowing(true)
          return
        }
        setOverflowing(element.scrollHeight > element.clientHeight + 1)
      }, [bookmark.text, expanded])

      return h(
        'article',
        {
          className: 'sw-bookmark',
          style: { '--sw-color': PAPER[color] },
          role: 'listitem',
          'aria-label': bookmark.text.slice(0, 80),
          onClick: (event) => {
            if (event.target instanceof Element && event.target.closest('button') !== null) return
            onJump(bookmark)
          },
        },
        h(
          'button',
          {
            ref: textRef,
            type: 'button',
            className: 'sw-bookmark-text' + (expanded ? ' is-expanded' : ''),
            title: t('bookmarkJump'),
            onClick: () => onJump(bookmark),
          },
          bookmark.text,
        ),
        overflowing
          ? h(
              'button',
              {
                type: 'button',
                className: 'sw-bookmark-toggle',
                'aria-expanded': expanded,
                onClick: () => setExpanded((value) => !value),
              },
              expanded ? t('bookmarkCollapse') : t('bookmarkExpand'),
            )
          : null,
        h(
          'div',
          { className: 'sw-bookmark-foot' },
          h(
            'div',
            { className: 'sw-bookmark-meta' },
            h('time', { className: 'sw-bookmark-time', dateTime: new Date(bookmark.createdAt).toISOString(), title: fullTime(bookmark.createdAt) }, shortTime(bookmark.createdAt)),
            bookmark.turn === undefined ? null : h('span', { className: 'sw-bookmark-turn' }, t('bookmarkTurn', { n: bookmark.turn })),
          ),
          h(
            'div',
            { className: 'sw-bookmark-actions' },
            h(
              'button',
              { type: 'button', className: 'sw-icon-button', 'aria-label': t('bookmarkJump'), title: t('bookmarkJump'), onClick: () => onJump(bookmark) },
              h(Glyph, { name: 'jump', size: 14 }),
            ),
            h(
              'button',
              { type: 'button', className: 'sw-icon-button', 'aria-label': t('copy'), title: t('copy'), onClick: () => onCopy(bookmark) },
              h(Glyph, { name: 'copy', size: 14 }),
            ),
            h(
              'button',
              { type: 'button', className: 'sw-icon-button sw-danger', 'aria-label': t('delete'), title: t('delete'), onClick: () => onDelete(bookmark) },
              h(Glyph, { name: 'trash', size: 14 }),
            ),
          ),
        ),
      )
    }

    /** Every rendered text source that may belong to one Chat seat, in DOM order. */
    function textSources(seat) {
      const list = []
      if (seat.hasAttribute('data-text-interaction-source')) list.push(seat)
      for (const element of seat.querySelectorAll('[data-text-interaction-source]')) list.push(element)
      const outer = seat.closest('[data-text-interaction-source]')
      if (outer !== null && !list.includes(outer)) list.push(outer)
      return list
    }

    /** Child-index path from `root` to `node`; null when detached. */
    function pathTo(root, node) {
      const path = []
      let current = node
      while (current !== root) {
        const parent = current.parentNode
        if (parent === null) return null
        const index = [...parent.childNodes].indexOf(current)
        if (index < 0) return null
        path.unshift(index)
        current = parent
      }
      return path
    }

    /**
     * The Chat selection action. It replaces the shipped quote pill with one
     * pill that keeps Quote and adds Bookmark, so selecting text never has to
     * choose between them; the same component serves the context-menu trigger.
     */
    function SelectionSurface({ t, readText, dismiss, clearSelection, inputActions, useSession, addBookmark, quoteAvailable }) {
      const sessionId = useSession((session) => session.sessionId)
      const removed = useSession((session) => session.removed)
      const quoteEligible = useSession((session) => !session.removed && (session.subagent === null || session.subagent.address.mode === 'continuable'))
      const [feedback, setFeedback] = useState(null)
      const timer = useRef(0)

      useEffect(() => () => window.clearTimeout(timer.current), [])
      useEffect(() => {
        if (removed) dismiss()
      }, [removed, dismiss])

      const canBookmark = !removed
      const canQuote = quoteEligible && typeof quoteAvailable === 'function' && quoteAvailable()
      if (!canBookmark && !canQuote) return null

      const feedbackText = feedback === 'added'
        ? t('bookmarkAdded')
        : feedback === 'duplicate'
          ? t('bookmarkExists')
          : feedback === 'archived'
            ? t('bookmarkArchived')
            : feedback === null ? null : t('bookmarkFailed')

      function later(ms) {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(dismiss, ms)
      }

      function quote() {
        const text = readText()
        if (text === null) {
          dismiss()
          return
        }
        if (inputActions === undefined || typeof inputActions.insertQuote !== 'function') return
        if (!inputActions.insertQuote(text)) return
        clearSelection()
        dismiss()
      }

      /** Read the Chat seat/source that owns the current selection; `null` outside it. */
      function readLocation(text) {
        try {
          const selection = window.getSelection()
          if (selection === null || selection.rangeCount === 0) return null
          const range = selection.getRangeAt(0)
          const node = range.startContainer
          const element = node instanceof Element ? node : node.parentElement
          if (element === null) return null
          const seat = element.closest('[data-chat-node-key], [data-chat-turn]')
          if (seat === null) return null
          const turn = Number(seat.getAttribute('data-chat-turn'))
          const location = {
            turn: Number.isInteger(turn) && turn > 0 ? turn : undefined,
            nodeKey: seat.getAttribute('data-chat-node-key') ?? undefined,
            flowKey: seat.getAttribute('data-chat-flow-key') ?? undefined,
          }

          // Character offsets make the jump land on the selected words, not
          // merely the message row. The short prefix/suffix disambiguates
          // repeated text when the message is rendered again.
          const source = element.closest('[data-text-interaction-source]')
          if (source !== null && typeof text === 'string' && text !== '') {
            const sources = textSources(seat)
            const sourceIndex = sources.indexOf(source)
            const startPath = pathTo(source, range.startContainer)
            const endPath = pathTo(source, range.endContainer)
            if (sourceIndex >= 0 && startPath !== null && endPath !== null) {
              location.sourceIndex = sourceIndex
              location.startPath = startPath
              location.startOffset = range.startOffset
              location.endPath = endPath
              location.endOffset = range.endOffset
            }

            const content = source.textContent ?? ''
            location.sourceHash = textHash(content)
            location.sourceLength = content.length
            const raw = selection.toString()
            const leading = raw.length - raw.trimStart().length
            const before = document.createRange()
            before.selectNodeContents(source)
            before.setEnd(range.startContainer, range.startOffset)
            let offset = before.toString().length + leading
            if (content.slice(offset, offset + text.length) !== text) {
              const found = content.indexOf(text)
              if (found >= 0) offset = found
            }
            if (offset >= 0 && offset <= content.length) {
              location.offset = offset
              const prefix = content.slice(Math.max(0, offset - 32), offset)
              const suffix = content.slice(offset + text.length, offset + text.length + 32)
              if (prefix !== '') location.prefix = prefix
              if (suffix !== '') location.suffix = suffix
            }
          }
          return location
        } catch (_error) {
          return null
        }
      }

      function bookmark() {
        const text = readText()
        if (text === null) {
          dismiss()
          return
        }
        const result = typeof addBookmark === 'function' ? addBookmark(text, sessionId, readLocation(text)) : 'failed'
        setFeedback(result)
        later(result === 'added' || result === 'duplicate' ? 1800 : 2400)
      }

      return h(
        'div',
        { className: 'sw-select-bar', role: 'group', 'aria-label': t('selectionLabel') },
        canQuote
          ? h(
              'button',
              { type: 'button', className: 'sw-select-button', onPointerDown: (event) => event.preventDefault(), onClick: quote },
              t('quoteText'),
            )
          : null,
        canQuote && canBookmark ? h('span', { className: 'sw-select-divider', 'aria-hidden': 'true' }) : null,
        canBookmark
          ? h(
              'button',
              {
                type: 'button',
                className: 'sw-select-button sw-select-bookmark',
                'aria-label': feedbackText ?? t('bookmarkAddLabel'),
                title: feedbackText ?? t('bookmarkAddLabel'),
                onPointerDown: (event) => event.preventDefault(),
                onClick: bookmark,
              },
              h(Glyph, { name: 'bookmark', size: 13 }),
              h('span', null, feedbackText ?? t('bookmarkAdd')),
            )
          : null,
        feedbackText === null ? null : h('span', { className: 'sw-select-status', role: 'status' }, feedbackText),
      )
    }

    // ── layout ─────────────────────────────────────────────────────────────

    /** Fallbacks for the wall's layout knobs, which the stylesheet owns. */
    const WALL_GAP = 14
    const WALL_MIN_COLUMN = 228

    /** Read one of the wall's own pixel tokens, falling back when it is unset. */
    function cssPixels(style, name, fallback) {
      const value = Number.parseFloat(style.getPropertyValue(name))
      return Number.isFinite(value) && value > 0 ? value : fallback
    }

    /**
     * Pack the cards onto the wall in staggered columns.
     *
     * A grid keeps every card of a row on the same line, so a short note leaves
     * a hole underneath itself until the tallest card of that row ends. Here
     * each card keeps its measured height and drops onto whichever column is
     * currently shortest (ties go left), which is what makes uneven notes sit
     * tightly together; the price is a ragged bottom edge.
     *
     * The DOM stays in reading order and React keeps owning the cards; only
     * their box (width, `top`, `left`) and the wall's height are written
     * straight to the elements. A re-measure therefore never re-renders, and an
     * editing textarea keeps its focus while its own card grows.
     *
     * @param wallRef - ref to the `.sw-wall` element.
     * @param signature - changes whenever the card list or a card's text does,
     *   so a saved edit is re-packed even before the observer fires.
     */
    function useWallMasonry(wallRef, signature) {
      const pack = useCallback(() => {
        const wall = wallRef.current
        if (wall === null) return
        const cards = wall.querySelectorAll('.sw-note')
        if (cards.length === 0) {
          wall.style.height = '0px'
          return
        }
        const available = wall.clientWidth
        if (available <= 0) return

        const computed = window.getComputedStyle(wall)
        const gap = cssPixels(computed, '--sw-wall-gap', WALL_GAP)
        const minColumn = cssPixels(computed, '--sw-wall-min', WALL_MIN_COLUMN)
        const columns = Math.max(1, Math.floor((available + gap) / (minColumn + gap)))
        const width = (available - gap * (columns - 1)) / columns

        for (const card of cards) card.style.width = width + 'px'

        // Measure every height before writing any position: interleaving the
        // two would make the browser lay the wall out once per card.
        const heights = []
        for (const card of cards) heights.push(card.getBoundingClientRect().height)

        const bottom = new Array(columns).fill(0)
        let tallest = 0
        for (let index = 0; index < cards.length; index += 1) {
          let column = 0
          for (let next = 1; next < columns; next += 1) {
            if (bottom[next] < bottom[column] - 0.5) column = next
          }
          cards[index].style.left = column * (width + gap) + 'px'
          cards[index].style.top = bottom[column] + 'px'
          bottom[column] += heights[index] + gap
          if (bottom[column] > tallest) tallest = bottom[column]
        }
        wall.style.height = Math.max(0, tallest - gap) + 'px'
      }, [wallRef])

      // Run after every render that can change the cards, but before the
      // browser paints, so the wall never flashes as an unpositioned stack.
      useLayoutEffect(() => {
        pack()
      }, [pack, signature])

      // The sidebar, the window, the font, and an editing textarea all change
      // a card's box without a render; re-pack whenever a measured size moves.
      useEffect(() => {
        const wall = wallRef.current
        if (wall === null) return undefined
        const redraw = () => pack()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null
        if (observer !== null) {
          observer.observe(wall)
          for (const card of wall.querySelectorAll('.sw-note')) observer.observe(card)
        }
        window.addEventListener('resize', redraw)
        return () => {
          if (observer !== null) observer.disconnect()
          window.removeEventListener('resize', redraw)
        }
      }, [pack, signature])
    }

    // ── page ───────────────────────────────────────────────────────────────

    /** The wall panel: notes, quick capture, search, and the bookmark index. */
    function StickyWallPage({ t, bridge }) {
      const [notes, setNotes] = useState(() => loadState().notes)
      const [color, setColor] = useState(() => loadState().color)
      const [tab, setTab] = useState(() => loadState().tab)
      const [query, setQuery] = useState('')
      const [draft, setDraft] = useState('')
      const [editing, setEditing] = useState(null)
      const [toast, setToast] = useState(null)
      const composerRef = useRef(null)
      const wallRef = useRef(null)
      const toastTimer = useRef(0)

      const subscribeBookmarks = useCallback((listener) => bridge.bookmarkStore.subscribe(listener), [bridge])
      const bookmarks = useSyncExternalStore(subscribeBookmarks, bridge.bookmarkStore.getSnapshot)
      const subscribeWorkspace = useCallback((listener) => bridge.workspaces.list.subscribe(listener), [bridge])
      const getWorkspace = useCallback(() => bridge.workspaces.list.getSnapshot(), [bridge])
      const workspace = useSyncExternalStore(subscribeWorkspace, getWorkspace)
      const subscribeSessions = useCallback((listener) => bridge.sessions.list.subscribe(listener), [bridge])
      const getSessions = useCallback(() => bridge.sessions.list.getSnapshot(), [bridge])
      const sessionList = useSyncExternalStore(subscribeSessions, getSessions)

      useEffect(() => {
        writeStore(NOTES_KEY, notes)
      }, [notes])

      useEffect(() => {
        writeStore(PREFS_KEY, { color, tab })
      }, [color, tab])

      // Another window of the same page may have changed notes or preferences.
      useEffect(() => {
        const sync = (event) => {
          if (event.key === NOTES_KEY) {
            setNotes(loadState().notes)
          } else if (event.key === PREFS_KEY) {
            const prefs = loadState()
            setColor(prefs.color)
            setTab(prefs.tab)
          }
        }
        window.addEventListener('storage', sync)
        return () => window.removeEventListener('storage', sync)
      }, [])

      // A bookmark belongs to one Session; archiving that Session removes it.
      const archivedIds = workspace.phase === 'ready' ? workspace.archivedSessionIds : null
      useEffect(() => {
        if (archivedIds === null) return
        const archived = new Set(archivedIds)
        const doomed = bookmarks.filter((bookmark) => archived.has(bookmark.sessionId))
        if (doomed.length === 0) return
        bridge.bookmarkStore.purge(doomed.map((bookmark) => bookmark.id))
        showToast(doomed.length === 1 ? t('bookmarkArchivedRemovedOne') : t('bookmarkArchivedRemoved', { n: doomed.length }))
      }, [archivedIds, bookmarks, bridge, t])

      // The visible page owns the archive toast; the plugin-level listener in
      // `apply` covers the case where the user archives a Session while this
      // page is closed. On mount, report a purge that happened while closed.
      useEffect(() => {
        bridge.mountedPages += 1
        const pending = bridge.pendingArchiveNotice + bridge.cleanupArchived()
        bridge.pendingArchiveNotice = 0
        if (pending > 0) {
          showToast(pending === 1 ? t('bookmarkArchivedRemovedOne') : t('bookmarkArchivedRemoved', { n: pending }))
        }
        return () => {
          bridge.mountedPages -= 1
          const leftover = bridge.cleanupArchived()
          if (leftover > 0) bridge.pendingArchiveNotice += leftover
        }
      }, [bridge])

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

      function switchTab(next) {
        if (next === tab) return
        setTab(next)
        setQuery('')
      }

      function titleOf(sessionId, fallback) {
        return sessionList.byId[sessionId]?.displayTitle || fallback || t('bookmarkSessionUnknown')
      }

      function openBookmarkSession(sessionId) {
        if (bridge.isArchived(sessionId)) {
          showToast(t('bookmarkOpenFailed'))
          return
        }
        try {
          bridge.uiWorkspace.openSession(sessionId)
        } catch (_error) {
          showToast(t('bookmarkOpenFailed'))
        }
      }

      function jumpBookmark(bookmark) {
        if (bridge.isArchived(bookmark.sessionId)) {
          showToast(t('bookmarkOpenFailed'))
          return
        }
        if (!bridge.jumpToBookmark(bookmark)) showToast(t('bookmarkJumpFailed'))
      }

      async function copyBookmark(bookmark) {
        try {
          await navigator.clipboard.writeText(bookmark.text)
          showToast(t('bookmarkCopied'))
        } catch (_error) {
          showToast(t('bookmarkCopyFailed'))
        }
      }

      function removeBookmark(bookmark) {
        bridge.bookmarkStore.remove(bookmark.id)
        showToast(t('bookmarkDeleted'), {
          label: t('undo'),
          focus: true,
          run: () => {
            if (bridge.isArchived(bookmark.sessionId)) return t('bookmarkRestoreFailed')
            bridge.bookmarkStore.restore(bookmark)
            return undefined
          },
        })
      }

      const editActions = {
        text: (value) => setEditing((current) => (current === null ? current : { ...current, text: value })),
        color: (next) => setEditing((current) => (current === null ? current : { ...current, color: next })),
        save: saveEdit,
        cancel: () => setEditing(null),
      }

      const visible = useMemo(() => (tab === 'notes' ? visibleNotes(notes, query) : []), [tab, notes, query])
      const bookmarkRows = useMemo(() => visibleBookmarks(bookmarks, query, titleOf), [bookmarks, query, titleOf])
      const bookmarkGroups = useMemo(() => groupBookmarks(bookmarkRows, titleOf), [bookmarkRows, titleOf])
      const signature = tab + '|' + visible.map((note) => note.id + ':' + note.updatedAt).join('|')
      useWallMasonry(wallRef, signature)

      const total = tab === 'notes' ? notes.length : bookmarks.length
      const unit = total === 1
        ? t(tab === 'notes' ? 'countUnitOne' : 'bookmarkCountUnitOne')
        : t(tab === 'notes' ? 'countUnit' : 'bookmarkCountUnit')
      const countTitle = tab === 'notes' ? t('autoSaved') : t('bookmarkHint')
      const searchPlaceholder = tab === 'notes' ? t('searchPlaceholder') : t('bookmarkSearchPlaceholder')
      const searchLabel = tab === 'notes' ? t('searchLabel') : t('bookmarkSearchLabel')

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
              h('h1', { className: 'sw-title' }, t('title')),
              h(
                'div',
                { className: 'sw-head-tools' },
                h('span', { className: 'sw-count', title: countTitle }, h(Glyph, { name: tab === 'notes' ? 'check' : 'bookmark', size: 12 }), h('span', null, total + ' ' + unit)),
                h(
                  'label',
                  { className: 'sw-search' },
                  h(Glyph, { name: 'search', size: 14 }),
                  h('input', {
                    type: 'search',
                    value: query,
                    placeholder: searchPlaceholder,
                    'aria-label': searchLabel,
                    onChange: (event) => setQuery(event.target.value),
                  }),
                  query === ''
                    ? null
                    : h('button', { type: 'button', className: 'sw-search-clear', 'aria-label': t('clearSearch'), onClick: () => setQuery('') }, h(Glyph, { name: 'close', size: 12 })),
                ),
              ),
            ),
            h(Tabs, { t, tab, noteCount: notes.length, bookmarkCount: bookmarks.length, onChange: switchTab }),
            h(
              'div',
              { key: 'tabpanel', id: 'sticky-wall-panel-' + tab, role: 'tabpanel', 'aria-labelledby': 'sticky-wall-tab-' + tab },
              tab === 'notes'
                ? [
                  h(Composer, { key: 'composer', t, draft, color, inputRef: composerRef, onDraft: setDraft, onColor: setColor, onSave: addNote }),
                  visible.length === 0
                    ? h('div', { key: 'empty' }, emptyState(t, query.trim() !== ''))
                    : h(
                        'div',
                        { key: 'wall', className: 'sw-wall', role: 'list', ref: wallRef },
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
                ]
              : bookmarkRows.length === 0
                ? [h('div', { key: 'empty' }, bookmarkEmptyState(t, query.trim() !== ''))]
                : [
                    h('p', { key: 'hint', className: 'sw-bookmark-hint' }, t('bookmarkHint')),
                    h(
                      'div',
                      { key: 'groups', className: 'sw-bookmarks' },
                      bookmarkGroups.map((group) =>
                          h(
                            'section',
                            { key: group.sessionId, className: 'sw-bookmark-group' },
                            h(
                              'header',
                              { className: 'sw-bookmark-group-head' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'sw-bookmark-session',
                                  title: t('bookmarkOpen'),
                                  onClick: () => openBookmarkSession(group.sessionId),
                                },
                                h(Glyph, { name: 'bookmark', size: 12 }),
                                h('span', { className: 'sw-bookmark-session-text' }, group.title),
                              ),
                              h('span', { className: 'sw-bookmark-group-count' }, group.items.length + ' ' + t(group.items.length === 1 ? 'bookmarkCountUnitOne' : 'bookmarkCountUnit')),
                            ),
                            h(
                              'div',
                              { className: 'sw-bookmark-list', role: 'list' },
                              group.items.map((bookmark) =>
                                h(BookmarkCard, {
                                  key: bookmark.id,
                                  bookmark,
                                  color: group.color,
                                  t,
                                  onJump: jumpBookmark,
                                  onCopy: copyBookmark,
                                  onDelete: removeBookmark,
                                }),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
            ),
          ),
        ),
        toast === null
          ? null
          : h(
              'div',
              { className: 'sw-toast', role: 'status', 'aria-live': 'polite' },
              h('span', null, toast.message),
              toast.action === null
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'sw-toast-action',
                      autoFocus: toast.action.focus === true,
                      onClick: () => {
                        const replacement = toast.action.run()
                        if (typeof replacement === 'string' && replacement !== '') showToast(replacement)
                        else dismissToast()
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
.sw-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding-top:30px;margin-bottom:20px}
[data-platform=darwin] .sw-head{padding-top:calc(30px + var(--dsh-frame-top-clearance,0px))}
.sw-title{margin:0;font-size:22px;font-weight:600;line-height:30px;letter-spacing:-.01em}
.sw-head-tools{display:flex;flex-wrap:wrap;align-items:center;gap:14px}
.sw-count{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}
.sw-search{display:flex;align-items:center;gap:6px;height:32px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);transition:border-color .15s}
.sw-search:hover{border-color:var(--dsw-alias-border-l4)}
.sw-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.sw-search input{width:180px;min-width:0;padding:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.sw-search input::placeholder{color:var(--dsw-alias-label-caption)}
.sw-search input::-webkit-search-cancel-button{display:none}
.sw-search-clear{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.sw-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sw-composer{margin-bottom:24px;padding:10px 12px 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);transition:border-color .15s}
.sw-composer:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.sw-composer-input{display:block;width:100%;min-height:46px;max-height:220px;padding:4px 2px 8px;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;resize:none;field-sizing:content;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.sw-composer-input::placeholder{color:var(--dsw-alias-label-caption)}
.sw-composer-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.sw-swatches{display:flex;align-items:center;gap:6px}
.sw-swatch{width:16px;height:16px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);background:var(--swatch);cursor:pointer;transition:border-color .12s,box-shadow .12s}
.sw-swatch.is-small{width:13px;height:13px}
.sw-swatch:hover{border-color:var(--dsw-alias-border-l4)}
.sw-swatch.is-selected{border-color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-label-primary)}
.sw-composer-actions{display:flex;align-items:center;gap:10px}
.sw-hint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px}
.sw-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;padding:0 11px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.sw-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sw-button:disabled{opacity:.5;cursor:default}
.sw-button-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.sw-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.sw-wall{position:relative;width:100%;--sw-wall-gap:14px;--sw-wall-min:228px}
.sw-note{position:absolute;top:0;left:0;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;min-width:0;width:100%;padding:9px 12px 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:color-mix(in oklab,var(--sw-color) 10%,var(--dsw-alias-bg-layer-1));transition:background .15s,border-color .15s}
.sw-note:hover{background:color-mix(in oklab,var(--sw-color) 14%,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-border-l4)}
.sw-note-pinned{background:color-mix(in oklab,var(--sw-color) 15%,var(--dsw-alias-bg-layer-1));border-color:color-mix(in oklab,var(--sw-color) 38%,var(--dsw-alias-border-l3))}
.sw-note-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:20px}
.sw-note-left{display:flex;align-items:center;gap:5px;min-width:0}
.sw-note-pin{display:inline-flex;flex:none;color:var(--dsw-alias-state-business-primary)}
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
.sw-note-textarea{width:100%;min-height:84px;max-height:320px;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;resize:vertical;field-sizing:content}
.sw-note-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.sw-edit-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.sw-edit-actions{display:flex;align-items:center;gap:6px}
.sw-edit-actions .sw-button{height:26px;padding:0 10px;font-size:12px}
.sw-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:72px 24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.sw-empty-title{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;line-height:22px}
.sw-empty-body{max-width:380px;margin:0;font-size:13px;line-height:21px}
.sw-tabs{display:flex;align-items:center;gap:2px;margin:-2px 0 20px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
.sw-tab{position:relative;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm) var(--dsw-radius-sm) 0 0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:background .12s,color .12s}
.sw-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sw-tab.is-active{color:var(--dsw-alias-label-primary);font-weight:500}
.sw-tab.is-active::after{content:'';position:absolute;right:8px;bottom:-1px;left:8px;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
.sw-tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}
.sw-tab.is-active .sw-tab-count{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.sw-bookmark-hint{margin:-4px 0 18px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
.sw-bookmarks{display:flex;flex-direction:column;gap:20px;padding-bottom:8px}
.sw-bookmark-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.sw-bookmark-group-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:26px}
.sw-bookmark-session{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;padding:3px 7px 3px 5px;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s,color .12s}
.sw-bookmark-session:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sw-bookmark-session svg{color:var(--dsw-alias-label-tertiary)}
.sw-bookmark-session-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sw-bookmark-group-count{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}
.sw-bookmark-list{display:flex;flex-direction:column;gap:8px}
.sw-bookmark{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;padding:9px 12px 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:color-mix(in oklab,var(--sw-color) 9%,var(--dsw-alias-bg-layer-1));transition:background .15s,border-color .15s;cursor:pointer}
.sw-bookmark:hover{background:color-mix(in oklab,var(--sw-color) 13%,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-border-l4)}
.sw-bookmark-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;width:100%;margin:0;padding:0;border:0;background:transparent;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;appearance:none}
.sw-bookmark-text.is-expanded{display:block;overflow:visible}
.sw-bookmark-meta{display:flex;align-items:center;gap:8px;min-width:0}
.sw-bookmark-turn{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap}
.sw-bookmark-toggle{align-self:flex-start;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.sw-bookmark-toggle:hover{color:var(--dsw-alias-label-primary)}
.sw-bookmark-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:20px}
.sw-bookmark-time{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.sw-bookmark-actions{display:flex;align-items:center;gap:1px;opacity:0;transition:opacity .12s}
.sw-bookmark:hover .sw-bookmark-actions,.sw-bookmark:focus-within .sw-bookmark-actions{opacity:1}
.sw-select-bar{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--dsw-alias-button-floating-fill);--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary)}
.sw-select-button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:inherit;font:var(--dsw-font-xs-13);line-height:20px;white-space:nowrap;cursor:pointer;transition:background .12s}
.sw-select-button:hover{background:var(--dsw-alias-button-floating-hover)}
.sw-select-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;background:var(--dsw-alias-button-floating-hover)}
.sw-select-divider{flex:none;width:1px;height:14px;background:var(--dsw-alias-border-l3)}
.sw-select-bookmark{font-weight:500}
.sw-select-status{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.sw-bookmark-jump{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:3px;border-radius:6px;transition:outline-color .2s}
/* The bookmark locator is only the yellow frame around the selected words.
   Its ink is tuned separately for the light and dark app themes; no label,
   badge, or close control is attached. */
.sw-jump-locator{position:fixed;inset:0;z-index:2147483000;pointer-events:none}
.sw-jump-locator[hidden]{display:none}
.sw-jump-locator-box{
  --sw-jump-outline:#b97b00;
  --sw-jump-fill:rgba(255,193,7,.18);
  --sw-jump-halo:rgba(185,123,0,.18);
  position:fixed;box-sizing:border-box;border:2px solid var(--sw-jump-outline);border-radius:5px;background:var(--sw-jump-fill);box-shadow:0 0 0 1px var(--sw-jump-halo);pointer-events:none;animation:sw-jump-fade .15s ease-out;
}
body[data-ds-dark-theme] .sw-jump-locator-box{
  --sw-jump-outline:#ffd54f;
  --sw-jump-fill:rgba(255,213,79,.22);
  --sw-jump-halo:rgba(255,213,79,.18);
}
@keyframes sw-jump-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.sw-jump-locator-box{animation:none}}
.sw-toast{position:absolute;bottom:22px;left:50%;z-index:2;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100% - 48px));padding:8px 10px 8px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);box-shadow:var(--dsw-shadow-lv2);font-size:13px;line-height:20px;transform:translateX(-50%)}
.sw-toast span{min-width:0;overflow-wrap:anywhere}
.sw-toast-action{flex:none;height:26px;padding:0 10px;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-toast-action);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.sw-toast-action:hover{background:color-mix(in srgb,var(--dsw-alias-toast-label) 10%,transparent)}
.sw-page :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sw-composer-input:focus-visible,.sw-note-textarea:focus-visible,.sw-search input:focus-visible{outline:none}
@media (hover:none){.sw-note-actions,.sw-bookmark-actions{opacity:1}}
@media (width<=760px){.sw-search input{width:120px}.sw-wall{--sw-wall-min:200px}.sw-content{padding-bottom:48px}.sw-bookmark-session{max-width:calc(100% - 64px)}}
@media (prefers-reduced-motion:reduce){.sw-note,.sw-swatch,.sw-button,.sw-icon-button,.sw-search,.sw-composer,.sw-tab,.sw-bookmark,.sw-select-button,.sw-bookmark-toggle{transition:none}}
/* Dark palette: the same layout, mixed against the raised dark layers. The
   light layers are all white, so paper tints there need a white base; here
   they need the dark surface, or every note turns into a pale sticker. */
body[data-ds-dark-theme] .sw-note{background:color-mix(in oklab,var(--sw-color) 14%,var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-border-l2)}
body[data-ds-dark-theme] .sw-note:hover{background:color-mix(in oklab,var(--sw-color) 18%,var(--dsw-alias-bg-layer-2))}
body[data-ds-dark-theme] .sw-note-pinned{background:color-mix(in oklab,var(--sw-color) 17%,var(--dsw-alias-bg-layer-2))}
body[data-ds-dark-theme] .sw-bookmark{background:color-mix(in oklab,var(--sw-color) 14%,var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-border-l2)}
body[data-ds-dark-theme] .sw-bookmark:hover{background:color-mix(in oklab,var(--sw-color) 18%,var(--dsw-alias-bg-layer-2))}
body[data-ds-dark-theme] .sw-composer{background:var(--dsw-alias-bg-layer-2)}
`

    // ── plugin ─────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'uiConversation']

    /**
     * The small service face both the page and the selection surface share.
     * @param ctx - the browser plugin context with every injected service.
     * @param bookmarkStore - the browser-local bookmark index.
     */
    function createBridge(ctx, bookmarkStore) {
      const { sessions, workspaces, uiWorkspace, uiConversation } = ctx

      const isArchived = (sessionId) => workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)
      const sessionTitle = (sessionId, fallback) =>
        sessions.list.getSnapshot().byId[sessionId]?.displayTitle || fallback || sessionId
      /** Resolve the turn's `turn/start` seq from the whole-log outline, when present. */
      const turnSeq = (sessionId, turn) => {
        if (!Number.isInteger(turn) || turn <= 0) return undefined
        try {
          const outline = sessions.binding(sessionId)?.session.projections.faceOf('turnOutline').getSnapshot()
          return Array.isArray(outline) ? outline.find((entry) => entry.turn === turn)?.seq : undefined
        } catch (_error) {
          return undefined
        }
      }

      return {
        bookmarkStore,
        sessions,
        workspaces,
        uiWorkspace,
        /** Number of mounted wall pages; the visible page owns its archive toast. */
        mountedPages: 0,
        /** Purges that happened while no wall page was mounted, reported on the next visit. */
        pendingArchiveNotice: 0,
        isArchived,
        sessionTitle,
        /** Purge bookmarks whose Session is already archived; safe to call at any time. */
        cleanupArchived() {
          const snapshot = workspaces.list.getSnapshot()
          if (snapshot.phase !== 'ready') return 0
          const archived = new Set(snapshot.archivedSessionIds)
          const doomed = bookmarkStore.getSnapshot().filter((bookmark) => archived.has(bookmark.sessionId))
          if (doomed.length > 0) bookmarkStore.purge(doomed.map((bookmark) => bookmark.id))
          return doomed.length
        },
        /** @returns `added`, `duplicate`, `archived`, or `empty`. */
        addBookmark(text, sessionId, location = null) {
          if (isArchived(sessionId)) return 'archived'
          const where = location === null || typeof location !== 'object' ? {} : location
          const seq = where.seq ?? turnSeq(sessionId, where.turn)
          return bookmarkStore.add(text, sessionId, sessionTitle(sessionId), { ...where, seq })
        },
        quoteAvailable() {
          return uiConversation.interactions.getSnapshot().includes(QUOTE_INTERACTION_ID)
        },
        quoteEligible(sessionId) {
          const binding = sessions.binding(sessionId)
          if (binding === undefined) return false
          const snapshot = binding.session.getSnapshot()
          return !snapshot.removed && (snapshot.subagent === null || snapshot.subagent.address.mode === 'continuable')
        },
      }
    }

    /**
     * Contribute the sidebar entry, its panel page, the shared stylesheet, and
     * the selection action shared with the shipped quote surface.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, STRINGS), 'sticky-wall: dictionaries')

      const t = ctx.locale.bind(NS)
      const bookmarkStore = createBookmarkStore()
      const bridge = createBridge(ctx, bookmarkStore)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'sticky-wall'
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => style.remove()
      }, 'sticky-wall: styles')

      // Another window of the same page may add or remove bookmarks.
      ctx.effect(() => {
        const sync = (event) => {
          if (event.key === BOOKMARKS_KEY) bookmarkStore.reload()
        }
        window.addEventListener('storage', sync)
        return () => window.removeEventListener('storage', sync)
      }, 'sticky-wall: bookmark storage sync')

      // Archive cleanup must not depend on the wall page being open; a purge
      // that happens while it is closed is reported on the next visit.
      ctx.effect(() => {
        const cleanup = () => {
          if (bridge.mountedPages !== 0) return
          const purged = bridge.cleanupArchived()
          if (purged > 0) bridge.pendingArchiveNotice += purged
        }
        const dispose = ctx.workspaces.list.subscribe(cleanup)
        cleanup()
        return () => dispose()
      }, 'sticky-wall: archived bookmark cleanup')

      // A bookmark jump opens the Session and, once Chat has rendered the
      // remembered Turn/Node, scrolls that row into view and flashes it.
      let jumpGeneration = 0
      let activeLocator = null
      let disposed = false
      ctx.effect(() => () => {
        disposed = true
        jumpGeneration += 1
        activeLocator?.close()
        activeLocator = null
        for (const element of document.querySelectorAll('.sw-bookmark-jump')) element.classList.remove('sw-bookmark-jump')
      }, 'sticky-wall: jump lifecycle')

      const isVisible = (element) => element.getClientRects().length > 0

      function findJumpSeat(bookmark) {
        const seats = [...document.querySelectorAll('[data-chat-node-key], [data-chat-turn]')]
        // Prefer the exact seat even while it is hidden behind a collapsed
        // process group: expandSeat() opens that group, whereas a visible Turn
        // header would only outline the whole Turn.
        if (bookmark.nodeKey !== undefined) {
          const exact = seats.find((element) => element.getAttribute('data-chat-node-key') === bookmark.nodeKey)
          if (exact !== undefined) return exact
        }
        if (bookmark.flowKey !== undefined) {
          const exact = seats.find((element) => element.getAttribute('data-chat-flow-key') === bookmark.flowKey)
          if (exact !== undefined) return exact
        }
        if (bookmark.turn !== undefined) {
          const turn = String(bookmark.turn)
          const sameTurn = seats.filter((element) => element.getAttribute('data-chat-turn') === turn)
          return sameTurn.find(isVisible) ?? sameTurn[0] ?? null
        }
        return null
      }

      /**
       * Open the collapsed process layers around a seat: the Turn's process
       * header, the step-process group, and the seat's own disclosure row.
       * Bookmarked reasoning/tool text lives under all three when a past Turn
       * is collapsed, while the seat itself can stay in the DOM.
       */
      function expandSeat(seat) {
        const open = (control) => {
          if (control === null || control === undefined) return
          control.click()
          // Programmatic clicks can leave the host's blue focus ring around a
          // process header; the yellow locator must be the only target marker.
          if (typeof control.blur === 'function') control.blur()
        }
        const turn = Number(seat.getAttribute('data-chat-turn'))
        if (Number.isInteger(turn) && turn > 0) {
          const process = [...document.querySelectorAll('[data-chat-flow-kind="turn-process"]')]
            .find((element) => element.getAttribute('data-chat-turn') === String(turn))
          open(process?.querySelector('button[aria-expanded="false"]'))
        }
        const group = seat.closest('[data-step-process]')
        if (group !== null) {
          const control = [...group.querySelectorAll('button[aria-expanded="false"], [role="button"][aria-expanded="false"]')]
            .find((element) => element.closest('[data-chat-node-key]') === null)
          open(control)
        }
        open(seat.querySelector('[data-disclosure-row][aria-expanded="false"]'))
      }

      /** Old bookmarks carry only text; find the visible message that contains it. */
      function findTextSeat(bookmark) {
        const needle = bookmark.text.slice(0, 80).trim()
        if (needle === '') return null
        const sources = [...document.querySelectorAll('[data-text-interaction-source]')]
        const source = sources.find((element) => (element.innerText || element.textContent || '').includes(needle))
        if (source === undefined) return null
        return source.closest('[data-chat-node-key], [data-chat-turn]') ?? source
      }

      /** Build a Range for a character span inside one rendered source element. */
      function rangeFromOffsets(root, start, end) {
        const total = (root.textContent ?? '').length
        const from = Math.max(0, Math.min(start, total))
        const to = Math.max(from, Math.min(end, total))
        if (to <= from) return null
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let position = 0
        let startNode = null
        let startOffset = 0
        let endNode = null
        let endOffset = 0
        let node = walker.nextNode()
        while (node !== null) {
          const length = node.data.length
          if (startNode === null && from <= position + length) {
            startNode = node
            startOffset = from - position
          }
          if (endNode === null && to <= position + length) {
            endNode = node
            endOffset = to - position
            break
          }
          position += length
          node = walker.nextNode()
        }
        if (startNode === null || endNode === null) return null
        const range = document.createRange()
        range.setStart(startNode, startOffset)
        range.setEnd(endNode, endOffset)
        return range
      }

      function normalizeSelectionText(text) {
        return text.replace(/\s+/g, ' ').trim()
      }

      function resolvePath(root, path) {
        let node = root
        for (const index of path) {
          const child = node.childNodes[index]
          if (child === undefined) return null
          node = child
        }
        return node
      }

      function validOffset(node, offset) {
        return Number.isInteger(offset) && offset >= 0
          && offset <= (node.nodeType === 3 ? node.data.length : node.childNodes.length)
      }

      /** Rebuild the exact captured DOM Range through the stored child-index paths. */
      function rangeFromPaths(source, bookmark) {
        const startNode = resolvePath(source, bookmark.startPath)
        const endNode = resolvePath(source, bookmark.endPath)
        if (startNode === null || endNode === null) return null
        if (!validOffset(startNode, bookmark.startOffset) || !validOffset(endNode, bookmark.endOffset)) return null
        try {
          const range = document.createRange()
          range.setStart(startNode, bookmark.startOffset)
          range.setEnd(endNode, bookmark.endOffset)
          if (range.collapsed) return null
          const actual = normalizeSelectionText(range.toString())
          const expected = normalizeSelectionText(bookmark.text)
          if (actual === '' || expected === '') return null
          if (actual !== expected && !actual.includes(expected) && !expected.includes(actual)) return null
          return range
        } catch (_error) {
          return null
        }
      }

      /** Find the exact selected words in a rendered seat, not merely its row. */
      function locateRange(bookmark, seat) {
        const text = typeof bookmark.text === 'string' ? bookmark.text : ''
        if (text === '') return null
        const sources = textSources(seat)

        // The captured DOM path survives whitespace projection and block
        // separators; it is the most precise anchor when the markup is stable.
        if (validPath(bookmark.startPath) && validPath(bookmark.endPath)
          && Number.isInteger(bookmark.startOffset) && Number.isInteger(bookmark.endOffset)) {
          let source
          if (bookmark.sourceHash !== undefined) {
            source = sources.find((candidate) => {
              const content = candidate.textContent ?? ''
              return textHash(content) === bookmark.sourceHash
                && (bookmark.sourceLength === undefined || content.length === bookmark.sourceLength)
            })
          }
          if (source === undefined && Number.isInteger(bookmark.sourceIndex)) {
            source = sources[bookmark.sourceIndex]
          }
          if (source !== undefined && bookmark.prefix !== undefined
            && !(source.textContent ?? '').includes(bookmark.prefix)) source = undefined
          if (source === undefined) {
            const needle = bookmark.prefix ?? text.slice(0, 40)
            source = sources.find((candidate) => (candidate.textContent ?? '').includes(needle))
          }
          if (source !== undefined) {
            const range = rangeFromPaths(source, bookmark)
            if (range !== null) return { range, source, score: 4 }
          }
        }

        let best = null
        for (const source of sources) {
          const content = source.textContent ?? ''
          let at = -1
          if (Number.isInteger(bookmark.offset)) {
            const offset = Math.min(bookmark.offset, content.length)
            if (content.slice(offset, offset + text.length) === text) at = offset
            else {
              const near = content.indexOf(text, Math.max(0, offset - 24))
              if (near >= 0 && Math.abs(near - offset) <= 32) at = near
            }
          }
          if (at < 0) at = content.indexOf(text)
          if (at < 0 && text.length > 240) at = content.indexOf(text.slice(0, 240))
          if (at < 0) continue
          const end = Math.min(content.length, at + text.length)
          const range = rangeFromOffsets(source, at, end)
          if (range === null) continue
          const prefixOk = bookmark.prefix === undefined
            || content.slice(Math.max(0, at - bookmark.prefix.length), at) === bookmark.prefix
          const suffixOk = bookmark.suffix === undefined
            || content.slice(end, end + bookmark.suffix.length) === bookmark.suffix
          const score = (prefixOk ? 2 : 0) + (suffixOk ? 1 : 0)
          if (best === null || score > best.score) best = { range, source, score }
          if (score === 3) break
        }
        return best
      }

      /**
       * Last-resort text search across the rendered window. A collapsed
       * reasoning preview can be replaced by its full body, and the selected
       * sentence may live in a sibling final-answer seat; score by the saved
       * seat/turn and surrounding words instead of taking the first match.
       */
      function locateAnyRange(bookmark) {
        const text = typeof bookmark.text === 'string' ? bookmark.text : ''
        if (text === '') return null
        const needle = text.length > 240 ? text.slice(0, 240) : text
        let best = null
        for (const source of document.querySelectorAll('[data-text-interaction-source]')) {
          const content = source.textContent ?? ''
          const at = content.indexOf(needle)
          if (at < 0) continue
          const end = Math.min(content.length, at + text.length)
          const range = rangeFromOffsets(source, at, end)
          if (range === null) continue
          const seat = source.closest('[data-chat-node-key], [data-chat-turn]')
          const seatKey = seat?.getAttribute('data-chat-node-key')
          const turn = seat?.getAttribute('data-chat-turn')
          let score = 0
          if (bookmark.sourceHash !== undefined
            && textHash(content) === bookmark.sourceHash
            && (bookmark.sourceLength === undefined || content.length === bookmark.sourceLength)) score += 16
          if (seatKey !== undefined && seatKey === bookmark.nodeKey) score += 8
          else if (turn !== undefined && bookmark.turn !== undefined && turn === String(bookmark.turn)) score += 4
          if (bookmark.prefix !== undefined
            && content.slice(Math.max(0, at - bookmark.prefix.length), at) === bookmark.prefix) score += 2
          if (bookmark.suffix !== undefined
            && content.slice(end, end + bookmark.suffix.length) === bookmark.suffix) score += 1
          if (score > 0 && (best === null || score > best.score)) best = { range, source, score }
          if (best !== null && best.score >= 16) break
        }
        return best
      }

      /** Scroll the first line of a Range into the middle of its viewport. */
      function revealRange(range) {
        const node = range.startContainer
        const element = node instanceof Element ? node : node.parentElement
        if (element === null) return false
        try {
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
          const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) return false
          let scroller = element
          while (scroller !== null && scroller !== document.body) {
            const style = getComputedStyle(scroller)
            if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 4) break
            scroller = scroller.parentElement
          }
          if (scroller === null || scroller === document.body || scroller === document.documentElement) return true
          const box = scroller.getBoundingClientRect()
          const top = scroller.scrollTop + rect.top - box.top - (scroller.clientHeight - rect.height) / 2
          scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
          return true
        } catch (_error) {
          return false
        }
      }

      function flashSeat(seat, generation) {
        try {
          seat.scrollIntoView({ block: 'center', behavior: 'auto' })
          seat.classList.add('sw-bookmark-jump')
          window.setTimeout(() => {
            if (generation !== jumpGeneration) return
            for (const element of document.querySelectorAll('.sw-bookmark-jump')) element.classList.remove('sw-bookmark-jump')
          }, 2600)
        } catch (_error) { /* a detached seat is not worth surfacing */ }
      }

      /**
       * The yellow box locator: fixed rectangles over the exact Range (or the
       * message when the words are unavailable), following scroll. No label,
       * badge, or close control is attached; it clears itself after 12s.
       */
      function createLocator(generation) {
        const layer = document.createElement('div')
        layer.className = 'sw-jump-locator'
        const boxes = []
        for (let index = 0; index < 24; index += 1) {
          const box = document.createElement('div')
          box.className = 'sw-jump-locator-box'
          box.hidden = true
          layer.appendChild(box)
          boxes.push(box)
        }
        layer.hidden = true
        document.body.appendChild(layer)

        let range = null
        let seat = null
        let closed = false
        let timer = 0
        let locator = null

        const close = () => {
          if (closed) return
          closed = true
          window.clearTimeout(timer)
          window.removeEventListener('scroll', update, true)
          window.removeEventListener('resize', update)
          layer.remove()
          if (activeLocator === locator) activeLocator = null
        }

        const update = () => {
          if (closed) return
          if (disposed || generation !== jumpGeneration) {
            close()
            return
          }
          let rects = []
          if (range !== null && range.startContainer.isConnected) {
            rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
          }
          if (rects.length === 0 && seat !== null && seat.isConnected) {
            const rect = seat.getBoundingClientRect()
            if (rect.width > 0 || rect.height > 0) rects = [rect]
          }
          if (rects.length === 0) {
            layer.hidden = true
            return
          }
          layer.hidden = false
          boxes.forEach((box, index) => {
            const rect = rects[index]
            if (rect === undefined) {
              box.hidden = true
              return
            }
            box.hidden = false
            box.style.left = `${Math.round(rect.left - 2)}px`
            box.style.top = `${Math.round(rect.top - 2)}px`
            box.style.width = `${Math.round(rect.width + 4)}px`
            box.style.height = `${Math.round(rect.height + 4)}px`
          })
        }

        locator = {
          render(nextRange, nextSeat) {
            if (closed) return
            if (nextRange !== null) range = nextRange
            if (nextSeat !== null) seat = nextSeat
            update()
          },
          close,
        }

        window.addEventListener('scroll', update, true)
        window.addEventListener('resize', update)
        timer = window.setTimeout(close, 12000)
        return locator
      }

      async function performJump(bookmark, generation) {
        if (disposed || generation !== jumpGeneration) return
        if (bookmark.turn === undefined && bookmark.seq === undefined && bookmark.nodeKey === undefined
          && (typeof bookmark.text !== 'string' || bookmark.text.trim() === '')) return
        const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
        const alive = () => !disposed && generation === jumpGeneration

        let binding
        for (let attempt = 0; attempt < 40 && alive() && binding === undefined; attempt += 1) {
          binding = ctx.sessions.binding(bookmark.sessionId)
          if (binding === undefined) await wait(100)
        }
        if (binding === undefined || !alive()) return

        if (bookmark.seq !== undefined) {
          try {
            // A failed paging request leaves the current window in place.
            await Promise.race([binding.session.loadThrough(bookmark.seq), wait(8000)])
          } catch (_error) { /* keep the jump best-effort */ }
          if (!alive()) return
        }

        let seat = null
        for (let attempt = 0; attempt < 60 && alive() && seat === null; attempt += 1) {
          seat = findJumpSeat(bookmark) ?? findTextSeat(bookmark)
          if (seat === null) await wait(100)
        }
        if (seat === null || !alive()) return

        // Past Turns render their process/reasoning layers collapsed. The
        // target seat stays in the DOM but its text source does not exist until
        // the three disclosure levels are opened; do that before locating.
        for (let attempt = 0; attempt < 4 && alive(); attempt += 1) {
          const current = findJumpSeat(bookmark) ?? seat
          if (current.closest('[hidden]') === null && current.querySelector('[data-text-interaction-source]') !== null) break
          expandSeat(current)
          await wait(140)
        }
        seat = findJumpSeat(bookmark) ?? seat
        if (!alive()) return

        try {
          activeLocator = createLocator(generation)
        } catch (_error) {
          activeLocator = null
        }
        for (const element of document.querySelectorAll('.sw-bookmark-jump')) element.classList.remove('sw-bookmark-jump')
        const paint = (targetSeat) => {
          let located = locateRange(bookmark, targetSeat)
          if (located === null) located = locateAnyRange(bookmark)
          if (located !== null) {
            const revealed = revealRange(located.range)
            if (activeLocator !== null) {
              activeLocator.render(revealed ? located.range : null, targetSeat)
              return true
            }
            flashSeat(targetSeat, generation)
            return true
          }
          if (activeLocator !== null) {
            activeLocator.render(null, targetSeat)
            return true
          }
          flashSeat(targetSeat, generation)
          return true
        }

        paint(seat)
        // The view's own position restoration and the expansion layout can
        // settle over several frames; re-center the live range more than once.
        for (const delay of [260, 700, 1200]) {
          window.setTimeout(() => {
            if (!alive()) return
            const current = findJumpSeat(bookmark) ?? findTextSeat(bookmark)
            if (current !== null) paint(current)
          }, delay)
        }
      }

      bridge.jumpToBookmark = (bookmark) => {
        if (bridge.isArchived(bookmark.sessionId)) return false
        activeLocator?.close()
        activeLocator = null
        const generation = ++jumpGeneration
        try {
          ctx.uiWorkspace.openSession(bookmark.sessionId)
        } catch (_error) {
          return false
        }
        void performJump(bookmark, generation)
        return true
      }

      // Quote owns the selection surface in this composition; replacing that
      // keyed entry keeps its Quote action and adds Bookmark to the same pill.
      // The context-menu trigger is a second way in when Quote declines.
      ctx.effect(() => ctx.uiConversation.interactions.register({
        id: BOOKMARK_INTERACTION_ID,
        onInteraction(request) {
          const text = request.readText()
          if (text === null || text.trim() === '') return
          const quoteOwnsGesture = bridge.quoteAvailable() && bridge.quoteEligible(request.sessionId)
          // A normal Session keeps its native context menu (Copy and friends);
          // Quote already offers the floating pill there. The bookmark-only
          // surface is the fallback where Quote declines.
          if (request.trigger === 'contextmenu') {
            if (quoteOwnsGesture) return
            request.preventDefault()
            request.open()
            return
          }
          if (quoteOwnsGesture) return
          request.open()
        },
      }), 'sticky-wall: selection interaction')

      const surfaceInject = () => ({ addBookmark: bridge.addBookmark, quoteAvailable: bridge.quoteAvailable })
      ctx.slots.inject('conversation.chat.text-interaction', () => [
        ctx.slots.register({ name: 'conversation.chat.text-interaction', key: BOOKMARK_INTERACTION_ID, locale: NS, inject: surfaceInject }, SelectionSurface),
        ctx.slots.register({ name: 'conversation.chat.text-interaction', key: QUOTE_INTERACTION_ID, priority: -1000, locale: NS, inject: surfaceInject }, SelectionSurface),
      ])

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, StickyWallIcon),
      )

      const Page = (props) => h(StickyWallPage, { ...props, bridge })
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Page))
    }

    return { inject, apply }
  },
})
