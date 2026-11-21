/**
 * Controller & voice — the browser half of `@local/dsh-gamepad-voice`.
 *
 * Three registrations, all through slot declarations so they survive the
 * sidebar or the layout re-declaring its slots:
 *  - `sidebar.panellist` — the left-sidebar row and its icon;
 *  - `main` (key `gamepad-voice`) — the controller and dictation page;
 *  - `shell.overlay` — a transient HUD for recording and action feedback.
 *
 * The gamepad loop is a plugin effect, not page state: it keeps working while
 * the Conversation (or any other panel) is on screen. It reads the standard
 * Gamepad API and maps buttons to ordinary DSH client services:
 *  - sessions + uiWorkspace — switch the selected Session;
 *  - layout — cycle the main panels;
 *  - conversation — submit the draft, cancel a running turn, initialize a draft;
 *  - the page's own actions — new Session, delivery mode, recognition language.
 *
 * Dictation records a WAV in this window and asks DSH's own experimental
 * `remote.speech` Remote (mounted by the optional Voice input bundle) to
 * transcribe it locally. No audio is uploaded, and no audio is kept after the
 * transcript arrives. Settings live in this browser's localStorage.
 *
 * Bundle format: the client module system executes the factory below and
 * materializes it lazily. React comes from the platform module table, so this
 * file requires nothing else and declares no `dsh.client.external`.
 *
 * @module @local/dsh-gamepad-voice/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-gamepad-voice',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    const NS = 'gamepadVoice'
    const PANEL_ID = 'gamepad-voice'
    const SETTINGS_KEY = 'dsh.gamepad-voice.settings.v1'
    const SAMPLE_RATE = 16000
    const REPEAT_DELAY_MS = 360
    const REPEAT_INTERVAL_MS = 120
    const NOTICE_MS = 4200
    const ERROR_NOTICE_MS = 6500
    const MAX_RECORDING_FALLBACK = 120
    const MAX_CATALOG_SECONDS = 300

    /** Preparation phases in which the provider can accept a recording. */
    const READY_PHASES = Object.freeze(['ready', 'standby', 'waking'])

    /** Xbox One face-button colors; these identify hardware, not UI state. */
    const FACE_COLORS = Object.freeze({ A: '#5FAF31', B: '#D7453C', X: '#2F6FE4', Y: '#DEA500' })

    /** D-pad direction glyphs for the mapping legend and table. */
    const DPAD_ARROWS = Object.freeze({ keyUp: '↑', keyDown: '↓', keyLeft: '←', keyRight: '→' })

    /** Standard-mapping button indices used by ACTION_DEFS. */
    const BUTTON = Object.freeze({
      A: 0, B: 1, X: 2, Y: 3,
      LB: 4, RB: 5, LT: 6, RT: 7,
      BACK: 8, START: 9, L3: 10, R3: 11,
      UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
    })

    /** Fixed default mapping; documented in the page and the README. */
    const ACTION_DEFS = Object.freeze([
      { id: 'sessionPrev', button: BUTTON.UP, label: 'actionSessionPrev', buttons: ['keyUp'], repeat: true },
      { id: 'sessionNext', button: BUTTON.DOWN, label: 'actionSessionNext', buttons: ['keyDown'], repeat: true },
      { id: 'panelPrev', button: BUTTON.LEFT, label: 'actionPanelPrev', buttons: ['keyLeft'], repeat: true },
      { id: 'panelNext', button: BUTTON.RIGHT, label: 'actionPanelNext', buttons: ['keyRight'], repeat: true },
      { id: 'send', button: BUTTON.A, label: 'actionSend', buttons: ['keyA'] },
      { id: 'stop', button: BUTTON.B, label: 'actionStop', buttons: ['keyB'] },
      { id: 'newSession', button: BUTTON.X, label: 'actionNewSession', buttons: ['keyX'] },
      { id: 'talk', button: BUTTON.Y, label: 'actionTalk', buttons: ['keyY'], hold: true },
      { id: 'toggleDelivery', button: BUTTON.LB, label: 'actionToggleDelivery', buttons: ['keyLB'], holdToggle: true },
      { id: 'cycleLanguage', button: BUTTON.RB, label: 'actionCycleLanguage', buttons: ['keyRB'] },
      { id: 'conversation', button: BUTTON.BACK, label: 'actionConversation', buttons: ['keyBack'] },
      { id: 'openPanel', button: BUTTON.START, label: 'actionOpenPanel', buttons: ['keyStart'] },
    ])

    /** Locale keys for the live "currently pressed" chips, indexed by button. */
    const BUTTON_NAME_KEYS = Object.freeze([
      'keyA', 'keyB', 'keyX', 'keyY',
      'keyLB', 'keyRB', 'keyLT', 'keyRT',
      'keyBack', 'keyStart', 'keyL3', 'keyR3',
      'keyUp', 'keyDown', 'keyLeft', 'keyRight',
    ])

    const STRINGS = {
      zh: {
        panel: '手柄与语音',
        title: '手柄与语音',
        subtitle: '用手柄（Xbox One 布局）完成对话操作，按住说话代替打字。',
        statusConnected: '手柄已连接',
        statusConnectedXbox: 'Xbox One 已连接',
        statusDisconnected: '未连接手柄',
        statusVoiceReady: '语音可用',
        statusVoicePreparing: '语音准备中',
        statusVoiceUnprepared: '语音待准备',
        statusVoiceChecking: '语音检查中',
        statusVoiceUnavailable: '语音不可用',
        statusDeliverySend: '转写：直接发送',

        sectionController: '手柄控制',
        enableLabel: '启用手柄控制',
        enableHint: '关闭后手柄按键不会触发任何操作；手柄操作只在 DSH 窗口获得焦点时生效。',
        padLabel: '当前手柄',
        noPad: '没有检测到手柄',
        noPadHint: '连接手柄后按一下任意键，DSH 就能识别它。',
        gamepadUnsupported: '这个窗口不支持 Gamepad API，无法读取手柄。',
        padUse: '使用',
        padActive: '使用中',
        mappingTitle: '按键映射',
        mappingHint: 'Xbox One 标准映射；十字键支持按住连续触发。',
        mappingFixed: '固定映射，暂不支持修改；录音时 A 结束并转写、B 取消本次录音。',
        controllerHint: 'Xbox One 手柄：USB 直连最稳；蓝牙或无线接收器连接后按 Xbox 键加任意键唤醒，页面会显示手柄名称。',
        legendSetting: '显示按键提示条',
        legendSettingHint: '连接手柄时在窗口左下角显示 Xbox One 按键提示；关闭手柄控制时同步隐藏。',
        legendTitle: 'Xbox One 手柄',
        legendSend: '发送草稿',
        legendStop: '停止回复',
        legendNew: '新建会话',
        legendTalk: '按住说话',
        legendDelivery: '长按切去向',
        legendLanguage: '切换语言',
        legendSession: '切换会话',
        legendPanel: '切换面板',
        legendConversation: '回到对话',
        legendPage: '打开本页',
        liveTitle: '实时输入',
        liveIdle: '按一下手柄上的按键试试',
        unused: '未使用：LT / RT / LS / RS',

        keyA: 'A', keyB: 'B', keyX: 'X', keyY: 'Y',
        keyLB: 'LB', keyRB: 'RB', keyLT: 'LT', keyRT: 'RT',
        keyBack: 'View', keyStart: 'Menu', keyL3: 'LS', keyR3: 'RS',
        keyUp: '十字键 ↑', keyDown: '十字键 ↓', keyLeft: '十字键 ←', keyRight: '十字键 →',

        actionSessionPrev: '上一个会话',
        actionSessionNext: '下一个会话',
        actionPanelPrev: '上一个面板',
        actionPanelNext: '下一个面板',
        actionSend: '发送当前草稿',
        actionStop: '停止当前回复',
        actionNewSession: '新建会话',
        actionTalk: '按住说话',
        actionToggleDelivery: '按住切换转写去向',
        actionCycleLanguage: '切换识别语言',
        actionConversation: '返回对话',
        actionOpenPanel: '打开/关闭本页',

        sectionVoice: '语音输入',
        providerLabel: '识别引擎',
        providerUnknown: '未提供',
        openPlugins: '打开插件页',
        voiceChecking: '正在检查语音输入…',
        readinessReady: '模型就绪',
        readinessUnprepared: '模型未准备',
        readinessDownloading: '正在下载模型',
        readinessChecking: '正在检查环境',
        readinessLoading: '正在加载模型',
        readinessWaking: '正在唤醒',
        readinessCancelling: '正在取消',
        readinessFailed: '准备失败',
        readinessStandby: '已就绪（按需加载）',
        prepareModel: '准备语音模型',
        preparingModel: '正在准备…',
        languageLabel: '识别语言',
        languageFollow: '跟随语音输入设置',
        languageAuto: '自动识别',
        languageZh: '中文',
        languageEn: 'English',
        languageJa: '日本語',
        languageKo: '한국어',
        languageYue: '粤语',
        deliveryLabel: '转写后',
        deliveryDraft: '插入当前草稿',
        deliverySend: '直接发送',
        targetSession: '当前会话',
        noSession: '没有当前会话',
        running: '正在回复',
        idle: '空闲',
        micLabel: '麦克风',
        micGranted: '已授权',
        micDenied: '未授权',
        micUnknown: '未检查',
        micCheck: '请求麦克风权限',
        micHint: '第一次使用需要在系统或浏览器里允许 DSH 使用麦克风。',
        voiceUnavailableTitle: '语音输入不可用',
        voiceUnavailableBody: '在「插件」页启用「语音输入」后，这里才能转写。首次使用可能需要在该插件的详情页下载语音模型。',
        talk: '按住说话',
        talkHint: '松开后转写，结果按上面的「转写后」设置处理；也可以按住手柄 Y。',
        talkDisabledReason: '语音引擎就绪后才能听写。',
        starting: '正在打开麦克风…',
        recording: '正在听写…',
        transcribing: '正在转写…',
        talkRelease: '松开转写',
        talkCancel: '取消',
        lastTitle: '最近一次转写',
        lastEmpty: '还没有转写内容。按住说话后，文字会出现在这里。',
        transcriptHint: '转写结果已按上面的设置自动处理；这里可以改完再次插入或发送。',
        lastErrorLabel: '最近错误',
        againInsert: '再次插入',
        againSend: '再次发送',
        transcriptPlaceholder: '转写结果会出现在这里，可以先修改再插入。',
        insertDraft: '插入当前草稿',
        sendNow: '直接发送',
        clearTranscript: '清空',
        statsLabel: '耗时',
        usageTitle: '怎么用',
        usage1: '十字键 ↑ / ↓ 切换会话，← / → 切换左侧栏面板；A 发送草稿，B 停止回复，X 新建会话。',
        usage2: '连接手柄后按一下任意键即可识别；Menu 打开本页，View 回到对话。',
        usage3: '按住 Y 说话，松开后自动转写：默认插入当前草稿，按住 LB 约半秒可以改成直接发送。',
        usage4: '转写结果也会留在本页，可以改完再次插入或发送；窗口失去焦点或手柄断开时会自动结束录音。',
        privacyTitle: '数据与隐私',
        privacyBody: '录音只交给本机的「语音输入」转写，不上传，也不保存音频。手柄与语音设置保存在这个浏览器里。',
        releaseToStop: '松开结束',

        noticeEnabled: '手柄控制已开启',
        noticeDisabled: '手柄控制已关闭',
        noticeDeliveryDraft: '转写后：插入当前草稿',
        noticeDeliverySend: '转写后：直接发送',
        noticeLanguage: '识别语言：',
        noticeNewSessionRequested: '已请求新建会话',
        noticeNewSession: '已请求新建会话',
        noticeNoSession: '没有当前会话',
        noticeEmptyDraft: '当前草稿是空的',
        noticeSent: '已发送',
        noticeInserted: '已插入当前草稿',
        noticeBlocked: '输入框正在发送，转写已保留在本页',
        noticePreserved: '草稿未改动',
        noticeEmptyTranscript: '没有识别到语音',
        noticeCancelled: '已取消听写',
        noticeTooLong: '录音已到时长上限，正在转写',
        noticeVoiceUnavailable: '语音输入不可用，请先启用「语音输入」插件',
        noticeVoiceNotReady: '语音引擎还没准备好：请先在插件页启用「语音输入」并准备模型',
        noticeHoldToToggle: '按住 LB 约半秒可切换转写去向',
        noticeFocusStopped: '窗口失去焦点，已结束录音',
        noticeControllerLost: '手柄已断开，已结束录音',
        noticeMicDenied: '麦克风权限被拒绝：请在系统设置里允许 DSH 使用麦克风',
        noticeMicMissing: '没有找到麦克风',
        noticeUnsupported: '这个窗口不支持录音',
        noticeNoAudio: '没有录到声音',
        noticeRecorderFailed: '录音失败',
        noticeTranscribeFailed: '转写失败',
        noticeAudioInvalid: '录音数据无效或超过长度限制',
        noticePrepareFailed: '准备语音模型失败',
        noticeActionFailed: '操作失败',
        noticePadMissing: '没有检测到手柄',
      },
      en: {
        panel: 'Controller & voice',
        title: 'Controller & voice',
        subtitle: 'Run the conversation from a gamepad (Xbox One layout); hold a button to talk instead of typing.',
        statusConnected: 'Controller connected',
        statusConnectedXbox: 'Xbox One connected',
        statusDisconnected: 'No controller',
        statusVoiceReady: 'Voice ready',
        statusVoicePreparing: 'Voice preparing',
        statusVoiceUnprepared: 'Voice not prepared',
        statusVoiceChecking: 'Checking voice',
        statusVoiceUnavailable: 'Voice unavailable',
        statusDeliverySend: 'Transcripts: send immediately',

        sectionController: 'Controller',
        enableLabel: 'Enable controller input',
        enableHint: 'When off, gamepad buttons trigger nothing. Controller actions apply only while the DSH window has focus.',
        padLabel: 'Active controller',
        noPad: 'No controller detected',
        noPadHint: 'Connect a controller and press any button; DSH will pick it up.',
        gamepadUnsupported: 'This window has no Gamepad API, so controllers cannot be read.',
        padUse: 'Use',
        padActive: 'In use',
        mappingTitle: 'Button mapping',
        mappingHint: 'Xbox One standard mapping; the D-pad repeats while held.',
        mappingFixed: 'Fixed mapping for now; while recording, A finishes and transcribes and B cancels.',
        controllerHint: 'Xbox One controller: USB is the most reliable; after pairing over Bluetooth or a wireless adapter, press the Xbox button plus any button so the page can show its name.',
        legendSetting: 'Show button hint bar',
        legendSettingHint: 'While a controller is connected, show the Xbox One button hints at the lower-left of the window; hidden while controller input is off.',
        legendTitle: 'Xbox One controller',
        legendSend: 'Send draft',
        legendStop: 'Stop reply',
        legendNew: 'New session',
        legendTalk: 'Hold to talk',
        legendDelivery: 'Hold: destination',
        legendLanguage: 'Switch language',
        legendSession: 'Switch session',
        legendPanel: 'Switch panel',
        legendConversation: 'Back to chat',
        legendPage: 'Open this page',
        liveTitle: 'Live input',
        liveIdle: 'Press a button on the controller',
        unused: 'Unused: LT / RT / LS / RS',

        keyA: 'A', keyB: 'B', keyX: 'X', keyY: 'Y',
        keyLB: 'LB', keyRB: 'RB', keyLT: 'LT', keyRT: 'RT',
        keyBack: 'View', keyStart: 'Menu', keyL3: 'LS', keyR3: 'RS',
        keyUp: 'D-pad ↑', keyDown: 'D-pad ↓', keyLeft: 'D-pad ←', keyRight: 'D-pad →',

        actionSessionPrev: 'Previous session',
        actionSessionNext: 'Next session',
        actionPanelPrev: 'Previous panel',
        actionPanelNext: 'Next panel',
        actionSend: 'Send the draft',
        actionStop: 'Stop the reply',
        actionNewSession: 'New session',
        actionTalk: 'Hold to talk',
        actionToggleDelivery: 'Hold: switch transcript destination',
        actionCycleLanguage: 'Switch recognition language',
        actionConversation: 'Back to conversation',
        actionOpenPanel: 'Open/close this page',

        sectionVoice: 'Voice input',
        providerLabel: 'Recognition engine',
        providerUnknown: 'Not provided',
        openPlugins: 'Open Plugins',
        voiceChecking: 'Checking voice input…',
        readinessReady: 'Model ready',
        readinessUnprepared: 'Model not prepared',
        readinessDownloading: 'Downloading the model',
        readinessChecking: 'Checking the environment',
        readinessLoading: 'Loading the model',
        readinessWaking: 'Waking up',
        readinessCancelling: 'Cancelling',
        readinessFailed: 'Preparation failed',
        readinessStandby: 'Ready (loads on demand)',
        prepareModel: 'Prepare voice model',
        preparingModel: 'Preparing…',
        languageLabel: 'Recognition language',
        languageFollow: 'Follow the Voice input setting',
        languageAuto: 'Auto detect',
        languageZh: '中文',
        languageEn: 'English',
        languageJa: '日本語',
        languageKo: '한국어',
        languageYue: 'Cantonese',
        deliveryLabel: 'After transcription',
        deliveryDraft: 'Insert into the draft',
        deliverySend: 'Send immediately',
        targetSession: 'Current session',
        noSession: 'No current session',
        running: 'Replying',
        idle: 'Idle',
        micLabel: 'Microphone',
        micGranted: 'Allowed',
        micDenied: 'Blocked',
        micUnknown: 'Not checked',
        micCheck: 'Request microphone access',
        micHint: 'The first use asks the system or the browser to allow microphone access for DSH.',
        voiceUnavailableTitle: 'Voice input is unavailable',
        voiceUnavailableBody: 'Enable the Voice input plugin on the Plugins page to transcribe here. Its first use may need the model download on that plugin detail page.',
        talk: 'Hold to talk',
        talkHint: 'Release to transcribe; the result follows the destination setting above. Holding Y on the controller works too.',
        talkDisabledReason: 'Dictation starts once the voice engine is ready.',
        starting: 'Opening the microphone…',
        recording: 'Listening…',
        transcribing: 'Transcribing…',
        talkRelease: 'Release to transcribe',
        talkCancel: 'Cancel',
        lastTitle: 'Last transcript',
        lastEmpty: 'Nothing yet. Hold to talk and the text appears here.',
        transcriptHint: 'The transcript was already handled by the setting above; edit it here to insert or send again.',
        lastErrorLabel: 'Last error',
        againInsert: 'Insert again',
        againSend: 'Send again',
        transcriptPlaceholder: 'A transcript appears here; edit it before inserting if needed.',
        insertDraft: 'Insert into draft',
        sendNow: 'Send now',
        clearTranscript: 'Clear',
        statsLabel: 'Timing',
        usageTitle: 'How it works',
        usage1: 'D-pad ↑ / ↓ switches sessions, ← / → switches sidebar panels; A sends the draft, B stops the reply, X starts a new session.',
        usage2: 'Connect a controller and press any button; Menu opens this page and View returns to the conversation.',
        usage3: 'Hold Y to speak and release to transcribe: the result goes into the draft by default; hold LB for about half a second to send immediately instead.',
        usage4: 'The transcript also stays here so you can edit and insert or send it again; recording ends when the window loses focus or the controller disconnects.',
        privacyTitle: 'Data and privacy',
        privacyBody: 'Audio is transcribed on this machine by the Voice input plugin and is never uploaded or kept. Controller and voice settings live in this browser.',
        releaseToStop: 'Release to finish',

        noticeEnabled: 'Controller input enabled',
        noticeDisabled: 'Controller input disabled',
        noticeDeliveryDraft: 'Transcripts: insert into the draft',
        noticeDeliverySend: 'Transcripts: send immediately',
        noticeLanguage: 'Recognition language: ',
        noticeNewSessionRequested: 'New session requested',
        noticeNewSession: 'New session requested',
        noticeNoSession: 'No current session',
        noticeEmptyDraft: 'The current draft is empty',
        noticeSent: 'Sent',
        noticeInserted: 'Inserted into the draft',
        noticeBlocked: 'The composer is sending; the transcript is kept on this page',
        noticePreserved: 'The draft was left unchanged',
        noticeEmptyTranscript: 'No speech was recognized',
        noticeCancelled: 'Dictation cancelled',
        noticeTooLong: 'Recording reached its limit; transcribing now',
        noticeVoiceUnavailable: 'Voice input is unavailable; enable the Voice input plugin first',
        noticeVoiceNotReady: 'The voice engine is not ready: enable the Voice input plugin and prepare its model first',
        noticeHoldToToggle: 'Hold LB for about half a second to switch the transcript destination',
        noticeFocusStopped: 'The window lost focus; recording ended',
        noticeControllerLost: 'The controller disconnected; recording ended',
        noticeMicDenied: 'Microphone access was denied; allow DSH to use the microphone in system settings',
        noticeMicMissing: 'No microphone was found',
        noticeUnsupported: 'This window cannot record audio',
        noticeNoAudio: 'Nothing was recorded',
        noticeRecorderFailed: 'Recording failed',
        noticeTranscribeFailed: 'Transcription failed',
        noticeAudioInvalid: 'The recording is invalid or too long',
        noticePrepareFailed: 'Preparing the voice model failed',
        noticeActionFailed: 'The action failed',
        noticePadMissing: 'No controller detected',
      },
    }

    // ── small utilities ────────────────────────────────────────────────────

    /** Minimal observable store for UI state. */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get() { return value },
        set(next) {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    /** Subscribe a component to one store. */
    function useStore(store) {
      const [value, setValue] = useState(() => store.get())
      useEffect(() => {
        const sync = () => setValue(store.get())
        sync()
        return store.subscribe(sync)
      }, [store])
      return value
    }

    /** Clamp one number into a closed interval with a fallback for non-numbers. */
    function clampNumber(value, min, max, fallback) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return fallback
      return Math.min(max, Math.max(min, number))
    }

    /** `m:ss` for recording timers. */
    function formatClock(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0))
      const minutes = Math.floor(total / 60)
      const rest = total % 60
      return minutes + ':' + String(rest).padStart(2, '0')
    }

    /** One-line, bounded preview of a transcript for a toast. */
    function shortText(text, max) {
      const flat = String(text || '').replace(/\s+/gu, ' ').trim()
      const limit = max === undefined ? 36 : max
      if (flat.length <= limit) return flat
      return flat.slice(0, limit - 1) + '…'
    }

    /** Readable text for any thrown value. */
    function errorText(error) {
      if (error === null || error === undefined) return ''
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message !== '') return error.message
      return String(error)
    }

    /** Persisted preferences; unreadable storage reads as defaults. */
    function loadSettings() {
      const fallback = { enabled: true, delivery: 'draft', language: '', padId: '', legend: true }
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY)
        if (typeof raw !== 'string' || raw === '') return fallback
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return fallback
        return {
          enabled: parsed.enabled !== false,
          delivery: parsed.delivery === 'send' ? 'send' : 'draft',
          language: typeof parsed.language === 'string' ? parsed.language.slice(0, 24) : '',
          padId: typeof parsed.padId === 'string' ? parsed.padId.slice(0, 200) : '',
          legend: parsed.legend !== false,
        }
      } catch (_error) {
        return fallback
      }
    }

    /** Best-effort save; storage denial only costs the preference. */
    function saveSettings(settings) {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch (_error) {
        // Private-mode or quota failures leave the in-memory setting active.
      }
    }

    /** Base64 of raw bytes without a data URL prefix. */
    function bytesToBase64(bytes) {
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192))
      }
      return window.btoa(binary)
    }

    /** Canonical mono 16 kHz PCM16 WAV accepted by DSH's speech Remote. */
    function encodeWav(samples) {
      const bytes = new Uint8Array(44 + samples.length * 2)
      const view = new DataView(bytes.buffer)
      const text = (at, value) => {
        for (let index = 0; index < value.length; index += 1) bytes[at + index] = value.charCodeAt(index)
      }
      text(0, 'RIFF')
      view.setUint32(4, bytes.length - 8, true)
      text(8, 'WAVE')
      text(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, SAMPLE_RATE, true)
      view.setUint32(28, SAMPLE_RATE * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      text(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index]))
        view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
      }
      return bytes
    }

    /** Localized label for a recorder failure. */
    function recorderErrorText(t, kind) {
      if (kind === 'permission') return t('noticeMicDenied')
      if (kind === 'deviceMissing') return t('noticeMicMissing')
      if (kind === 'unsupported') return t('noticeUnsupported')
      if (kind === 'empty') return t('noticeNoAudio')
      if (kind === 'cancelled') return t('noticeCancelled')
      return t('noticeRecorderFailed')
    }

    /** Classify a getUserMedia rejection without depending on DOMException identity. */
    function mapMicError(error) {
      const name = error && typeof error.name === 'string' ? error.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'permission'
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'deviceMissing'
      if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'interrupted'
      return 'unavailable'
    }

    /** Localized label for a recognition provider state. */
    function readinessLabel(t, phase) {
      switch (phase) {
        case 'ready': return t('readinessReady')
        case 'unprepared': return t('readinessUnprepared')
        case 'downloading': return t('readinessDownloading')
        case 'checking': return t('readinessChecking')
        case 'loading': return t('readinessLoading')
        case 'waking': return t('readinessWaking')
        case 'cancelling': return t('readinessCancelling')
        case 'failed': return t('readinessFailed')
        case 'standby': return t('readinessStandby')
        default: return t('readinessReady')
      }
    }

    /** Localized label for a speech language code. */
    function languageLabel(t, code) {
      switch (code) {
        case 'auto': return t('languageAuto')
        case 'zh': return t('languageZh')
        case 'en': return t('languageEn')
        case 'ja': return t('languageJa')
        case 'ko': return t('languageKo')
        case 'yue': return t('languageYue')
        default: return String(code || '')
      }
    }

    // ── microphone capture ─────────────────────────────────────────────────

    /** Capture failure with a stable kind for localized text. */
    class RecorderError extends Error {
      constructor(kind) {
        super(kind)
        this.name = 'RecorderError'
        this.kind = kind
      }
    }

    /**
     * One microphone acquisition: record, resample to 16 kHz mono, and encode
     * the canonical WAV the speech Remote accepts. Disposal always releases
     * the tracks and closes the audio context.
     */
    class Recorder {
      constructor() {
        this.stream = null
        this.context = null
        this.analyser = null
        this.recorder = null
        this.chunks = []
        this.samples = new Float32Array(256)
      }

      async start() {
        const devices = navigator.mediaDevices
        if (devices === undefined || typeof devices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
          throw new RecorderError('unsupported')
        }
        let stream
        try {
          stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
        } catch (error) {
          throw new RecorderError(mapMicError(error))
        }
        this.stream = stream
        try {
          this.context = new AudioContext()
          this.analyser = this.context.createAnalyser()
          this.analyser.fftSize = this.samples.length
          this.context.createMediaStreamSource(stream).connect(this.analyser)
          this.recorder = new MediaRecorder(stream)
          this.recorder.ondataavailable = (event) => {
            if (event && event.data && event.data.size > 0) this.chunks.push(event.data)
          }
          this.recorder.start()
        } catch (_error) {
          await this.dispose()
          throw new RecorderError('unavailable')
        }
      }

      /** Current RMS level, 0 outside capture. */
      level() {
        if (this.analyser === null) return 0
        try {
          this.analyser.getFloatTimeDomainData(this.samples)
        } catch (_error) {
          return 0
        }
        let sum = 0
        for (const sample of this.samples) sum += sample * sample
        return Math.sqrt(sum / this.samples.length)
      }

      /** Stop capture and return one WAV recording. */
      async stop(maxSeconds) {
        const recorder = this.recorder
        const context = this.context
        if (recorder === null || context === null || recorder.state !== 'recording') {
          await this.dispose()
          throw new RecorderError('empty')
        }
        try {
          await new Promise((resolve, reject) => {
            recorder.onstop = () => resolve()
            recorder.onerror = () => reject(new RecorderError('empty'))
            try {
              recorder.stop()
            } catch (error) {
              reject(error)
            }
          })
          if (this.stream !== null) this.stream.getTracks().forEach((track) => { try { track.stop() } catch (_error) {} })
          const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' })
          if (blob.size === 0) throw new RecorderError('empty')
          const decoded = await context.decodeAudioData(await blob.arrayBuffer())
          const limit = Math.min(Number(decoded.duration) || 0, maxSeconds)
          const frames = Math.max(1, Math.floor(limit * SAMPLE_RATE))
          const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE)
          const source = offline.createBufferSource()
          source.buffer = decoded
          source.connect(offline.destination)
          source.start()
          const rendered = await offline.startRendering()
          return encodeWav(rendered.getChannelData(0))
        } finally {
          await this.dispose()
        }
      }

      /** Release this capture once. */
      async dispose() {
        if (this.recorder !== null && this.recorder.state === 'recording') {
          try { this.recorder.stop() } catch (_error) {}
        }
        this.recorder = null
        if (this.stream !== null) {
          this.stream.getTracks().forEach((track) => { try { track.stop() } catch (_error) {} })
          this.stream = null
        }
        const context = this.context
        this.context = null
        this.analyser = null
        this.chunks = []
        if (context !== null && typeof context.close === 'function') {
          try { await context.close() } catch (_error) {}
        }
      }
    }

    // ── runtime: gamepad loop, voice capture, and DSH actions ──────────────

    /** Initial voice snapshot. */
    function initialVoice() {
      return {
        available: false,
        checked: false,
        phase: 'idle',
        seconds: 0,
        level: 0,
        transcript: '',
        stats: null,
        deliveredMode: '',
        deliveredText: '',
        lastError: '',
        providerId: '',
        providerName: '',
        readiness: '',
        languages: [],
        maxSeconds: MAX_RECORDING_FALLBACK,
        catalogError: '',
        mic: 'unknown',
      }
    }

    /**
     * Build the plugin runtime shared by the page and the HUD.
     * @param ctx - the browser plugin context in `apply`.
     * @param t - the plugin-namespace translator.
     */
    function createRuntime(ctx, t) {
      const settingsStore = createStore(loadSettings())
      const padsStore = createStore({
        supported: typeof navigator.getGamepads === 'function',
        pads: [],
        activeIndex: -1,
      })
      const voiceStore = createStore(initialVoice())
      const noticeStore = createStore({ seq: 0, kind: 'info', text: '' })
      const live = { pressed: [], axes: [], padId: '' }

      let speech = null
      let catalog = null
      let catalogTask = null
      let recorder = null
      let talkTimer = 0
      let talkTask = null
      let pendingStop = null
      let noticeTimer = 0
      let noticeSeq = 0
      let padsSignature = ''
      let padState = null
      let disposed = false

      const settings = () => settingsStore.get()

      function updateSettings(patch) {
        const next = { ...settings(), ...patch }
        settingsStore.set(next)
        saveSettings(next)
      }

      function updateVoice(patch) {
        if (disposed) return
        voiceStore.set({ ...voiceStore.get(), ...patch })
      }

      /** Show one transient frame-wide notice. */
      function showNotice(message, kind) {
        if (disposed) return
        const text = String(message || '').trim()
        if (text === '') return
        noticeSeq += 1
        const seq = noticeSeq
        noticeStore.set({ seq, kind: kind === 'error' ? 'error' : 'info', text })
        if (noticeTimer !== 0) window.clearTimeout(noticeTimer)
        noticeTimer = window.setTimeout(() => {
          noticeTimer = 0
          if (noticeStore.get().seq === seq) noticeStore.set({ seq, kind: 'info', text: '' })
        }, kind === 'error' ? ERROR_NOTICE_MS : NOTICE_MS)
      }

      function sessionList() {
        const sessions = ctx.get('sessions')
        return sessions === undefined ? undefined : sessions.list.getSnapshot()
      }

      /** The Session the main view currently shows. */
      function currentSessionId() {
        const list = sessionList()
        if (list === undefined) return undefined
        for (const id of list.ids) {
          const row = list.byId[id]
          if (row !== undefined && row.retainedBy !== undefined && (row.retainedBy.mainView || 0) > 0) return id
        }
        // Subagent conversations live in `byId` without a Host-list row; the
        // main view still retains them, so dictation follows what is on screen.
        for (const row of Object.values(list.byId)) {
          if (row !== undefined && row.retainedBy !== undefined && (row.retainedBy.mainView || 0) > 0) return row.id
        }
        return undefined
      }

      function currentSessionRow() {
        const list = sessionList()
        const id = currentSessionId()
        if (list === undefined || id === undefined) return undefined
        return list.byId[id]
      }

      function pageHasFocus() {
        return typeof document.hasFocus === 'function' ? document.hasFocus() : true
      }

      // ── speech service ──────────────────────────────────────────────────

      /**
       * Generated Remotes resolve with a `{ ok, value | error }` envelope while
       * the Host service interface returns bare values. Accept both so a future
       * unwrapped client face keeps working.
       */
      function remoteValue(result) {
        if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
          if (!result.ok) {
            const error = result.error !== null && typeof result.error === 'object' ? result.error : {}
            const failure = new Error(typeof error.message === 'string' && error.message !== '' ? error.message : 'remote call failed')
            failure.code = typeof error.code === 'string' ? error.code : ''
            throw failure
          }
          return result.value
        }
        return result
      }

      /** Attach the optional experimental speech Remote namespace. */
      function attachSpeech(scope) {
        const service = (typeof scope.get === 'function' ? scope.get('remote.speech') : undefined) || (scope.remote && scope.remote.speech)
        if (service === undefined || service === null) return
        speech = service
        void refreshCatalog()
        if (typeof scope.effect === 'function') {
          scope.effect(() => () => {
            if (speech === service) {
              speech = null
              catalog = null
              updateVoice({ available: false, checked: true, providerId: '', providerName: '', readiness: '', languages: [], catalogError: '' })
            }
          }, 'gamepad-voice: speech remote')
        }
      }

      /** Re-read the provider roster and readiness. */
      function refreshCatalog() {
        if (disposed) return Promise.resolve()
        if (speech === null) {
          const current = voiceStore.get()
          if (current.available === false && current.checked === true) return Promise.resolve()
          updateVoice({ available: false, checked: true })
          return Promise.resolve()
        }
        if (catalogTask !== null) return catalogTask
        catalogTask = Promise.resolve()
          .then(() => speech.catalog())
          .then(remoteValue)
          .then((next) => {
            if (disposed) return
            catalog = next === undefined ? null : next
            const providers = catalog !== null && Array.isArray(catalog.providers) ? catalog.providers : []
            const selection = catalog !== null && catalog.selection !== undefined ? catalog.selection : undefined
            const selected = providers.find((provider) => provider !== undefined && provider.id === (selection && selection.providerId)) || providers[0] || null
            const languages = selected !== null && Array.isArray(selected.languages) ? selected.languages.slice() : []
            const durationLimit = clampNumber(catalog !== null ? catalog.maxDurationSeconds : undefined, 5, MAX_CATALOG_SECONDS, MAX_RECORDING_FALLBACK)
            const byteLimit = clampNumber(catalog !== null ? catalog.maxAudioBytes : undefined, SAMPLE_RATE * 2, 256 * 1024 * 1024, 4 * 1024 * 1024)
            const maxSeconds = Math.max(5, Math.min(durationLimit, Math.floor(byteLimit / (SAMPLE_RATE * 2))))
            const savedLanguage = settingsStore.get().language
            if (savedLanguage !== '' && languages.length > 0 && !languages.includes(savedLanguage)) updateSettings({ language: '' })
            updateVoice({
              available: true,
              checked: true,
              providerId: selected === null ? '' : selected.id,
              providerName: selected === null ? '' : (selected.name || String(selected.id)),
              readiness: selected === null ? 'unprepared' : ((selected.preparation && selected.preparation.phase) || 'ready'),
              languages,
              maxSeconds,
              catalogError: '',
            })
          })
          .catch((error) => {
            if (disposed) return
            updateVoice({ available: speech !== null, checked: true, catalogError: shortText(errorText(error), 160) })
          })
          .finally(() => { catalogTask = null })
        return catalogTask
      }

      /** Ask the Host to start or join model preparation. */
      async function prepareModel() {
        if (speech === null) {
          showNotice(t('noticeVoiceUnavailable'), 'error')
          return
        }
        await refreshCatalog()
        const providerId = voiceStore.get().providerId
        if (providerId === '') {
          showNotice(t('noticeVoiceNotReady'), 'error')
          return
        }
        try {
          // The generated Remote validates its declared parameter count, so the
          // optional options slot must still be supplied.
          remoteValue(await speech.prepare(providerId, undefined))
          showNotice(t('preparingModel'))
          window.setTimeout(() => { void refreshCatalog() }, 700)
        } catch (error) {
          showNotice(t('noticePrepareFailed') + ': ' + shortText(errorText(error), 120), 'error')
        }
      }

      /** Open the Plugins page, where the Voice input bundle is enabled. */
      function openPlugins() {
        const layout = ctx.get('layout')
        if (layout === undefined) return
        try {
          layout.selectPanel('plugins')
        } catch (_error) {
          showNotice(t('noticeActionFailed'), 'error')
        }
      }

      /** Ask for microphone permission with a real user gesture. */
      async function requestMic() {
        const devices = navigator.mediaDevices
        if (devices === undefined || typeof devices.getUserMedia !== 'function') {
          updateVoice({ mic: 'denied' })
          showNotice(t('noticeUnsupported'), 'error')
          return
        }
        try {
          const stream = await devices.getUserMedia({ audio: true, video: false })
          stream.getTracks().forEach((track) => { try { track.stop() } catch (_error) {} })
          updateVoice({ mic: 'granted' })
          showNotice(t('micGranted'))
        } catch (error) {
          const kind = mapMicError(error)
          updateVoice({ mic: kind === 'permission' ? 'denied' : voiceStore.get().mic })
          showNotice(kind === 'deviceMissing' ? t('noticeMicMissing') : t('noticeMicDenied'), 'error')
        }
      }

      // ── dictation ───────────────────────────────────────────────────────

      /** Wait at most `ms` for an optional readiness call; playback must never hang on it. */
      function withTimeout(promise, ms) {
        return new Promise((resolve) => {
          let settled = false
          const timer = window.setTimeout(() => {
            if (settled) return
            settled = true
            resolve(undefined)
          }, ms)
          const finish = (value) => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(value)
          }
          promise.then(finish, () => finish(undefined))
        })
      }

      /** Open the microphone and start recording; Y press or page press-hold. */
      function startTalk() {
        if (disposed || talkTask !== null) return Promise.resolve()
        if (voiceStore.get().phase !== 'idle') return Promise.resolve()
        if (speech === null) {
          showNotice(t('noticeVoiceUnavailable'), 'error')
          return Promise.resolve()
        }
        if (currentSessionId() === undefined) {
          showNotice(t('noticeNoSession'), 'error')
          return Promise.resolve()
        }
        pendingStop = null
        updateVoice({ phase: 'starting', seconds: 0, level: 0, stats: null, lastError: '', deliveredMode: '', deliveredText: '' })
        talkTask = (async () => {
          await withTimeout(refreshCatalog(), 2500)
          const ready = voiceStore.get()
          if (speech === null || ready.available !== true || ready.providerId === '') {
            updateVoice({ phase: 'idle', seconds: 0, level: 0 })
            showNotice(t('noticeVoiceNotReady'), 'error')
            return
          }
          if (ready.readiness !== 'ready' && ready.readiness !== 'standby' && ready.readiness !== 'waking') {
            updateVoice({ phase: 'idle', seconds: 0, level: 0 })
            showNotice(t('noticeVoiceNotReady'), 'error')
            return
          }
          const maxSeconds = ready.maxSeconds || MAX_RECORDING_FALLBACK
          const active = new Recorder()
          recorder = active
          try {
            await active.start()
          } catch (error) {
            recorder = null
            const kind = error instanceof RecorderError ? error.kind : 'unavailable'
            updateVoice({
              phase: 'idle',
              seconds: 0,
              level: 0,
              lastError: recorderErrorText(t, kind),
              mic: kind === 'permission' ? 'denied' : voiceStore.get().mic,
            })
            showNotice(recorderErrorText(t, kind), 'error')
            return
          }
          if (pendingStop !== null) {
            const mode = pendingStop
            pendingStop = null
            updateVoice({ phase: 'recording', mic: 'granted' })
            stopTalk(mode === 'cancel')
            return
          }
          updateVoice({ phase: 'recording', mic: 'granted' })
          const startedAt = Date.now()
          talkTimer = window.setInterval(() => {
            if (recorder === null) return
            const seconds = (Date.now() - startedAt) / 1000
            updateVoice({ seconds: Math.min(seconds, maxSeconds), level: recorder.level() })
            if (seconds >= maxSeconds) {
              showNotice(t('noticeTooLong'))
              stopTalk(false)
            }
          }, 100)
        })().finally(() => { talkTask = null })
        return talkTask
      }

      /** Stop the current capture; `cancel` discards it without transcribing. */
      function stopTalk(cancel) {
        const phase = voiceStore.get().phase
        if (phase === 'starting') {
          pendingStop = cancel === true ? 'cancel' : 'finish'
          return
        }
        if (phase !== 'recording') return
        if (talkTimer !== 0) {
          window.clearInterval(talkTimer)
          talkTimer = 0
        }
        const active = recorder
        recorder = null
        if (active === null) {
          updateVoice({ phase: 'idle', seconds: 0, level: 0 })
          return
        }
        if (cancel === true) {
          void active.dispose()
          updateVoice({ phase: 'idle', seconds: 0, level: 0 })
          showNotice(t('noticeCancelled'))
          return
        }
        updateVoice({ phase: 'transcribing', level: 0 })
        void transcribeAndDeliver(active)
      }

      /** Discard the current capture. */
      function cancelTalk() {
        stopTalk(true)
      }

      /** Encode the recording, transcribe it, and deliver the result. */
      async function transcribeAndDeliver(active) {
        const maxSeconds = voiceStore.get().maxSeconds || MAX_RECORDING_FALLBACK
        let wav
        try {
          wav = await active.stop(maxSeconds)
        } catch (error) {
          const message = recorderErrorText(t, error instanceof RecorderError ? error.kind : 'empty')
          updateVoice({ phase: 'idle', seconds: 0, level: 0, lastError: message })
          showNotice(message, 'error')
          return
        }
        const service = speech
        if (service === null) {
          updateVoice({ phase: 'idle', seconds: 0, level: 0, lastError: t('noticeVoiceUnavailable') })
          showNotice(t('noticeVoiceUnavailable'), 'error')
          return
        }
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        const abortTimer = controller === null ? 0 : window.setTimeout(() => { try { controller.abort() } catch (_error) {} }, 180000)
        try {
          const request = { audioBase64: bytesToBase64(wav) }
          const language = settingsStore.get().language
          if (language !== '') request.language = language
          const result = remoteValue(await service.transcribe(request, controller === null ? undefined : controller.signal))
          const text = result !== null && typeof result.text === 'string' ? result.text.trim() : ''
          updateVoice({
            phase: 'idle',
            seconds: 0,
            level: 0,
            lastError: '',
            ...(text === '' ? {} : {
              transcript: text,
              stats: {
                audio: Number(result.audioSeconds) || 0,
                inference: Number(result.inferenceSeconds) || 0,
              },
            }),
          })
          if (text === '') {
            showNotice(t('noticeEmptyTranscript'))
            return
          }
          await deliverText(text, settingsStore.get().delivery)
        } catch (error) {
          const code = error && typeof error.code === 'string' ? error.code : ''
          const message = code === 'speech/invalid-audio'
            ? t('noticeAudioInvalid')
            : t('noticeTranscribeFailed') + ': ' + shortText(errorText(error), 160)
          updateVoice({ phase: 'idle', seconds: 0, level: 0, lastError: message })
          showNotice(message, 'error')
        } finally {
          if (abortTimer !== 0) window.clearTimeout(abortTimer)
        }
      }

      /** Put one transcript into the current Session, or send it immediately. */
      function deliverText(text, mode) {
        const message = String(text || '').trim()
        if (message === '') {
          showNotice(t('noticeEmptyTranscript'), 'error')
          return Promise.resolve(false)
        }
        const sessions = ctx.get('sessions')
        const layout = ctx.get('layout')
        const targetId = currentSessionId()
        if (sessions === undefined || targetId === undefined) {
          updateVoice({ lastError: t('noticeNoSession') })
          showNotice(t('noticeNoSession'), 'error')
          return Promise.resolve(false)
        }
        const delivery = mode === 'send' || mode === 'draft' ? mode : settingsStore.get().delivery
        if (delivery === 'send') {
          const scope = typeof sessions.scope === 'function' ? sessions.scope(targetId) : undefined
          const scoped = scope === undefined ? undefined : scope.get('conversation')
          if (scoped === undefined || scoped === null) {
            showNotice(t('noticeNoSession'), 'error')
            return Promise.resolve(false)
          }
          return scoped.send(message).then(() => {
            updateVoice({ deliveredMode: 'send', deliveredText: message })
            showNotice(t('noticeSent') + ': ' + shortText(message))
            return true
          }, (error) => {
            const failure = t('noticeActionFailed') + ': ' + shortText(errorText(error), 140)
            updateVoice({ lastError: failure })
            showNotice(failure, 'error')
            return false
          })
        }
        const conversation = ctx.get('conversation')
        const binding = typeof sessions.binding === 'function' ? sessions.binding(targetId) : undefined
        if (conversation === undefined || binding === undefined) {
          showNotice(t('noticeNoSession'), 'error')
          return Promise.resolve(false)
        }
        let result
        try {
          result = conversation.input.requestDraftInitialization(binding, { prompt: message, whenDraftExists: 'append' })
        } catch (error) {
          const failure = t('noticeActionFailed') + ': ' + shortText(errorText(error), 140)
          updateVoice({ lastError: failure })
          showNotice(failure, 'error')
          return Promise.resolve(false)
        }
        if (result === 'blocked') {
          updateVoice({ lastError: t('noticeBlocked') })
          showNotice(t('noticeBlocked'), 'error')
          return Promise.resolve(false)
        }
        if (result === 'preserved') {
          updateVoice({ lastError: t('noticePreserved') })
          showNotice(t('noticePreserved'), 'error')
          return Promise.resolve(false)
        }
        updateVoice({ deliveredMode: 'draft', deliveredText: message })
        showNotice(t('noticeInserted') + ': ' + shortText(message))
        if (layout !== undefined && layout !== null) {
          try { layout.selectPanel(null) } catch (_error) {}
        }
        window.setTimeout(() => {
          try {
            const scope = typeof sessions.scope === 'function' ? sessions.scope(targetId) : undefined
            const scoped = scope === undefined ? undefined : scope.get('conversation')
            if (scoped !== undefined && scoped !== null) scoped.input.for(scope).focus()
          } catch (_error) {}
        }, 80)
        return Promise.resolve(true)
      }

      // ── settings actions ────────────────────────────────────────────────

      function setEnabled(enabled) {
        updateSettings({ enabled: enabled === true })
        showNotice(enabled === true ? t('noticeEnabled') : t('noticeDisabled'))
      }

      function setActivePad(padId) {
        updateSettings({ padId: typeof padId === 'string' ? padId : '' })
        padsSignature = ''
      }

      function setLegend(legend) {
        updateSettings({ legend: legend !== false })
      }

      /** Mirror the browser's current microphone permission, when observable. */
      async function refreshMicPermission() {
        const permissions = navigator.permissions
        if (permissions === undefined || typeof permissions.query !== 'function') return
        try {
          const status = await permissions.query({ name: 'microphone' })
          if (status.state === 'granted') updateVoice({ mic: 'granted' })
          else if (status.state === 'denied') updateVoice({ mic: 'denied' })
        } catch (_error) {
          // Permissions API coverage differs per build; the capture path remains authoritative.
        }
      }

      function setDelivery(delivery) {
        const next = delivery === 'send' ? 'send' : 'draft'
        updateSettings({ delivery: next })
        showNotice(next === 'send' ? t('noticeDeliverySend') : t('noticeDeliveryDraft'))
      }

      function setLanguage(language) {
        updateSettings({ language: typeof language === 'string' ? language.slice(0, 24) : '' })
      }

      function languageCodes() {
        const options = ['']
        const languages = voiceStore.get().languages
        if (Array.isArray(languages)) {
          for (const code of languages) {
            if (typeof code === 'string' && code !== '' && !options.includes(code)) options.push(code)
          }
        }
        return options
      }

      function cycleLanguage() {
        const options = languageCodes()
        const current = settingsStore.get().language
        const index = options.indexOf(current)
        const next = options[(index + 1 + options.length) % options.length]
        setLanguage(next)
        showNotice(t('noticeLanguage') + (next === '' ? t('languageFollow') : languageLabel(t, next)))
      }

      // ── DSH actions ─────────────────────────────────────────────────────

      function moveSession(delta) {
        const sessions = ctx.get('sessions')
        const uiWorkspace = ctx.get('uiWorkspace')
        if (sessions === undefined || uiWorkspace === undefined || typeof uiWorkspace.openSession !== 'function') return
        const list = sessions.list.getSnapshot()
        const ids = list.ids.filter((id) => {
          const row = list.byId[id]
          return row !== undefined && row.origin !== 'subagent'
        })
        if (ids.length === 0) return
        const current = currentSessionId()
        let index = current === undefined ? -1 : ids.indexOf(current)
        if (index < 0) index = delta > 0 ? -1 : 0
        const next = ids[(index + delta + ids.length) % ids.length]
        try {
          uiWorkspace.openSession(next)
        } catch (error) {
          showNotice(t('noticeActionFailed') + ': ' + shortText(errorText(error), 120), 'error')
        }
      }

      function movePanel(delta) {
        const layout = ctx.get('layout')
        const slots = ctx.slots
        if (layout === undefined || slots === undefined) return
        let mainKeys = null
        try {
          mainKeys = new Set()
          for (const entry of slots.entries('main')) {
            const key = entry !== undefined && entry.options !== undefined ? entry.options.key : undefined
            if (typeof key === 'string' && key !== '') mainKeys.add(key)
          }
        } catch (_error) {
          mainKeys = null
        }
        let ids = []
        try {
          const seen = new Set()
          for (const entry of slots.entriesOfSlot('sidebar.panellist')) {
            const id = entry !== undefined && entry.options !== undefined ? entry.options.id : undefined
            if (typeof id !== 'string' || id === '' || seen.has(id)) continue
            seen.add(id)
            if (mainKeys !== null && !mainKeys.has(id)) continue
            ids.push(id)
          }
        } catch (_error) {
          ids = []
        }
        const panels = [null].concat(ids)
        const active = layout.panelInfo.getSnapshot().activePanelId === undefined ? null : layout.panelInfo.getSnapshot().activePanelId
        let index = panels.indexOf(active)
        if (index < 0) index = 0
        const next = panels[(index + delta + panels.length) % panels.length]
        try {
          layout.selectPanel(next)
        } catch (error) {
          showNotice(t('noticeActionFailed') + ': ' + shortText(errorText(error), 120), 'error')
        }
      }

      function submitDraft() {
        const sessions = ctx.get('sessions')
        const id = currentSessionId()
        if (sessions === undefined || id === undefined) {
          showNotice(t('noticeNoSession'), 'error')
          return
        }
        const scope = typeof sessions.scope === 'function' ? sessions.scope(id) : undefined
        const conversation = scope === undefined ? undefined : scope.get('conversation')
        if (conversation === undefined || conversation === null) {
          showNotice(t('noticeNoSession'), 'error')
          return
        }
        let input
        try {
          input = conversation.input.for(scope)
        } catch (error) {
          showNotice(t('noticeActionFailed') + ': ' + shortText(errorText(error), 120), 'error')
          return
        }
        const draft = input.state.getSnapshot().draft
        if (typeof draft !== 'string' || draft.trim() === '') {
          showNotice(t('noticeEmptyDraft'))
          return
        }
        input.submit()
      }

      function stopResponse() {
        const sessions = ctx.get('sessions')
        const id = currentSessionId()
        if (sessions === undefined || id === undefined) {
          showNotice(t('noticeNoSession'), 'error')
          return
        }
        const scope = typeof sessions.scope === 'function' ? sessions.scope(id) : undefined
        const conversation = scope === undefined ? undefined : scope.get('conversation')
        if (conversation === undefined || conversation === null) {
          showNotice(t('noticeNoSession'), 'error')
          return
        }
        conversation.cancel().catch((error) => {
          showNotice(t('noticeActionFailed') + ': ' + shortText(errorText(error), 120), 'error')
        })
      }

      function newSession() {
        const uiWorkspace = ctx.get('uiWorkspace')
        if (uiWorkspace === undefined || typeof uiWorkspace.startSession !== 'function') return
        try {
          uiWorkspace.startSession()
          showNotice(t('noticeNewSessionRequested'))
        } catch (error) {
          showNotice(t('noticeActionFailed') + ': ' + shortText(errorText(error), 120), 'error')
        }
      }

      function openConversation() {
        const layout = ctx.get('layout')
        if (layout === undefined) return
        try { layout.selectPanel(null) } catch (_error) {}
      }

      function togglePanel() {
        const layout = ctx.get('layout')
        if (layout === undefined) return
        try {
          const active = layout.panelInfo.getSnapshot().activePanelId
          layout.selectPanel(active === PANEL_ID ? null : PANEL_ID)
        } catch (_error) {}
      }

      function toggleDelivery() {
        setDelivery(settingsStore.get().delivery === 'send' ? 'draft' : 'send')
      }

      /** Execute one non-hold binding, with recording-time overrides. */
      function runAction(id) {
        const phase = voiceStore.get().phase
        if (phase === 'starting' || phase === 'recording') {
          if (id === 'stop') { cancelTalk(); return }
          if (id === 'send' || id === 'conversation') {
            stopTalk(false)
            if (id === 'conversation') openConversation()
            return
          }
          return
        }
        if (phase === 'transcribing') return
        switch (id) {
          case 'sessionPrev': moveSession(-1); break
          case 'sessionNext': moveSession(1); break
          case 'panelPrev': movePanel(-1); break
          case 'panelNext': movePanel(1); break
          case 'send': submitDraft(); break
          case 'stop': stopResponse(); break
          case 'newSession': newSession(); break
          case 'toggleDelivery': toggleDelivery(); break
          case 'cycleLanguage': cycleLanguage(); break
          case 'conversation': openConversation(); break
          case 'openPanel': togglePanel(); break
          default: break
        }
      }

      // ── gamepad polling ─────────────────────────────────────────────────

      function readGamepads() {
        const api = navigator.getGamepads
        if (typeof api !== 'function') return []
        let all
        try {
          all = api.call(navigator)
        } catch (_error) {
          return []
        }
        if (!all) return []
        const pads = []
        for (const pad of all) {
          if (pad && pad.connected !== false) pads.push(pad)
        }
        return pads
      }

      function choosePad(pads) {
        const wanted = settingsStore.get().padId
        if (wanted !== '') {
          const found = pads.find((pad) => pad.id === wanted)
          if (found !== undefined) return found
        }
        return pads.length > 0 ? pads[0] : undefined
      }

      function publishPads(pads) {
        const active = choosePad(pads)
        const activeIndex = active === undefined ? -1 : active.index
        const signature = pads.map((pad) => pad.index + ':' + (pad.id || '') + ':' + (pad.mapping || '')).join('|') + '#' + activeIndex
        if (signature === padsSignature) return
        padsSignature = signature
        padsStore.set({
          supported: true,
          pads: pads.map((pad) => ({ index: pad.index, id: pad.id || '', mapping: pad.mapping || '' })),
          activeIndex,
        })
      }

      /** End an active capture when its controller or its window disappears. */
      function endCaptureOnLoss(noticeKey) {
        const phase = voiceStore.get().phase
        if (phase !== 'recording' && phase !== 'starting') return
        stopTalk(false)
        showNotice(t(noticeKey))
      }

      function pollGamepads(now) {
        const pads = readGamepads()
        publishPads(pads)
        const pad = choosePad(pads)
        if (pad === undefined) {
          if (padState !== null) endCaptureOnLoss('noticeControllerLost')
          padState = null
          live.pressed = []
          live.axes = []
          live.padId = ''
          return
        }
        if (padState !== null && padState.index !== pad.index) {
          endCaptureOnLoss('noticeControllerLost')
          padState = null
        }
        const pressed = []
        for (let index = 0; index < pad.buttons.length; index += 1) {
          const button = pad.buttons[index]
          pressed.push(Boolean(button && (button.pressed || button.value > 0.55)))
        }
        live.pressed = pressed
        live.axes = Array.from(pad.axes || [])
        live.padId = pad.id || ''
        const state = padState !== null
          ? padState
          : { index: pad.index, buttons: new Array(pressed.length).fill(false), repeat: Object.create(null), pressedAt: Object.create(null) }
        padState = state
        const enabled = settingsStore.get().enabled && pageHasFocus()
        for (const def of ACTION_DEFS) {
          const down = pressed[def.button] === true
          const was = state.buttons[def.button] === true
          if (def.hold === true) {
            if (down && !was && enabled) void startTalk()
            else if (!down && was) stopTalk(false)
            state.buttons[def.button] = down
            continue
          }
          if (def.holdToggle === true) {
            if (down && !was) {
              state.pressedAt[def.id] = now
            } else if (!down && was) {
              const startedAt = state.pressedAt[def.id] || now
              state.pressedAt[def.id] = 0
              if (enabled) {
                if (now - startedAt >= 600) runAction('toggleDelivery')
                else showNotice(t('noticeHoldToToggle'))
              }
            }
            state.buttons[def.button] = down
            continue
          }
          if (down && !was) {
            state.repeat[def.id] = now + REPEAT_DELAY_MS
            if (enabled) runAction(def.id)
          } else if (down && was && def.repeat === true && enabled) {
            const due = state.repeat[def.id] || 0
            if (now >= due) {
              state.repeat[def.id] = now + REPEAT_INTERVAL_MS
              runAction(def.id)
            }
          } else if (!down && was) {
            state.repeat[def.id] = 0
          }
          state.buttons[def.button] = down
        }
      }

      function startGamepadLoop() {
        if (typeof requestAnimationFrame !== 'function' || typeof navigator.getGamepads !== 'function') {
          padsStore.set({ supported: false, pads: [], activeIndex: -1 })
          return () => {}
        }
        let frame = 0
        let stopped = false
        const tick = (now) => {
          if (stopped) return
          frame = requestAnimationFrame(tick)
          try {
            pollGamepads(typeof now === 'number' ? now : Date.now())
          } catch (_error) {
            // A malformed gamepad reading must not stop future frames.
          }
        }
        frame = requestAnimationFrame(tick)
        return () => {
          stopped = true
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        }
      }

      // ── plugin lifetime ─────────────────────────────────────────────────

      ctx.effect(() => startGamepadLoop(), 'gamepad-voice: gamepad polling')

      // If the Voice input bundle never mounts, stop showing "checking" after
      // a few seconds; the page then explains how to enable it.
      const speechProbeTimer = window.setTimeout(() => {
        if (speech === null) updateVoice({ checked: true })
      }, 4000)

      // An open microphone must not outlive its window, its page visibility, or
      // an Escape press. Finishing (rather than discarding) keeps the words.
      ctx.effect(() => {
        const finishIfCapturing = (noticeKey) => endCaptureOnLoss(noticeKey)
        const onBlur = () => finishIfCapturing('noticeFocusStopped')
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') finishIfCapturing('noticeFocusStopped')
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          const phase = voiceStore.get().phase
          if (phase !== 'recording' && phase !== 'starting') return
          event.preventDefault()
          event.stopPropagation()
          cancelTalk()
        }
        window.addEventListener('blur', onBlur)
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          window.clearTimeout(speechProbeTimer)
          window.removeEventListener('blur', onBlur)
          document.removeEventListener('visibilitychange', onVisibility)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, 'gamepad-voice: capture safety')

      ctx.effect(() => () => {
        disposed = true
        if (noticeTimer !== 0) window.clearTimeout(noticeTimer)
        if (talkTimer !== 0) window.clearInterval(talkTimer)
        if (recorder !== null) {
          void recorder.dispose()
          recorder = null
        }
      }, 'gamepad-voice: release capture')

      return {
        stores: { settings: settingsStore, pads: padsStore, voice: voiceStore, notice: noticeStore },
        live,
        attachSpeech,
        refreshCatalog,
        prepareModel,
        requestMic,
        openPlugins,
        setEnabled,
        setActivePad,
        setLegend,
        refreshMicPermission,
        setDelivery,
        setLanguage,
        startTalk,
        stopTalk,
        cancelTalk,
        deliverText,
        currentSessionId,
        currentSessionRow,
        languageCodes,
      }
    }

    // ── page components ────────────────────────────────────────────────────

    /** The sidebar glyph rendered at 16px (18px when collapsed). */
    function GamepadVoiceIcon({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false', style: { display: 'block' } },
        h('path', {
          d: 'M5.4 4.3h5.2c1.1 0 2 .7 2.3 1.7l.7 2.6c.2.9-.5 1.7-1.4 1.6-.7-.1-1.3-.5-1.5-1.2l-.2-.6c-.2-.5-.6-.8-1.1-.8H7.6c-.5 0-.9.3-1.1.8l-.2.6c-.2.7-.8 1.1-1.5 1.2-.9.1-1.6-.7-1.4-1.6l.7-2.6c.3-1 1.2-1.7 2.3-1.7Z',
          stroke: 'currentColor',
          strokeWidth: 1.15,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M4.7 6.5v2M3.7 7.5h2', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('circle', { cx: 10.3, cy: 6.9, r: 0.72, fill: 'currentColor' }),
        h('circle', { cx: 11.5, cy: 8.1, r: 0.72, fill: 'currentColor' }),
      )
    }

    /** Small state badge. */
    function StatusBadge({ tone, label }) {
      return h('span', { className: 'gv-badge' + (tone === 'ok' ? ' is-ok' : '') }, h('span', { className: 'gv-badge-dot' }), h('span', null, label))
    }

    /** Accessible switch. */
    function Toggle({ checked, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'gv-switch' + (checked ? ' is-on' : ''),
        'aria-checked': checked,
        'aria-label': label,
        title: label,
        onClick: () => onChange(!checked),
      }, h('span', { className: 'gv-switch-knob' }))
    }

    /** Two-option segmented control. */
    function Segmented({ value, label, options, onChange }) {
      return h(
        'div',
        { className: 'gv-segmented', role: 'group', 'aria-label': label },
        options.map((option) => h('button', {
          key: option.value,
          type: 'button',
          className: 'gv-segmented-item' + (option.value === value ? ' is-selected' : ''),
          'aria-pressed': option.value === value,
          onClick: () => onChange(option.value),
        }, option.label)),
      )
    }

    /** Recording level bars. */
    function LevelMeter({ level, compact }) {
      const pattern = [0.3, 0.55, 0.8, 0.45, 0.95, 0.6, 0.4, 0.75, 1, 0.5, 0.35, 0.65]
      const strength = Math.min(1, (Number(level) || 0) * 9)
      return h(
        'span',
        { className: 'gv-level' + (compact === true ? ' is-compact' : ' is-active'), 'aria-hidden': 'true' },
        pattern.map((base, index) => h('span', {
          key: index,
          className: 'gv-level-bar',
          style: { height: Math.max(2, Math.round(2 + base * strength * (compact === true ? 10 : 18))) + 'px' },
        })),
      )
    }

    /** One Xbox One button glyph: colored face button, D-pad arrow, LB/RB, View, Menu. */
    function XboxKey({ name, size }) {
      const edge = typeof size === 'number' ? size : 16
      const letter = typeof name === 'string' && name.startsWith('key') ? name.slice(3) : ''
      if (FACE_COLORS[letter] !== undefined) {
        return h('span', {
          className: 'gv-glyph gv-glyph-face',
          'aria-hidden': 'true',
          style: { width: edge + 'px', height: edge + 'px', fontSize: Math.max(8, Math.round(edge * 0.58)) + 'px', backgroundColor: FACE_COLORS[letter] },
        }, letter)
      }
      if (DPAD_ARROWS[name] !== undefined) {
        return h('span', {
          className: 'gv-glyph gv-glyph-pill gv-glyph-dpad',
          'aria-hidden': 'true',
          style: { height: edge + 'px', fontSize: Math.max(9, Math.round(edge * 0.66)) + 'px' },
        }, DPAD_ARROWS[name])
      }
      if (name === 'keyBack') {
        return h('span', { className: 'gv-glyph gv-glyph-pill gv-glyph-named', 'aria-hidden': 'true', style: { height: edge + 'px' } },
          h('svg', { width: 8, height: 8, viewBox: '0 0 8 8', fill: 'none' },
            h('rect', { x: 1, y: 2.6, width: 4.6, height: 3.2, rx: 0.8, stroke: 'currentColor', strokeWidth: 1 }),
            h('rect', { x: 2.6, y: 1.2, width: 4.6, height: 3.2, rx: 0.8, fill: 'var(--dsw-alias-bg-layer-2)', stroke: 'currentColor', strokeWidth: 1 }),
          ),
          h('span', null, 'View'),
        )
      }
      if (name === 'keyStart') {
        return h('span', { className: 'gv-glyph gv-glyph-pill gv-glyph-named', 'aria-hidden': 'true', style: { height: edge + 'px' } },
          h('svg', { width: 8, height: 8, viewBox: '0 0 8 8', fill: 'none' },
            h('path', { d: 'M1 2h6M1 4h6M1 6h6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
          ),
          h('span', null, 'Menu'),
        )
      }
      const text = name === 'keyLB' ? 'LB' : name === 'keyRB' ? 'RB' : name === 'keyLT' ? 'LT' : name === 'keyRT' ? 'RT' : name === 'keyL3' ? 'LS' : name === 'keyR3' ? 'RS' : String(name || '')
      return h('span', {
        className: 'gv-glyph gv-glyph-pill',
        'aria-hidden': 'true',
        style: { height: edge + 'px' },
      }, text)
    }

    /** A label line that starts with its Xbox One button. */
    function KeyedLabel({ t, button, text, size }) {
      return h('span', { className: 'gv-keyed-label' }, h(XboxKey, { name: button, size }), h('span', null, text))
    }

    /** The left-sidebar page. */
    function GamepadVoicePage({ t, useSessions, runtime }) {
      const settings = useStore(runtime.stores.settings)
      const pads = useStore(runtime.stores.pads)
      const voice = useStore(runtime.stores.voice)
      const sessions = typeof useSessions === 'function' ? useSessions((list) => list) : undefined
      const [pressed, setPressed] = useState([])
      const [transcriptDraft, setTranscriptDraft] = useState('')
      const [edited, setEdited] = useState(false)

      useEffect(() => {
        if (voice.transcript === '') return
        // Keep text the user deliberately typed; a fresh transcript only fills
        // an untouched editor so edits are never silently lost.
        setTranscriptDraft((current) => (edited && current.trim() !== '' ? current : voice.transcript))
      }, [voice.transcript, edited])

      useEffect(() => {
        const timer = window.setInterval(() => {
          const next = []
          for (let index = 0; index < runtime.live.pressed.length; index += 1) {
            if (runtime.live.pressed[index]) next.push(index)
          }
          setPressed((previous) => (
            previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next
          ))
        }, 120)
        return () => { window.clearInterval(timer) }
      }, [runtime])

      useEffect(() => {
        void runtime.refreshCatalog()
        void runtime.refreshMicPermission()
        const timer = window.setInterval(() => { void runtime.refreshCatalog() }, 5000)
        return () => { window.clearInterval(timer) }
      }, [runtime])

      const current = useMemo(() => {
        if (sessions === undefined || sessions === null || !Array.isArray(sessions.ids)) return undefined
        for (const id of sessions.ids) {
          const row = sessions.byId[id]
          if (row !== undefined && row.retainedBy !== undefined && (row.retainedBy.mainView || 0) > 0) return row
        }
        return undefined
      }, [sessions])

      const languageOptions = useMemo(() => {
        const options = [{ value: '', label: t('languageFollow') }]
        for (const code of runtime.languageCodes()) {
          if (code === '') continue
          options.push({ value: code, label: languageLabel(t, code) })
        }
        return options
      }, [voice.languages, t])

      const settingsLanguage = languageOptions.some((option) => option.value === settings.language) ? settings.language : ''
      const phase = voice.phase
      const busy = phase !== 'idle'
      const talkLabel = phase === 'recording' ? t('talkRelease') : phase === 'starting' ? t('starting') : phase === 'transcribing' ? t('transcribing') : t('talk')
      const canInsert = transcriptDraft.trim() !== '' && current !== undefined
      const micLabel = voice.mic === 'granted' ? t('micGranted') : voice.mic === 'denied' ? t('micDenied') : t('micUnknown')
      const activePad = pads.pads[pads.activeIndex] || pads.pads[0]
      const controllerStatusLabel = activePad === undefined
        ? t('statusDisconnected')
        : activePad.mapping === 'standard' ? t('statusConnectedXbox') : t('statusConnected')
      const voicePreparingPhase = voice.readiness === 'downloading' || voice.readiness === 'checking'
        || voice.readiness === 'loading'
      const voiceUsable = READY_PHASES.includes(voice.readiness)
      const voiceState = voice.checked !== true
        ? 'checking'
        : voice.available !== true || voice.catalogError !== '' || voice.providerId === ''
          ? 'unavailable'
          : voiceUsable
            ? 'ready'
            : voicePreparingPhase ? 'preparing' : 'unprepared'
      const voiceStatusLabel = voiceState === 'ready'
        ? t('statusVoiceReady')
        : voiceState === 'preparing'
          ? t('statusVoicePreparing')
          : voiceState === 'checking'
            ? t('statusVoiceChecking')
            : voiceState === 'unprepared' ? t('statusVoiceUnprepared') : t('statusVoiceUnavailable')
      const talkReady = voiceState === 'ready'
      const delivered = voice.deliveredMode === 'draft' ? t('noticeInserted')
        : voice.deliveredMode === 'send' ? t('noticeSent') : ''
      const insertLabel = voice.deliveredMode === '' ? t('insertDraft') : t('againInsert')
      const sendLabel = voice.deliveredMode === '' ? t('sendNow') : t('againSend')

      function onTalkDown(event) {
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault()
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch (_error) {}
        void runtime.startTalk()
      }

      function onTalkUp(event) {
        event.preventDefault()
        runtime.stopTalk(false)
      }

      function onTalkKeyDown(event) {
        if (event.key !== ' ' && event.key !== 'Enter') return
        if (event.repeat) return
        event.preventDefault()
        void runtime.startTalk()
      }

      function onTalkKeyUp(event) {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        runtime.stopTalk(false)
      }

      const controllerSection = h(
        'section',
        { className: 'gv-section' },
        h('h2', { className: 'gv-section-title' }, t('sectionController')),
        h(
          'div',
          { className: 'gv-card' },
          h(
            'div',
            { className: 'gv-row' },
            h('div', { className: 'gv-row-text' },
              h('div', { className: 'gv-row-label' }, t('enableLabel')),
              h('p', { className: 'gv-row-hint' }, t('enableHint')),
            ),
            h('div', { className: 'gv-row-control' }, h(Toggle, { checked: settings.enabled, label: t('enableLabel'), onChange: (value) => runtime.setEnabled(value) })),
          ),
          h(
            'div',
            { className: 'gv-row' },
            h('div', { className: 'gv-row-text' },
              h('div', { className: 'gv-row-label' }, t('legendSetting')),
              h('p', { className: 'gv-row-hint' }, t('legendSettingHint')),
            ),
            h('div', { className: 'gv-row-control' }, h(Toggle, { checked: settings.legend !== false, label: t('legendSetting'), onChange: (value) => runtime.setLegend(value) })),
          ),
          pads.supported === false
            ? h('div', { className: 'gv-empty' }, h('p', { className: 'gv-empty-title' }, t('gamepadUnsupported')))
            : pads.pads.length === 0
              ? h('div', { className: 'gv-empty' },
                  h('p', { className: 'gv-empty-title' }, t('noPad')),
                  h('p', { className: 'gv-empty-body' }, t('noPadHint')),
                  h('p', { className: 'gv-empty-body' }, t('controllerHint')),
                )
              : pads.pads.map((pad) => h(
                  'div',
                  { className: 'gv-pad', key: String(pad.index) + ':' + pad.id },
                  h('span', { className: 'gv-pad-name' }, (pad.id || t('padLabel')) + (pad.mapping === 'standard' ? '' : ' (' + (pad.mapping || 'non-standard') + ')')),
                  pad.index === pads.activeIndex
                    ? h('span', { className: 'gv-tag' }, t('padActive'))
                    : h('button', { type: 'button', className: 'gv-button', onClick: () => runtime.setActivePad(pad.id) }, t('padUse')),
                )),
          pads.pads.length === 0 ? null : h('p', { className: 'gv-note' }, t('controllerHint')),
          h(
            'details',
            { className: 'gv-details' },
            h('summary', { className: 'gv-details-summary' }, t('mappingTitle') + ' · ' + ACTION_DEFS.length),
            h('p', { className: 'gv-row-hint' }, t('mappingHint')),
            h('p', { className: 'gv-note', style: { marginTop: '2px' } }, t('mappingFixed')),
            h(
              'div',
              { className: 'gv-map', role: 'list' },
              ACTION_DEFS.map((def) => h(
                'div',
                { className: 'gv-map-row', role: 'listitem', key: def.id },
                h('span', { className: 'gv-map-label' }, t(def.label)),
                h('span', { className: 'gv-keys' }, def.buttons.map((key) => h(XboxKey, { name: key, key, size: 16 }))),
              )),
            ),
          ),
          h(
            'div',
            { className: 'gv-row' },
            h('div', { className: 'gv-row-text' },
              h('div', { className: 'gv-row-label' }, t('liveTitle')),
              pressed.length === 0 ? h('p', { className: 'gv-row-hint' }, t('liveIdle')) : null,
            ),
          ),
          pressed.length === 0
            ? null
            : h('div', { className: 'gv-live-chips' }, pressed.map((index) => {
                const name = BUTTON_NAME_KEYS[index] || 'keyA'
                return h('span', { className: 'gv-live-chip', key: index }, h(XboxKey, { name }), h('span', null, t(name)))
              })),
          h('p', { className: 'gv-note' }, t('unused')),
        ),
      )

      const voiceSection = h(
        'section',
        { className: 'gv-section' },
        h('h2', { className: 'gv-section-title' }, t('sectionVoice')),
        h(
          'div',
          { className: 'gv-card' },
          voiceState === 'checking'
            ? h('div', { className: 'gv-empty' },
                h('p', { className: 'gv-empty-title' }, t('voiceChecking')),
              )
            : voiceState === 'unavailable'
              ? h('div', { className: 'gv-empty' },
                  h('p', { className: 'gv-empty-title' }, t('voiceUnavailableTitle')),
                  h('p', { className: 'gv-empty-body' }, t('voiceUnavailableBody')),
                  h('div', { className: 'gv-row-control', style: { marginTop: '10px' } },
                    h('button', { type: 'button', className: 'gv-button', onClick: () => runtime.openPlugins() }, t('openPlugins')),
                    voice.providerId !== ''
                      ? h('button', { type: 'button', className: 'gv-button', onClick: () => { void runtime.prepareModel() } }, t('prepareModel'))
                      : null,
                  ),
                )
              : h(
                  'div',
                  { className: 'gv-row' },
                  h('div', { className: 'gv-row-text' },
                    h('div', { className: 'gv-row-label' }, t('providerLabel')),
                    h('p', { className: 'gv-row-hint' },
                      (voice.providerName || t('providerUnknown')) + ' · ' + readinessLabel(t, voice.readiness) + (voice.catalogError !== '' ? ' · ' + shortText(voice.catalogError, 80) : '')),
                  ),
                  h('div', { className: 'gv-row-control' },
                    voice.providerId !== '' && !voiceUsable && !voicePreparingPhase
                      ? h('button', { type: 'button', className: 'gv-button', onClick: () => { void runtime.prepareModel() } }, t('prepareModel'))
                      : null,
                  ),
                ),
          voiceState === 'checking' || voiceState === 'unavailable'
            ? null
            : h(
                'div',
                { className: 'gv-talk' },
                h('button', {
                  type: 'button',
                  className: 'gv-talk-button' + (phase === 'recording' ? ' is-recording' : ''),
                  disabled: !talkReady && phase === 'idle',
                  title: talkReady ? undefined : t('talkDisabledReason'),
                  'aria-label': talkLabel,
                  'aria-describedby': 'gv-talk-hint',
                  onPointerDown: onTalkDown,
                  onPointerUp: onTalkUp,
                  onPointerCancel: onTalkUp,
                  onKeyDown: onTalkKeyDown,
                  onKeyUp: onTalkKeyUp,
                  onContextMenu: (event) => event.preventDefault(),
                }, h(XboxKey, { name: 'keyY', size: 18 }), h('span', null, talkLabel)),
                phase === 'recording' || phase === 'starting'
                  ? h('button', { type: 'button', className: 'gv-button', onClick: () => runtime.cancelTalk() }, t('talkCancel'))
                  : null,
                phase === 'recording' ? h(LevelMeter, { level: voice.level }) : null,
                h('div', { className: 'gv-talk-meta' },
                  h('span', { id: 'gv-talk-hint' }, talkReady ? t('talkHint') : t('talkDisabledReason')),
                  phase === 'recording' ? h('span', { className: 'gv-clock' }, formatClock(voice.seconds) + ' · ' + t('releaseToStop')) : null,
                ),
              ),
          voiceState === 'checking' || voiceState === 'unavailable'
            ? null
            : h(
                'div',
                { className: 'gv-row' },
                h('div', { className: 'gv-row-text' },
                  h('div', { className: 'gv-row-label gv-keyed-label' },
                    h(XboxKey, { name: 'keyUp' }), h(XboxKey, { name: 'keyDown' }), h('span', null, t('targetSession')),
                  ),
                ),
                h('div', { className: 'gv-row-control' },
                  h('span', { className: 'gv-row-hint', style: { margin: 0 } },
                    current === undefined ? t('noSession') : current.displayTitle + ' · ' + (current.running ? t('running') : t('idle'))),
                ),
              ),
          voiceState === 'checking' || voiceState === 'unavailable'
            ? null
            : h(
                'div',
                { className: 'gv-row' },
                h('label', { className: 'gv-row-label gv-keyed-label', htmlFor: 'gv-language' },
                  h(XboxKey, { name: 'keyRB' }), h('span', null, t('languageLabel'))),
                h('div', { className: 'gv-row-control' },
                  h('select', {
                    id: 'gv-language',
                    className: 'gv-select',
                    value: settingsLanguage,
                    onChange: (event) => runtime.setLanguage(event.target.value),
                  }, languageOptions.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
                ),
              ),
          voiceState === 'checking' || voiceState === 'unavailable'
            ? null
            : h(
                'div',
                { className: 'gv-row' },
                h('div', { className: 'gv-row-text' },
                  h('div', { className: 'gv-row-label gv-keyed-label' },
                    h(XboxKey, { name: 'keyLB' }), h('span', null, t('deliveryLabel')),
                  ),
                ),
                h('div', { className: 'gv-row-control' },
                  h(Segmented, {
                    value: settings.delivery,
                    label: t('deliveryLabel'),
                    onChange: (value) => runtime.setDelivery(value),
                    options: [{ value: 'draft', label: t('deliveryDraft') }, { value: 'send', label: t('deliverySend') }],
                  }),
                ),
              ),
          voiceState === 'checking' || voiceState === 'unavailable'
            ? null
            : h(
                'div',
                { className: 'gv-row' },
                h('div', { className: 'gv-row-text' },
                  h('div', { className: 'gv-row-label' }, t('micLabel')),
                  h('p', { className: 'gv-row-hint' }, t('micHint')),
                ),
                h('div', { className: 'gv-row-control' },
                  h('span', { className: 'gv-row-hint', style: { margin: 0 } }, micLabel),
                  voice.mic !== 'granted'
                    ? h('button', { type: 'button', className: 'gv-button', onClick: () => { void runtime.requestMic() } }, t('micCheck'))
                    : null,
                ),
              ),
          voiceState === 'checking' || voiceState === 'unavailable'
            ? null
            : h('div', { className: 'gv-row', style: { display: 'block' } },
                h('div', { className: 'gv-row-label' }, t('lastTitle')),
                h('p', { className: 'gv-row-hint', id: 'gv-transcript-hint' }, delivered !== '' ? delivered + ' · ' + t('transcriptHint') : (voice.transcript === '' ? t('lastEmpty') : t('transcriptHint'))),
                h('textarea', {
                  className: 'gv-transcript',
                  rows: 3,
                  value: transcriptDraft,
                  placeholder: t('transcriptPlaceholder'),
                  'aria-label': t('lastTitle'),
                  'aria-describedby': 'gv-transcript-hint',
                  disabled: busy,
                  onChange: (event) => {
                    setTranscriptDraft(event.target.value)
                    setEdited(true)
                  },
                }),
                h('div', { className: 'gv-transcript-actions' },
                  h('button', {
                    type: 'button',
                    className: 'gv-button gv-button-primary',
                    disabled: !canInsert || busy,
                    onClick: async () => {
                      const text = transcriptDraft.trim()
                      if (text === '') return
                      const ok = await runtime.deliverText(text, 'draft')
                      if (ok) setEdited(false)
                    },
                  }, insertLabel),
                  h('button', {
                    type: 'button',
                    className: 'gv-button',
                    disabled: !canInsert || busy,
                    onClick: async () => {
                      const text = transcriptDraft.trim()
                      if (text === '') return
                      const ok = await runtime.deliverText(text, 'send')
                      if (ok) setEdited(false)
                    },
                  }, sendLabel),
                  h('button', {
                    type: 'button',
                    className: 'gv-button',
                    disabled: busy || transcriptDraft === '',
                    onClick: () => {
                      setTranscriptDraft('')
                      setEdited(false)
                    },
                  }, t('clearTranscript')),
                  voice.stats !== null
                    ? h('span', { className: 'gv-stats' }, t('statsLabel') + ': ' + voice.stats.audio.toFixed(1) + 's → ' + voice.stats.inference.toFixed(1) + 's')
                    : null,
                ),
                voice.lastError !== ''
                  ? h('p', { className: 'gv-row-hint gv-error-text' }, t('lastErrorLabel') + ': ' + voice.lastError)
                  : null,
              ),
        ),
      )

      const usageSection = h(
        'section',
        { className: 'gv-section' },
        h('h2', { className: 'gv-section-title' }, t('usageTitle')),
        h('ol', { className: 'gv-steps' },
          h('li', null, t('usage1')),
          h('li', null, t('usage2')),
          h('li', null, t('usage3')),
          h('li', null, t('usage4')),
        ),
        h('h2', { className: 'gv-section-title', style: { marginTop: '18px' } }, t('privacyTitle')),
        h('p', { className: 'gv-privacy' }, t('privacyBody')),
      )

      return h(
        'section',
        { className: 'gv-page' },
        h(
          'div',
          { className: 'gv-scroll' },
          h(
            'div',
            { className: 'gv-content' },
            h(
              'header',
              { className: 'gv-head' },
              h('div', null,
                h('h1', { className: 'gv-title' }, t('title')),
                h('p', { className: 'gv-subtitle' }, t('subtitle')),
              ),
              h('div', { className: 'gv-badges' },
                h(StatusBadge, { tone: pads.pads.length > 0 ? 'ok' : 'muted', label: controllerStatusLabel }),
                h(StatusBadge, { tone: voiceState === 'ready' ? 'ok' : 'muted', label: voiceStatusLabel }),
                settings.delivery === 'send' ? h(StatusBadge, { tone: 'muted', label: t('statusDeliverySend') }) : null,
              ),
            ),
            voiceSection,
            controllerSection,
            usageSection,
          ),
        ),
      )
    }

    /** Transient frame-wide HUD: recording, transcription, and action feedback. */
    function GamepadVoiceHud({ t, runtime }) {
      const voice = useStore(runtime.stores.voice)
      const notice = useStore(runtime.stores.notice)
      const phase = voice.phase
      if (phase === 'starting' || phase === 'recording' || phase === 'transcribing') {
        return h(
          'div',
          { className: 'gv-hud' + (phase === 'recording' ? ' is-recording' : ''), role: 'status' },
          phase === 'recording' ? h('span', { className: 'gv-hud-dot' }) : null,
          h('span', { className: 'gv-hud-label', 'aria-live': 'polite' }, phase === 'starting' ? t('starting') : phase === 'recording' ? t('recording') : t('transcribing')),
          phase === 'recording' ? h('span', { className: 'gv-hud-clock' }, formatClock(voice.seconds)) : null,
          phase === 'recording' ? h(LevelMeter, { level: voice.level, compact: true }) : null,
          phase === 'recording' ? h('span', { className: 'gv-hud-hint' }, t('releaseToStop')) : null,
        )
      }
      if (notice.text === '') return null
      return h(
        'div',
        { className: 'gv-hud' + (notice.kind === 'error' ? ' is-error' : ' is-info'), role: 'status' },
        h('span', { className: 'gv-hud-label', 'aria-live': 'polite' }, notice.text),
      )
    }

    /** Persistent Xbox One hint bar, shown while a controller is connected. */
    function GamepadLegend({ t, runtime, usePanelInfo }) {
      const settings = useStore(runtime.stores.settings)
      const pads = useStore(runtime.stores.pads)
      const activePanel = typeof usePanelInfo === 'function' ? usePanelInfo((info) => info.activePanelId) : null
      if (settings.enabled !== true || settings.legend === false || pads.pads.length === 0) return null
      if (activePanel === PANEL_ID) return null
      const pad = pads.pads[pads.activeIndex] || pads.pads[0]
      const item = (button, label, key) => h('span', { className: 'gv-legend-item', key: key || button },
        h(XboxKey, { name: button, size: 15 }), h('span', null, label))
      const pair = (first, second, label, key) => h('span', { className: 'gv-legend-item', key },
        h(XboxKey, { name: first, size: 15 }), h(XboxKey, { name: second, size: 15 }), h('span', null, label))
      return h(
        'div',
        { className: 'gv-legend', role: 'note', 'aria-label': t('legendTitle') },
        h('div', { className: 'gv-legend-head' },
          h('span', null, t('legendTitle')),
          pad === undefined ? null : h('span', { className: 'gv-legend-pad' }, pad.id),
        ),
        h('div', { className: 'gv-legend-row' },
          item('keyA', t('legendSend')),
          item('keyB', t('legendStop')),
          item('keyX', t('legendNew')),
        ),
        h('div', { className: 'gv-legend-row' },
          item('keyY', t('legendTalk')),
          item('keyLB', t('legendDelivery')),
          item('keyRB', t('legendLanguage')),
        ),
        h('div', { className: 'gv-legend-row' },
          pair('keyUp', 'keyDown', t('legendSession'), 'sessions'),
          pair('keyLeft', 'keyRight', t('legendPanel'), 'panels'),
          item('keyBack', t('legendConversation')),
          item('keyStart', t('legendPage')),
        ),
      )
    }

    // ── styles ─────────────────────────────────────────────────────────────

    /**
     * Plugin-owned stylesheet. Layout and controls use only `--dsw-*` theme
     * tokens, so light, dark, and the user's font size follow the host.
     */
    const STYLES = `
.gv-page{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:1.6}
.gv-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.gv-content{max-width:900px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 64px}
.gv-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;padding-top:30px;margin-bottom:22px}
[data-platform=darwin] .gv-head{padding-top:calc(30px + var(--dsh-frame-top-clearance,0px))}
.gv-title{margin:0;font-size:22px;font-weight:600;line-height:30px;letter-spacing:-.01em}
.gv-subtitle{margin:5px 0 0;max-width:56ch;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.gv-badges{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:4px}
.gv-badge{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.gv-badge-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-caption)}
.gv-badge.is-ok .gv-badge-dot{background:var(--dsw-alias-state-business-primary)}
.gv-section{margin-top:22px}
.gv-section-title{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;line-height:22px}
.gv-card{padding:14px 16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.gv-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.gv-row:first-child{padding-top:0;border-top:0}
.gv-row:last-child{padding-bottom:0}
.gv-row-text{min-width:0}
.gv-row-label{font-size:13px;line-height:20px}
.gv-row-hint{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.gv-row-control{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.gv-switch{position:relative;flex:none;width:34px;height:20px;padding:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .15s,border-color .15s}
.gv-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:left .15s,background .15s}
.gv-switch.is-on{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary)}
.gv-switch.is-on .gv-switch-knob{left:16px;background:var(--dsw-alias-label-primary-foreground)}
.gv-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gv-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.gv-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gv-button:disabled{opacity:.45;cursor:default}
.gv-button-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.gv-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.gv-pad{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.gv-pad:first-of-type{border-top:0}
.gv-pad-name{min-width:0;font-size:13px;overflow-wrap:anywhere}
.gv-tag{flex:none;color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px}
.gv-details{margin-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.gv-details-summary{display:flex;align-items:center;gap:6px;padding:10px 0 4px;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px;list-style:none;cursor:pointer}
.gv-details-summary::-webkit-details-marker{display:none}
.gv-details-summary::before{content:'▸';flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;transition:transform .12s}
.gv-details[open] .gv-details-summary::before{transform:rotate(90deg)}
.gv-error-text{color:var(--dsw-alias-state-error-primary)}
.gv-map{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 16px;margin-top:2px;border-top:.5px solid var(--dsw-alias-border-l2)}
.gv-map-row{display:contents}
.gv-map-label{padding:7px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:13px;line-height:20px}
.gv-keys{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;padding:7px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.gv-key{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.gv-glyph{flex:none;box-sizing:border-box}
.gv-glyph-face{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#FFFFFF;font-family:var(--dsw-font-family,inherit);font-weight:700;line-height:1}
.gv-glyph-pill{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-width:18px;padding:0 5px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family,inherit);font-size:10px;font-weight:600;line-height:1;white-space:nowrap}
.gv-glyph-dpad{padding:0 4px;font-weight:500}
.gv-glyph-named{padding:0 6px}
.gv-glyph-named svg{display:block}
.gv-keyed-label{display:inline-flex;align-items:center;gap:5px}
.gv-legend{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:58;display:flex;flex-direction:column;gap:5px;max-width:min(370px,calc(100vw - 32px));padding:9px 11px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:color-mix(in oklab,var(--dsw-alias-bg-layer-2) 92%,transparent);box-shadow:var(--dsw-shadow-lv2);backdrop-filter:blur(6px);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family,inherit);font-size:11px;line-height:16px;pointer-events:none}
.gv-legend-head{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600}
.gv-legend-pad{min-width:0;overflow:hidden;color:var(--dsw-alias-label-caption);font-weight:400;text-overflow:ellipsis;white-space:nowrap}
.gv-legend-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px}
.gv-legend-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.gv-note{margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.gv-live-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 4px}
.gv-live-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px}
.gv-empty{padding:12px 0 2px}
.gv-empty-title{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600;line-height:20px}
.gv-empty-body{margin:3px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.gv-select{height:30px;max-width:240px;padding:0 26px 0 9px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.gv-select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.gv-segmented{display:inline-flex;overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm)}
.gv-segmented-item{height:28px;padding:0 11px;border:0;border-left:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.gv-segmented-item:first-child{border-left:0}
.gv-segmented-item.is-selected{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gv-segmented-item:hover:not(.is-selected){color:var(--dsw-alias-label-primary)}
.gv-talk{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 0 12px}
.gv-talk-button{display:inline-flex;align-items:center;justify-content:center;min-width:132px;height:36px;padding:0 16px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;font-weight:500;cursor:pointer;user-select:none;touch-action:none;transition:background .15s}
.gv-talk-button:hover{background:var(--dsw-alias-button-primary-hover)}
.gv-talk-button:disabled{opacity:.45;cursor:default}
.gv-talk-button.is-recording{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}
.gv-talk-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gv-level{display:inline-flex;align-items:flex-end;gap:2px;height:22px}
.gv-level-bar{display:block;width:3px;min-height:2px;border-radius:1px;background:var(--dsw-alias-label-caption)}
.gv-level.is-active .gv-level-bar{background:var(--dsw-alias-state-business-primary)}
.gv-level.is-compact{height:14px}
.gv-level.is-compact .gv-level-bar{width:2px;background:currentColor;opacity:.75}
.gv-talk-meta{display:flex;flex-direction:column;gap:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.gv-clock{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.gv-transcript{display:block;width:100%;min-height:84px;max-height:260px;margin-top:10px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;resize:vertical}
.gv-transcript:focus{border-color:var(--dsw-alias-state-business-primary)}
.gv-transcript::placeholder{color:var(--dsw-alias-label-caption)}
.gv-transcript-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.gv-transcript-actions .gv-button{height:28px;font-size:13px}
.gv-steps{margin:0;padding-left:20px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:22px}
.gv-steps li{margin:4px 0}
.gv-privacy{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.gv-stats{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.gv-page :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gv-hud{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;align-items:center;gap:9px;max-width:min(620px,calc(100vw - 32px));padding:9px 13px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);box-shadow:var(--dsw-shadow-lv2);font-family:var(--dsw-font-family,inherit);font-size:13px;line-height:20px;pointer-events:none;transform:translateX(-50%)}
.gv-hud-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-error-primary)}
.gv-hud-label{min-width:0;overflow-wrap:anywhere}
.gv-hud-clock{flex:none;font-variant-numeric:tabular-nums;opacity:.82}
.gv-hud-hint{flex:none;font-size:12px;opacity:.62}
.gv-hud.is-error .gv-hud-label{color:var(--dsw-alias-state-error-primary)}
@media (hover:none){.gv-talk-button:hover{background:var(--dsw-alias-button-primary-fill)}}
@media (width<=720px){.gv-head{padding-top:24px}.gv-content{padding-bottom:48px}.gv-map{grid-template-columns:minmax(0,1fr) auto}.gv-select{max-width:100%}}
@media (prefers-reduced-motion:reduce){.gv-switch,.gv-switch-knob,.gv-button,.gv-talk-button,.gv-segmented-item{transition:none}}
`

    // ── plugin ─────────────────────────────────────────────────────────────

    /** Services this browser plugin needs before it activates. */
    const inject = ['slots', 'locale', 'sessions', 'conversation', 'uiWorkspace', 'layout']

    /**
     * Contribute the sidebar entry, its page, the dictation HUD, and the global
     * gamepad loop.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, STRINGS), 'gamepad-voice: dictionaries')

      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshPlugin = PANEL_ID
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => style.remove()
      }, 'gamepad-voice: styles')

      const runtime = createRuntime(ctx, t)

      // The speech Remote is mounted by the optional Voice input bundle; the
      // plugin stays useful for gamepad control when that bundle is off.
      ctx.inject(['remote.speech'], (scope) => runtime.attachSpeech(scope))

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, locale: NS, label: () => t('panel') }, GamepadVoiceIcon),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ runtime }) }, GamepadVoicePage),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'gamepad-voice.hud', order: 90, locale: NS, inject: () => ({ runtime }) }, GamepadVoiceHud),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'gamepad-voice.legend', order: 89, locale: NS, inject: () => ({ runtime }) }, GamepadLegend),
      )
    }

    return { inject, apply }
  },
})
