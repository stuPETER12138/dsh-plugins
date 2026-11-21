/**
 * Agent Memory — the browser half of `@local/dsh-agent-memory`.
 *
 * One page with three panes over the same Host store:
 *   core     the standing profile, injected first when memory is recalled
 *   records  individual facts, tagged kind × subject, searchable by the agent
 *   pending  derived merge / conflict proposals a human has to settle
 *
 * Nothing is injected by default: the agent receives memory only after the user
 * types `/memory <query>`, and only for the next request. This page is the
 * editor for what that command can find.
 *
 * Bundle format: the client module system executes only the factory below and
 * materializes it lazily. React comes from the platform module table, so this
 * file requires nothing else and declares no `dsh.client.external`.
 *
 * @module @local/dsh-agent-memory/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-agent-memory',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const NS = 'agentMemory'
    const PANEL_ID = 'agent-memory'
    const ROUTE = '/dsh-agent-memory'

    const STRINGS = {
      zh: {
        panel: '记忆',
        title: '长期记忆',
        lede: '跨会话记住你是谁、一起做过什么、约定怎么做事。默认不进上下文；用 /memory <要回忆的内容> 调取，下一条消息带上。',
        refresh: '重新读取',
        tabCore: '常驻画像',
        tabRecords: '记录',
        tabPending: '待确认',
        coreTitle: '常驻画像',
        coreDesc: '散文，写身份、硬约束和长期偏好。调取记忆时永远排在最前，所以写短一点。',
        corePlaceholder: '例如：先给结论，再给理由；我习惯 PowerShell，别给我 bash 版本。',
        recordsTitle: '记忆记录',
        recordsDesc: '一条一个事实，标上它是什么类型（kind）和是谁的事（subject）。检索按这两条轴过滤，所以同一条事实不需要存两遍。',
        pendingTitle: '待确认',
        pendingDesc: '同类型、同归属、内容高度相似的记录。合并建议只是建议，删除永远由你点。',
        pendingEmpty: '没有需要确认的内容。',
        pendingMerged: '已合并，较短的条目已删除。',
        pendingKept: '已保留两条，这一对不再提示。',
        emptyRecords: '还没有记录。先写一条最影响回答的。',
        emptyFiltered: '这个筛选下没有记录。',
        add: '新增记录',
        save: '保存',
        saving: '保存中…',
        cancel: '取消',
        edit: '编辑',
        remove: '删除',
        confirmRemove: '再点一次删除',
        discard: '放弃修改',
        saved: '已保存',
        unsaved: '有未保存的修改',
        charsUnit: '字',
        loading: '正在读取记忆…',
        loadFailed: '读不到记忆',
        retry: '重试',
        saveFailed: '保存失败',
        tooLong: '内容超过上限',
        overLimit: '已超过上限',
        nearLimit: '接近上限',
        kindLabel: '类型',
        subjectLabel: '归属',
        importanceLabel: '重要性',
        probeLabel: '验证命令',
        probeHint: '可选。填一条本机命令，注入时会提示 agent 可以运行它来确认。',
        textLabel: '内容',
        filterAll: '全部',
        simLabel: '相似度',
        mergeLabel: '几乎重复',
        conflictLabel: '需要确认',
        mergeAction: '合并（保留信息更多的一条）',
        keepBoth: '保留两条，不再提示',
        truncated: '记录太多，已跳过相似度扫描。',
        stagedOne: '已调取 {n} 条记忆，将在下一条消息中送达。',
        stagedDone: '上次调取的内容已送达。',
        kindSemantic: '语义',
        kindEpisodic: '情节',
        kindProcedural: '过程',
        subjectMe: '我',
        subjectMachine: '机器',
        subjectProject: '项目',
        recordPlaceholder: '一条事实，尽量一句话写完。',
        disabled: '已停用',
        location: '文件位置',
        fileHint: 'core.md 与 records.jsonl，纯文本，可以直接用编辑器改；改完点「重新读取」。',
        injectedHint: '调用方式：/memory <要回忆的内容>；/memory clear 清空。',
      },
      en: {
        panel: 'Memory',
        title: 'Long-term memory',
        lede: 'Remembered across sessions. Nothing is injected by default: type /memory <what to recall> and the next message carries it.',
        refresh: 'Reload',
        tabCore: 'Profile',
        tabRecords: 'Records',
        tabPending: 'Review',
        coreTitle: 'Standing profile',
        coreDesc: 'Prose: identity, hard constraints, long-lived preferences. Always first when memory is recalled, so keep it short.',
        corePlaceholder: 'For example: conclusion first, then reasons. I use PowerShell — no bash equivalents.',
        recordsTitle: 'Records',
        recordsDesc: 'One fact per record, tagged with what kind of claim it is and whose fact it is. Retrieval filters on both axes, so one fact never needs two copies.',
        pendingTitle: 'Review',
        pendingDesc: 'Same kind, same subject, highly similar text. A merge is a suggestion; deleting is always your click.',
        pendingEmpty: 'Nothing to review.',
        pendingMerged: 'Merged; the shorter record was removed.',
        pendingKept: 'Both kept; this pair will not ask again.',
        emptyRecords: 'No records yet. Start with the one that changes answers most.',
        emptyFiltered: 'No records match this filter.',
        add: 'New record',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        edit: 'Edit',
        remove: 'Delete',
        confirmRemove: 'Click again to delete',
        discard: 'Discard',
        saved: 'Saved',
        unsaved: 'Unsaved changes',
        charsUnit: 'chars',
        loading: 'Loading memory…',
        loadFailed: 'Cannot read memory',
        retry: 'Retry',
        saveFailed: 'Could not save',
        tooLong: 'Longer than the limit',
        overLimit: 'Over limit',
        nearLimit: 'Near limit',
        kindLabel: 'Kind',
        subjectLabel: 'Subject',
        importanceLabel: 'Importance',
        probeLabel: 'Verify command',
        probeHint: 'Optional. A local command the agent may run to confirm this fact before using it.',
        textLabel: 'Text',
        filterAll: 'All',
        simLabel: 'similarity',
        mergeLabel: 'Near duplicate',
        conflictLabel: 'Needs a look',
        mergeAction: 'Merge, keep the richer one',
        keepBoth: 'Keep both, stop asking',
        truncated: 'Store is large; similarity scan skipped.',
        stagedOne: '{n} records recalled, arriving with the next message.',
        stagedDone: 'The recalled records have been delivered.',
        kindSemantic: 'semantic',
        kindEpisodic: 'episodic',
        kindProcedural: 'procedural',
        subjectMe: 'me',
        subjectMachine: 'machine',
        subjectProject: 'project',
        recordPlaceholder: 'One fact, one sentence if it fits.',
        disabled: 'disabled',
        location: 'Files',
        fileHint: 'core.md and records.jsonl are plain text you can edit directly; then hit Reload.',
        injectedHint: 'Recall with /memory <what to recall>; clear with /memory clear.',
      },
    }

    /** `t()` bound to a language, or Chinese when the slot passes no translator. */
    function makeT(t) {
      if (typeof t === 'function') return t
      return (key) => STRINGS.zh[key] ?? key
    }

    // ── HTTP ───────────────────────────────────────────────────────────────

    async function readJson(response) {
      if (!response.ok) {
        let message = 'HTTP ' + response.status
        let code = null
        try {
          const body = await response.json()
          if (typeof body?.error?.message === 'string') message = body.error.message
          if (typeof body?.error?.code === 'string') code = body.error.code
        } catch (_error) {
          /* a body that is not JSON keeps the status text */
        }
        const failure = new Error(message)
        failure.code = code
        throw failure
      }
      return response.json()
    }

    async function fetchJson(url) {
      return readJson(await fetch(url, { headers: { accept: 'application/json' } }))
    }

    async function postJson(url, payload) {
      return readJson(
        await fetch(url, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      )
    }

    function formatNumber(value) {
      return new Intl.NumberFormat().format(value)
    }

    function formatTime(time) {
      if (!Number.isFinite(time) || time <= 0) return ''
      try {
        return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } catch (_error) {
        return ''
      }
    }

    // ── shared bits ────────────────────────────────────────────────────────

    function Chips({ t, items, value, onChange, label }) {
      return h(
        'div',
        { className: 'am-chips', role: 'group', 'aria-label': label },
        h(
          'button',
          {
            type: 'button',
            className: 'am-chip' + (value === 'all' ? ' is-active' : ''),
            onClick: () => onChange('all'),
            'aria-pressed': value === 'all',
          },
          t('filterAll'),
        ),
        items.map((item) =>
          h(
            'button',
            {
              key: item.key,
              type: 'button',
              className: 'am-chip' + (value === item.key ? ' is-active' : ''),
              onClick: () => onChange(item.key),
              'aria-pressed': value === item.key,
            },
            item.label,
          ),
        ),
      )
    }

    /** Small labelled select used by the record forms. */
    function Select({ label, value, options, onChange, disabled }) {
      return h(
        'label',
        { className: 'am-field' },
        h('span', { className: 'am-field-label' }, label),
        h(
          'select',
          { className: 'am-select', value, disabled: disabled === true, onChange: (event) => onChange(event.target.value) },
          options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
        ),
      )
    }

    /** Add/edit form shared by both workflows. */
    function RecordForm({ t, draft, maxChars, busy, onChange, onSubmit, onCancel, submitLabel }) {
      const length = draft.text.length
      const over = length > maxChars
      return h(
        'div',
        { className: 'am-form' },
        h(
          'div',
          { className: 'am-form-controls' },
          h(Select, {
            label: t('kindLabel'),
            value: draft.kind,
            onChange: (value) => onChange({ ...draft, kind: value }),
            options: [
              { value: 'semantic', label: t('kindSemantic') },
              { value: 'episodic', label: t('kindEpisodic') },
              { value: 'procedural', label: t('kindProcedural') },
            ],
            disabled: busy,
          }),
          h(Select, {
            label: t('subjectLabel'),
            value: draft.subject,
            onChange: (value) => onChange({ ...draft, subject: value }),
            options: [
              { value: 'me', label: t('subjectMe') },
              { value: 'machine', label: t('subjectMachine') },
              { value: 'project', label: t('subjectProject') },
            ],
            disabled: busy,
          }),
          h(Select, {
            label: t('importanceLabel'),
            value: String(draft.importance),
            onChange: (value) => onChange({ ...draft, importance: Number(value) }),
            options: [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) })),
            disabled: busy,
          }),
        ),
        h('textarea', {
          className: 'am-textarea' + (over ? ' is-over' : ''),
          value: draft.text,
          rows: 3,
          spellCheck: false,
          placeholder: t('recordPlaceholder'),
          'aria-label': t('textLabel'),
          onChange: (event) => onChange({ ...draft, text: event.target.value }),
          onKeyDown: (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }
          },
        }),
        h(
          'label',
          { className: 'am-field am-field-wide' },
          h('span', { className: 'am-field-label' }, t('probeLabel')),
          h('input', {
            className: 'am-input',
            value: draft.probe,
            placeholder: t('probeHint'),
            onChange: (event) => onChange({ ...draft, probe: event.target.value }),
          }),
        ),
        h(
          'div',
          { className: 'am-form-foot' },
          h(
            'span',
            { className: 'am-meta' + (over ? ' is-warn' : '') },
            formatNumber(length) + ' ' + t('charsUnit'),
            over ? ' · ' + t('overLimit') + ' ' + formatNumber(maxChars) : '',
          ),
          h(
            'div',
            { className: 'am-card-actions' },
            h('button', { type: 'button', className: 'am-button', onClick: onCancel, disabled: busy }, t('cancel')),
            h(
              'button',
              {
                type: 'button',
                className: 'am-button am-button-primary',
                onClick: onSubmit,
                disabled: busy || over || draft.text.trim() === '',
              },
              busy ? t('saving') : submitLabel,
            ),
          ),
        ),
      )
    }

    // ── panes ──────────────────────────────────────────────────────────────

    function CorePane({ t, data, busy, draft, onChange, onSave }) {
      const dirty = draft !== data.core.text
      const over = draft.length > data.maxChars
      const time = formatTime(data.core.updatedAt)
      return h(
        'section',
        { className: 'am-card' },
        h(
          'div',
          { className: 'am-card-head' },
          h('h2', { className: 'am-card-title' }, t('coreTitle')),
          h('span', { className: 'am-card-tag' }, dirty ? t('unsaved') : time === '' ? t('saved') : t('saved') + ' · ' + time),
        ),
        h('p', { className: 'am-card-desc' }, t('coreDesc')),
        h('textarea', {
          className: 'am-textarea am-textarea-tall' + (over ? ' is-over' : ''),
          value: draft,
          rows: 8,
          spellCheck: false,
          placeholder: t('corePlaceholder'),
          'aria-label': t('coreTitle'),
          onChange: (event) => onChange(event.target.value),
          onKeyDown: (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              if (dirty && !over) onSave(draft)
            }
          },
        }),
        h(
          'div',
          { className: 'am-card-foot' },
          h(
            'span',
            { className: 'am-meta' + (over ? ' is-warn' : '') },
            formatNumber(draft.length) + ' ' + t('charsUnit'),
            over ? ' · ' + t('overLimit') + ' ' + formatNumber(data.maxChars) : '',
          ),
          h(
            'div',
            { className: 'am-card-actions' },
            dirty
              ? h('button', { type: 'button', className: 'am-button', onClick: () => onChange(null), disabled: busy }, t('discard'))
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'am-button am-button-primary',
                disabled: !dirty || busy || over,
                onClick: () => onSave(draft),
              },
              busy ? t('saving') : t('save'),
            ),
          ),
        ),
      )
    }

    function RecordRow({ t, record, busy, onEdit, onRemove }) {
      const [armed, setArmed] = useState(false)
      return h(
        'div',
        { className: 'am-row' },
        h(
          'div',
          { className: 'am-row-head' },
          h('span', { className: 'am-tag' }, t(record.kind === 'semantic' ? 'kindSemantic' : record.kind === 'episodic' ? 'kindEpisodic' : 'kindProcedural')),
          h('span', { className: 'am-tag' }, t(record.subject === 'me' ? 'subjectMe' : record.subject === 'machine' ? 'subjectMachine' : 'subjectProject')),
          h('span', { className: 'am-row-day' }, record.day),
          record.usable ? null : h('span', { className: 'am-tag is-muted' }, t('disabled')),
        ),
        h('p', { className: 'am-row-text' }, record.text),
        record.probe === null
          ? null
          : h('code', { className: 'am-row-probe' }, record.probe),
        h(
          'div',
          { className: 'am-row-actions' },
          h('button', { type: 'button', className: 'am-button', onClick: () => onEdit(record), disabled: busy }, t('edit')),
          h(
            'button',
            {
              type: 'button',
              className: 'am-button' + (armed ? ' am-button-danger' : ''),
              disabled: busy,
              onClick: () => {
                if (!armed) {
                  setArmed(true)
                  return
                }
                onRemove(record)
              },
              onBlur: () => setArmed(false),
            },
            armed ? t('confirmRemove') : t('remove'),
          ),
        ),
      )
    }

    function RecordsPane({ t, data, busy, onCreate, onUpdate, onRemove }) {
      const [kind, setKind] = useState('all')
      const [subject, setSubject] = useState('all')
      const [editingId, setEditingId] = useState(null)
      const [draft, setDraft] = useState(null)
      const [creating, setCreating] = useState(false)

      const visible = useMemo(
        () =>
          data.records.filter(
            (record) => (kind === 'all' || record.kind === kind) && (subject === 'all' || record.subject === subject),
          ),
        [data.records, kind, subject],
      )

      const blank = { kind: kind === 'all' ? 'semantic' : kind, subject: subject === 'all' ? 'me' : subject, text: '', probe: '', importance: 3 }

      return h(
        'div',
        { className: 'am-pane' },
        h('p', { className: 'am-card-desc' }, t('recordsDesc')),
        h(
          'div',
          { className: 'am-filters' },
          h(Chips, {
            t,
            label: t('kindLabel'),
            value: kind,
            onChange: setKind,
            items: [
              { key: 'semantic', label: t('kindSemantic') },
              { key: 'episodic', label: t('kindEpisodic') },
              { key: 'procedural', label: t('kindProcedural') },
            ],
          }),
          h(Chips, {
            t,
            label: t('subjectLabel'),
            value: subject,
            onChange: setSubject,
            items: [
              { key: 'me', label: t('subjectMe') },
              { key: 'machine', label: t('subjectMachine') },
              { key: 'project', label: t('subjectProject') },
            ],
          }),
        ),
        creating
          ? h(RecordForm, {
              t,
              draft: draft ?? blank,
              maxChars: data.maxChars,
              busy,
              onChange: setDraft,
              submitLabel: t('save'),
              onCancel: () => {
                setCreating(false)
                setDraft(null)
              },
              onSubmit: async () => {
                if (draft === null) return
                // Keep the form open when the write fails, so a typed record is
                // never lost to a transient error.
                const saved = await onCreate(draft)
                if (saved === true) {
                  setCreating(false)
                  setDraft(null)
                }
              },
            })
          : h(
              'button',
              {
                type: 'button',
                className: 'am-button am-button-primary am-add',
                disabled: busy,
                onClick: () => {
                  setCreating(true)
                  setDraft(blank)
                },
              },
              t('add'),
            ),
        visible.length === 0
          ? h('p', { className: 'am-empty' }, data.records.length === 0 ? t('emptyRecords') : t('emptyFiltered'))
          : h(
              'div',
              { className: 'am-rows' },
              visible.map((record) =>
                editingId === record.id && draft !== null
                  ? h(
                      'div',
                      { key: record.id, className: 'am-row is-editing' },
                      h(RecordForm, {
                        t,
                        draft,
                        maxChars: data.maxChars,
                        busy,
                        onChange: setDraft,
                        submitLabel: t('save'),
                        onCancel: () => {
                          setEditingId(null)
                          setDraft(null)
                        },
                        onSubmit: async () => {
                          const saved = await onUpdate(record.id, draft)
                          if (saved === true) {
                            setEditingId(null)
                            setDraft(null)
                          }
                        },
                      }),
                    )
                  : h(RecordRow, {
                      key: record.id,
                      t,
                      record,
                      busy,
                      onEdit: (target) => {
                        setEditingId(target.id)
                        setDraft({
                          kind: target.kind,
                          subject: target.subject,
                          text: target.text,
                          probe: target.probe ?? '',
                          importance: target.importance,
                        })
                      },
                      onRemove: (target) => onRemove(target.id),
                    }),
              ),
            ),
      )
    }

    function PendingPane({ t, data, busy, onMerge, onDismiss }) {
      if (data.proposals.length === 0) {
        return h(
          'div',
          { className: 'am-pane' },
          h('p', { className: 'am-card-desc' }, t('pendingDesc')),
          data.proposalsTruncated ? h('p', { className: 'am-meta is-warn' }, t('truncated')) : null,
          h('p', { className: 'am-empty' }, t('pendingEmpty')),
        )
      }
      return h(
        'div',
        { className: 'am-pane' },
        h('p', { className: 'am-card-desc' }, t('pendingDesc')),
        data.proposalsTruncated ? h('p', { className: 'am-meta is-warn' }, t('truncated')) : null,
        data.proposals.map((proposal) =>
          h(
            'section',
            { key: proposal.a.id + '|' + proposal.b.id, className: 'am-card am-proposal' },
            h(
              'div',
              { className: 'am-card-head' },
              h('h2', { className: 'am-card-title' }, proposal.type === 'merge' ? t('mergeLabel') : t('conflictLabel')),
              h('span', { className: 'am-card-tag' }, t('simLabel') + ' ' + proposal.similarity),
            ),
            h(
              'div',
              { className: 'am-pair' },
              h('p', { className: 'am-row-text' }, proposal.a.text),
              h('p', { className: 'am-row-text' }, proposal.b.text),
            ),
            h(
              'div',
              { className: 'am-row-actions' },
              h(
                'button',
                { type: 'button', className: 'am-button', disabled: busy, onClick: () => onDismiss(proposal) },
                t('keepBoth'),
              ),
              h(
                'button',
                { type: 'button', className: 'am-button am-button-primary', disabled: busy, onClick: () => onMerge(proposal) },
                t('mergeAction'),
              ),
            ),
          ),
        ),
      )
    }

    // ── page ───────────────────────────────────────────────────────────────

    function MemoryPage(props) {
      const t = makeT(props?.t)
      const [status, setStatus] = useState('loading')
      const [loadError, setLoadError] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [data, setData] = useState({ dir: '', maxChars: 8000, core: { text: '', updatedAt: null }, records: [], proposals: [], proposalsTruncated: false, staged: [] })
      const [tab, setTab] = useState('core')
      /** `null` means "show what is on disk"; typing sets a draft string. */
      const [coreDraft, setCoreDraft] = useState(null)

      const load = useCallback(async (quiet) => {
        if (quiet !== true) setStatus('loading')
        setLoadError(null)
        try {
          const payload = await fetchJson(ROUTE)
          setData({
            dir: typeof payload?.dir === 'string' ? payload.dir : '',
            maxChars: Number.isFinite(payload?.maxChars) ? payload.maxChars : 8000,
            core: {
              text: typeof payload?.core?.text === 'string' ? payload.core.text : '',
              updatedAt: Number.isFinite(payload?.core?.updatedAt) ? payload.core.updatedAt : null,
            },
            records: Array.isArray(payload?.records) ? payload.records : [],
            proposals: Array.isArray(payload?.proposals) ? payload.proposals : [],
            proposalsTruncated: payload?.proposalsTruncated === true,
            staged: Array.isArray(payload?.staged) ? payload.staged : [],
          })
          setStatus('ready')
        } catch (failure) {
          setLoadError(failure instanceof Error ? failure.message : String(failure))
          if (quiet !== true) setStatus('error')
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const run = useCallback(
        async (body) => {
          setBusy(true)
          setError(null)
          try {
            await postJson(ROUTE, body)
            await load(true)
            return true
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
            return false
          } finally {
            setBusy(false)
          }
        },
        [load],
      )

      const pending = data.proposals.length
      const coreText = coreDraft === null ? data.core.text : coreDraft
      const tabs = useMemo(
        () => [
          { key: 'core', label: t('tabCore'), count: null },
          { key: 'records', label: t('tabRecords'), count: data.records.length },
          { key: 'pending', label: t('tabPending'), count: pending },
        ],
        [t, data.records.length, pending],
      )

      if (status === 'loading') {
        return h(
          'section',
          { className: 'am-page' },
          h('div', { className: 'am-scroll' }, h('div', { className: 'am-content' }, h('p', { className: 'am-placeholder' }, t('loading')))),
        )
      }

      if (status === 'error') {
        return h(
          'section',
          { className: 'am-page' },
          h(
            'div',
            { className: 'am-scroll' },
            h(
              'div',
              { className: 'am-content' },
              h('h1', { className: 'am-title' }, t('title')),
              h('p', { className: 'am-placeholder is-error', role: 'alert' }, t('loadFailed') + ': ' + (loadError ?? '')),
              h('button', { type: 'button', className: 'am-button', onClick: () => void load() }, t('retry')),
            ),
          ),
        )
      }

      const staged = data.staged.find((entry) => entry.delivered === false)

      return h(
        'section',
        { className: 'am-page' },
        h(
          'div',
          { className: 'am-scroll' },
          h(
            'div',
            { className: 'am-content' },
            h(
              'header',
              { className: 'am-head' },
              h(
                'div',
                { className: 'am-head-text' },
                h('h1', { className: 'am-title' }, t('title')),
                h('p', { className: 'am-lede' }, t('lede')),
              ),
              h(
                'div',
                { className: 'am-head-tools' },
                h('span', { className: 'am-total' }, t('injectedHint')),
                h('button', { type: 'button', className: 'am-button', onClick: () => void load(), disabled: busy }, t('refresh')),
              ),
            ),
            staged === undefined
              ? null
              : h('div', { className: 'am-staged' }, t('stagedOne').replace('{n}', String(staged.count))),
            error === null ? null : h('p', { className: 'am-error', role: 'alert' }, t('saveFailed') + ': ' + error),
            h(
              'div',
              { className: 'am-tabbar', role: 'tablist' },
              tabs.map((entry) =>
                h(
                  'button',
                  {
                    key: entry.key,
                    type: 'button',
                    role: 'tab',
                    'aria-selected': tab === entry.key,
                    className: 'am-tab' + (tab === entry.key ? ' is-active' : ''),
                    onClick: () => setTab(entry.key),
                  },
                  entry.label,
                  entry.count === null || entry.count === 0
                    ? null
                    : h('span', { className: 'am-tab-count' }, formatNumber(entry.count)),
                ),
              ),
            ),
            tab === 'core'
              ? h(CorePane, {
                  t,
                  data,
                  busy,
                  draft: coreText,
                  onChange: (value) => setCoreDraft(value),
                  onSave: async (text) => {
                    const saved = await run({ action: 'core.set', text })
                    if (saved === true) setCoreDraft(null)
                  },
                })
              : tab === 'records'
                ? h(RecordsPane, {
                    t,
                    data,
                    busy,
                    onCreate: (draft) =>
                      run({
                        action: 'record.create',
                        record: { kind: draft.kind, subject: draft.subject, text: draft.text, probe: draft.probe, importance: draft.importance },
                      }),
                    onUpdate: (id, patch) => run({ action: 'record.update', id, patch }),
                    onRemove: (id) => void run({ action: 'record.delete', id }),
                  })
                : h(PendingPane, {
                    t,
                    data,
                    busy,
                    onMerge: (proposal) => void run({ action: 'proposal.merge', a: proposal.a.id, b: proposal.b.id }),
                    onDismiss: (proposal) => void run({ action: 'proposal.dismiss', a: proposal.a.id, b: proposal.b.id }),
                  }),
            h(
              'footer',
              { className: 'am-foot' },
              h('span', { className: 'am-foot-label' }, t('location')),
              h('code', { className: 'am-path' }, data.dir),
              h('span', { className: 'am-foot-hint' }, t('fileHint')),
            ),
          ),
        ),
      )
    }

    // ── icon ───────────────────────────────────────────────────────────────

    /** Sidebar glyph: three stacked layers, one per memory kind. */
    function MemoryIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', strokeLinecap: 'round' }
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', { d: 'M8 1.5 14.3 4.2 8 6.9 1.7 4.2z', ...line }),
        h('path', { d: 'M1.7 7.7 8 10.4 14.3 7.7', ...line, opacity: 0.85 }),
        h('path', { d: 'M1.7 11 8 13.7 14.3 11', ...line, opacity: 0.65 }),
      )
    }

    // ── styles ─────────────────────────────────────────────────────────────

    const STYLES = `
.am-page{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:1.6}
.am-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.am-content{max-width:840px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 64px}
.am-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;padding-top:30px;margin-bottom:14px}
[data-platform=darwin] .am-head{padding-top:calc(30px + var(--dsh-frame-top-clearance,0px))}
.am-head-text{min-width:260px;flex:1}
.am-title{margin:0;font-size:22px;font-weight:600;line-height:30px;letter-spacing:-.01em}
.am-lede{max-width:56ch;margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.am-head-tools{display:flex;align-items:center;gap:10px}
.am-total{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.am-staged{display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:18px}
.am-tabbar{display:flex;align-items:center;gap:2px;margin:6px 0 18px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.am-tab{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;cursor:pointer;transition:color .15s,border-color .15s}
.am-tab:hover{color:var(--dsw-alias-label-primary)}
.am-tab.is-active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}
.am-tab-count{color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.am-pane{display:flex;flex-direction:column;gap:14px}
.am-card{padding:14px 16px 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.am-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:2px}
.am-card-title{margin:0;font-size:15px;font-weight:600;line-height:22px}
.am-card-tag{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.am-card-desc{margin:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}
.am-textarea{display:block;width:100%;min-height:88px;max-height:380px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;line-height:21px;resize:vertical;field-sizing:content;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.am-textarea-tall{min-height:160px}
.am-textarea::placeholder{color:var(--dsw-alias-label-caption)}
.am-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.am-textarea.is-over{border-color:var(--dsw-alias-state-error-primary)}
.am-input{display:block;width:100%;height:30px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.am-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.am-input::placeholder{color:var(--dsw-alias-label-caption)}
.am-select{height:30px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.am-field{display:flex;flex-direction:column;gap:4px;min-width:96px}
.am-field-wide{flex:1;min-width:100%}
.am-field-label{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.am-form{display:flex;flex-direction:column;gap:10px;padding:12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.am-form-controls{display:flex;flex-wrap:wrap;gap:10px}
.am-form-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.am-card-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:9px}
.am-meta{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.am-meta.is-warn{color:var(--dsw-alias-state-error-primary)}
.am-card-actions{display:flex;align-items:center;gap:10px}
.am-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;padding:0 11px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.am-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.am-button:disabled{opacity:.5;cursor:default}
.am-button-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.am-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.am-button-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.am-add{align-self:flex-start}
.am-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.am-chip{height:24px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.am-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4)}
.am-chip.is-active{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary)}
.am-filters{display:flex;flex-direction:column;gap:8px}
.am-rows{display:flex;flex-direction:column;gap:2px;border-top:.5px solid var(--dsw-alias-border-l2)}
.am-row{padding:12px 2px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.am-row.is-editing{padding:12px 0}
.am-row-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:4px}
.am-tag{padding:0 6px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
.am-tag.is-muted{opacity:.6}
.am-row-day{color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.am-row-text{margin:0;font-size:13.5px;line-height:21px;overflow-wrap:anywhere}
.am-row-probe{margin:6px 0 0;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}
.am-row-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.am-pair{display:flex;flex-direction:column;gap:8px}
.am-pair .am-row-text{padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l2)}
.am-empty{margin:0;padding:32px 0;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center}
.am-error{margin:0 0 12px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.am-placeholder{margin:0 0 12px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.am-placeholder.is-error{color:var(--dsw-alias-state-error-primary)}
.am-foot{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;padding-top:22px;margin-top:26px;border-top:.5px solid var(--dsw-alias-border-l2)}
.am-foot-label{color:var(--dsw-alias-label-caption);font-size:12px}
.am-path{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.am-foot-hint{flex-basis:100%;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.am-page :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.am-textarea:focus-visible,.am-input:focus-visible,.am-select:focus-visible{outline:none}
@media (width<=760px){.am-head{align-items:flex-start}.am-head-tools{flex-wrap:wrap}.am-content{padding-bottom:48px}.am-head-tools .am-total{display:none}}
@media (prefers-reduced-motion:reduce){.am-button,.am-chip,.am-tab,.am-textarea{transition:none}}
`

    // ── plugin ─────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale']

    /**
     * Contribute the sidebar entry, its page, and the shared stylesheet.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, STRINGS), 'agent-memory: dictionaries')

      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = PANEL_ID
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => style.remove()
      }, 'agent-memory: styles')

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 25, locale: NS, label: () => t('panel') }, MemoryIcon),
      )

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, MemoryPage))
    }

    return { inject, apply }
  },
})
