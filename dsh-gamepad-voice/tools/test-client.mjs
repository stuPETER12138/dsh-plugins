#!/usr/bin/env node
/**
 * Browser-half test for `@local/dsh-gamepad-voice`.
 *
 * The client module cannot run in Node as-is: it is a `window.__ModuleLoader__`
 * factory and its page components need a real browser. This harness supplies a
 * fake loader, a fake React table, fake DOM timers, fake DSH client services,
 * a fake standard-mapping gamepad, and a fake microphone/MediaRecorder stack.
 * It then drives the same code paths a controller and a player press use:
 *
 *  - session, panel, send, stop, new-session, delivery and language bindings;
 *  - the enable switch;
 *  - push-to-talk capture, WAV encoding, speech-Remote transcription, and both
 *    transcript destinations (insert into the draft / send immediately);
 *  - cancellation and microphone-denial failure paths.
 *
 * It also statically checks that every literal translation key used by
 * `client.js` exists in both bundled dictionaries and that both dictionaries
 * carry the same keys.
 *
 * Usage:
 *   node tools/test-client.mjs
 *
 * Exit code 0 = all checks passed.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOLS = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(TOOLS)
const CLIENT = join(PLUGIN, 'client.js')

let checks = 0
const failures = []

function check(condition, message, detail) {
  checks += 1
  if (!condition) failures.push(detail === undefined ? message : `${message} :: ${detail}`)
}

function section(title) {
  process.stdout.write(`\n== ${title}\n`)
}

// ── fake browser environment ───────────────────────────────────────────────

const styleElements = []
const windowListeners = new Map()
const documentListeners = new Map()
function addListener(store, type, listener) {
  if (!store.has(type)) store.set(type, new Set())
  store.get(type).add(listener)
}
function removeListener(store, type, listener) {
  const set = store.get(type)
  if (set !== undefined) set.delete(listener)
}
function fireEvent(store, type, event = {}) {
  const set = store.get(type)
  if (set === undefined) return
  for (const listener of [...set]) listener(event)
}
const fakeDocument = {
  head: {
    appendChild(element) {
      styleElements.push(element)
      return element
    },
  },
  createElement(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      dataset: {},
      textContent: '',
      remove() {},
      appendChild() {},
    }
  },
  hasFocus() {
    return documentFocused
  },
  visibilityState: 'visible',
  addEventListener(type, listener) {
    addListener(documentListeners, type, listener)
  },
  removeEventListener(type, listener) {
    removeListener(documentListeners, type, listener)
  },
}
let documentFocused = true

const storage = new Map()
const timers = new Map()
let timerSeq = 1
const rafCallbacks = new Map()
let rafSeq = 1

const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      loadedSpec = spec
    },
  },
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null
    },
    setItem(key, value) {
      storage.set(key, String(value))
    },
    removeItem(key) {
      storage.delete(key)
    },
  },
  btoa(value) {
    return Buffer.from(String(value), 'binary').toString('base64')
  },
  setTimeout(callback, delay) {
    const id = timerSeq
    timerSeq += 1
    timers.set(id, { type: 'timeout', callback, delay, left: delay })
    return id
  },
  clearTimeout(id) {
    timers.delete(id)
  },
  setInterval(callback, delay) {
    const id = timerSeq
    timerSeq += 1
    timers.set(id, { type: 'interval', callback, delay })
    return id
  },
  clearInterval(id) {
    timers.delete(id)
  },
  addEventListener(type, listener) {
    addListener(windowListeners, type, listener)
  },
  removeEventListener(type, listener) {
    removeListener(windowListeners, type, listener)
  },
}
let loadedSpec = null

// ── fake microphone stack ──────────────────────────────────────────────────

class FakeAnalyser {
  constructor() {
    this.fftSize = 256
  }

  getFloatTimeDomainData(target) {
    target.fill(0.02)
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running'
  }

  createAnalyser() {
    return new FakeAnalyser()
  }

  createMediaStreamSource() {
    return { connect() {} }
  }

  async decodeAudioData() {
    return { duration: 1.4 }
  }

  async close() {
    this.state = 'closed'
  }
}

class FakeOfflineAudioContext {
  constructor(_channels, length, _rate) {
    this.length = length
  }

  createBufferSource() {
    return { buffer: null, connect() {}, start() {} }
  }

  async startRendering() {
    return { getChannelData: () => new Float32Array(this.length).fill(0.02) }
  }
}

class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream
    this.state = 'inactive'
    this.mimeType = 'audio/webm'
    this.ondataavailable = null
    this.onstop = null
    this.onerror = null
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    if (typeof this.ondataavailable === 'function') this.ondataavailable({ data: new Blob([new Uint8Array(64)]) })
    if (typeof this.onstop === 'function') this.onstop()
  }
}

const fakeStream = {
  getTracks: () => [{ stop() {} }],
  getAudioTracks: () => [{ label: 'Fake microphone', getSettings: () => ({ groupId: 'fake' }) }],
}

let micError = null
const navigatorProxy = {
  getGamepads: () => gamepadList,
  mediaDevices: {
    async getUserMedia() {
      if (micError !== null) throw micError
      return fakeStream
    },
  },
}

// ── fake gamepad ───────────────────────────────────────────────────────────

const gamepadList = []
const BUTTON_INDEX = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
}

function makePad(pressedNames = [], overrides = {}) {
  const pressed = new Set(pressedNames.map((name) => BUTTON_INDEX[name]))
  return {
    index: 0,
    id: 'Fake Xbox Controller',
    mapping: 'standard',
    connected: true,
    axes: [0, 0, 0, 0],
    timer: 0,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.has(index), value: pressed.has(index) ? 1 : 0 })),
    ...overrides,
  }
}

function setPressed(pressedNames) {
  gamepadList[0] = makePad(pressedNames)
}

/** Run one animation-frame tick with the current gamepad state. */
let frameClock = 1000
function stepFrame() {
  frameClock += 16
  const pending = [...rafCallbacks.entries()]
  rafCallbacks.clear()
  for (const [, callback] of pending) callback(frameClock)
}

async function settle(rounds = 10) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function press(names) {
  setPressed(names)
  stepFrame()
}

function release(names = []) {
  setPressed(names)
  stepFrame()
}

function stepFrames(count) {
  for (let index = 0; index < count; index += 1) stepFrame()
}

// ── fake DSH client services ───────────────────────────────────────────────

const calls = {
  openSession: [],
  selectPanel: [],
  send: [],
  cancel: 0,
  submit: 0,
  startSession: 0,
  draftInit: [],
  localeRegistrations: [],
  speech: { catalog: 0, transcribe: [], prepare: [] },
}

let activePanel = null
const sessionsById = {
  s1: { id: 's1', displayTitle: 'First session', running: false, retainedBy: { mainView: 1 }, blank: false, updatedAt: 2 },
  s2: { id: 's2', displayTitle: 'Second session', running: true, retainedBy: {}, blank: false, updatedAt: 1 },
  s3: { id: 's3', displayTitle: 'Subagent chat', running: false, retainedBy: {}, blank: false, origin: 'subagent', updatedAt: 0 },
}

const inputFacade = {
  state: { getSnapshot: () => ({ draft: 'hello from the draft' }) },
  submit() { calls.submit += 1 },
  focus() {},
  notify() {},
  setDraft() {},
}

const scopedConversation = {
  async send(text) { calls.send.push(text) },
  async cancel() { calls.cancel += 1 },
  input: { for: () => inputFacade },
}

const rootConversation = {
  input: {
    requestDraftInitialization(binding, options) {
      calls.draftInit.push({ sessionId: binding.sessionId, options })
      return 'applied'
    },
  },
}

const sessionsService = {
  list: {
    getSnapshot: () => ({
      ids: ['s1', 's2'],
      byId: sessionsById,
      phase: 'ready',
      projectionsBySession: {},
    }),
    subscribe: () => () => {},
  },
  scope(id) {
    return sessionsById[id] === undefined ? undefined : { get: (name) => (name === 'conversation' ? scopedConversation : undefined) }
  },
  binding(id) {
    return sessionsById[id] === undefined ? undefined : { sessionId: id, session: { sessionId: id } }
  },
}

const layoutService = {
  panelInfo: { getSnapshot: () => ({ activePanelId: activePanel }) },
  selectPanel(panelId) {
    activePanel = panelId
    calls.selectPanel.push(panelId)
  },
}

const uiWorkspaceService = {
  openSession(sessionId) { calls.openSession.push(sessionId) },
  startSession() { calls.startSession += 1 },
}

const speechFaults = { transcribe: false, catalog: false, prepare: false }
const catalogValue = {
  providers: [
    { id: 'sensevoice-local', name: 'SenseVoice', location: 'host-local', languages: ['auto', 'zh', 'en', 'ja'], preparation: { phase: 'ready' } },
  ],
  selection: { providerId: 'sensevoice-local', language: 'auto' },
  maxAudioBytes: 4 * 1024 * 1024,
  maxDurationSeconds: 120,
}
const speechService = {
  async catalog() {
    calls.speech.catalog += 1
    if (speechFaults.catalog) return { ok: false, error: { code: 'speech/transcription-failed', message: 'catalog offline' } }
    return { ok: true, value: catalogValue }
  },
  async transcribe(request) {
    calls.speech.transcribe.push(request)
    if (speechFaults.transcribe) return { ok: false, error: { code: 'speech/transcription-failed', message: 'engine rejected the audio' } }
    return { ok: true, value: { text: '你好 DSH', audioSeconds: 1.4, inferenceSeconds: 0.2 } }
  },
  async prepare(...args) {
    calls.speech.prepare.push(args)
    return speechFaults.prepare ? { ok: false, error: { code: 'speech/transcription-failed', message: 'prepare failed' } } : { ok: true, value: undefined }
  },
}

const slotRegistrations = []
const effects = []

const ctx = {
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') effects.push(dispose)
    return dispose
  },
  inject(dependencies, callback) {
    if (!dependencies.includes('remote.speech')) return
    const scope = {
      remote: { speech: speechService },
      get: (name) => (name === 'remote.speech' ? speechService : undefined),
      effect(callback2) {
        const dispose = callback2()
        if (typeof dispose === 'function') effects.push(dispose)
        return dispose
      },
    }
    callback(scope)
  },
  get(name) {
    if (name === 'sessions') return sessionsService
    if (name === 'conversation') return rootConversation
    if (name === 'layout') return layoutService
    if (name === 'uiWorkspace') return uiWorkspaceService
    return undefined
  },
  locale: {
    register(namespace, dictionaries) {
      calls.localeRegistrations.push({ namespace, dictionaries })
      return () => {}
    },
    bind() {
      return (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)
    },
  },
  slots: {
    inject(_name, callback) { callback() },
    register(options, component) {
      slotRegistrations.push({ options, component })
      return () => {}
    },
    entriesOfSlot(name) {
      if (name !== 'sidebar.panellist') return []
      return [{ options: { id: 'plugins' } }, { options: { id: 'gamepad-voice' } }, { options: { id: 'sticky-wall' } }]
    },
    entries(name) {
      if (name !== 'main') return []
      return [{ options: { key: 'plugins' } }, { options: { key: 'gamepad-voice' } }, { options: { key: 'sticky-wall' } }]
    },
  },
}

// ── install globals, then load the client module ───────────────────────────

globalThis.window = fakeWindow
globalThis.document = fakeDocument
// Node exposes a read-only `navigator` getter; the client module needs ours.
Object.defineProperty(globalThis, 'navigator', { value: navigatorProxy, configurable: true, writable: true })
globalThis.AudioContext = FakeAudioContext
globalThis.OfflineAudioContext = FakeOfflineAudioContext
globalThis.MediaRecorder = FakeMediaRecorder
globalThis.requestAnimationFrame = (callback) => {
  const id = rafSeq
  rafSeq += 1
  rafCallbacks.set(id, callback)
  return id
}
globalThis.cancelAnimationFrame = (id) => { rafCallbacks.delete(id) }

await import(new URL('../client.js', import.meta.url))

section('bundle module')
check(loadedSpec !== null, 'client module registers through window.__ModuleLoader__')
check(loadedSpec?.id === '@local/dsh-gamepad-voice', 'module id is the package name', loadedSpec?.id)
const factory = loadedSpec?.factory
check(typeof factory === 'function', 'module exposes a factory')

const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
  useEffect() {},
  useMemo(factoryFn) { return factoryFn() },
  useRef(value) { return { current: value } },
  useState(value) { return [value, () => {}] },
}

const plugin = factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require: ${name}`)
})

check(Array.isArray(plugin.inject), 'plugin returns an inject list')
for (const service of ['slots', 'locale', 'sessions', 'conversation', 'uiWorkspace', 'layout']) {
  check(plugin.inject.includes(service), `plugin injects ${service}`)
}
check(typeof plugin.apply === 'function', 'plugin returns apply()')

plugin.apply(ctx)
await settle()

section('slot and style registration')
check(styleElements.length === 1, 'one plugin stylesheet is attached')
check(styleElements[0]?.dataset?.dshPlugin === 'gamepad-voice', 'stylesheet carries the plugin marker')
check(calls.localeRegistrations.length === 1, 'one locale namespace is registered')
check(calls.localeRegistrations[0]?.namespace === 'gamepadVoice', 'locale namespace is gamepadVoice')
const panellist = slotRegistrations.find((entry) => entry.options.name === 'sidebar.panellist')
const mainPanel = slotRegistrations.find((entry) => entry.options.name === 'main')
check(panellist?.options.id === 'gamepad-voice', 'sidebar entry id is gamepad-voice')
check(typeof panellist?.options.label === 'function' && panellist.options.label() === 'panel', 'sidebar label is localized through the translator')
check(mainPanel?.options.key === 'gamepad-voice', 'main slot key matches the sidebar id')
check(typeof mainPanel?.component === 'function', 'main slot registers a component')
const overlayEntries = slotRegistrations.filter((entry) => entry.options.name === 'shell.overlay')
const hud = overlayEntries.find((entry) => entry.options.id === 'gamepad-voice.hud')
const legendEntry = overlayEntries.find((entry) => entry.options.id === 'gamepad-voice.legend')
check(hud?.options.id === 'gamepad-voice.hud', 'overlay HUD entry id is registered')
check(typeof hud?.component === 'function', 'overlay HUD registers a component')
check(legendEntry?.options.id === 'gamepad-voice.legend', 'overlay legend entry id is registered')
check(typeof legendEntry?.component === 'function', 'overlay legend registers a component')
const panelPage = mainPanel?.component
const injected = mainPanel?.options?.inject
check(typeof injected === 'function' && injected().runtime !== undefined, 'page receives the runtime through its inject face')
const runtime = injected().runtime

section('speech catalog (RemoteResult envelope)')
{
  const voice = runtime.stores.voice.get()
  check(voice.checked === true, 'the first catalog read marks voice as checked')
  check(voice.available === true, 'the speech Remote is reported available')
  check(voice.providerId === 'sensevoice-local', 'the selected provider comes from the envelope value', voice.providerId)
  check(voice.providerName === 'SenseVoice', 'the provider name is read from the envelope value')
  check(voice.readiness === 'ready', 'provider readiness is read from the envelope value')
  check(voice.languages.includes('zh'), 'provider languages are read from the envelope value')
  check(voice.maxSeconds === 120, 'the recording limit comes from the catalog', voice.maxSeconds)
  check(calls.speech.catalog >= 1, 'the catalog was requested')
}

section('controller discovery')
check(runtime.stores.pads.get().supported === true, 'gamepads are reported as supported')
check(runtime.stores.pads.get().pads.length === 0, 'no controller is listed before one connects')
setPressed([])
stepFrame()
check(runtime.stores.pads.get().pads.length === 1, 'a connected controller is discovered')
check(runtime.stores.pads.get().pads[0].mapping === 'standard', 'standard mapping is preserved')

section('gamepad bindings')
press(['DOWN'])
check(calls.openSession.at(-1) === 's2', 'D-pad down opens the next session', JSON.stringify(calls.openSession))
release()
press(['UP'])
check(calls.openSession.at(-1) === 's2', 'D-pad up wraps to the previous session', JSON.stringify(calls.openSession))
release()
press(['LEFT'])
check(calls.selectPanel.at(-1) === 'sticky-wall', 'D-pad left cycles to the previous panel', JSON.stringify(calls.selectPanel))
release()
press(['LEFT'])
check(calls.selectPanel.at(-1) === 'gamepad-voice', 'D-pad left reaches this plugin page')
release()
press(['RIGHT'])
check(calls.selectPanel.at(-1) === 'sticky-wall', 'D-pad right cycles to the next panel')
release()
press(['RIGHT'])
check(calls.selectPanel.at(-1) === null, 'D-pad right wraps back to the conversation')
release()
press(['A'])
check(calls.submit === 1, 'A submits the current draft')
release()
press(['B'])
check(calls.cancel === 1, 'B cancels the running turn')
release()
press(['X'])
check(calls.startSession === 1, 'X starts a new session')
release()
press(['START'])
check(calls.selectPanel.at(-1) === 'gamepad-voice', 'Start opens the controller page')
release()
press(['BACK'])
check(calls.selectPanel.at(-1) === null, 'Back returns to the conversation')
release()
const deliveryBefore = runtime.stores.settings.get().delivery
press(['LB'])
release()
check(runtime.stores.settings.get().delivery === deliveryBefore, 'a short LB tap does not change the transcript destination')
check(runtime.stores.notice.get().text.length > 0, 'a short LB tap explains the hold action')
press(['LB'])
stepFrames(50)
release()
const deliveryAfter = runtime.stores.settings.get().delivery
check(deliveryAfter !== deliveryBefore, 'holding LB toggles the transcript destination', `${deliveryBefore} -> ${deliveryAfter}`)
press(['LB'])
stepFrames(50)
release()
check(runtime.stores.settings.get().delivery === deliveryBefore, 'holding LB toggles the destination back')
press(['RB'])
check(runtime.stores.settings.get().language === 'auto', 'RB cycles the recognition language', runtime.stores.settings.get().language)
release()
press(['RB'])
check(runtime.stores.settings.get().language === 'zh', 'RB continues through the language list', runtime.stores.settings.get().language)
release()
runtime.setLanguage('')

section('disabled and unfocused controller')
runtime.setEnabled(false)
press(['A'])
check(calls.submit === 1, 'disabled controller input does nothing')
release()
runtime.setEnabled(true)
documentFocused = false
press(['A'])
check(calls.submit === 1, 'controller input is ignored while the window is unfocused')
release()
documentFocused = true

section('hold-to-talk transcription into the draft')
press(['Y'])
await settle()
check(runtime.stores.voice.get().phase === 'recording', 'holding Y starts recording', runtime.stores.voice.get().phase)
release()
await settle(16)
check(runtime.stores.voice.get().phase === 'idle', 'releasing Y settles back to idle', runtime.stores.voice.get().phase)
check(calls.speech.transcribe.length === 1, 'one transcription request is sent')
const request = calls.speech.transcribe[0]
check(typeof request?.audioBase64 === 'string' && request.audioBase64.length > 0, 'the request carries base64 audio')
const wav = Buffer.from(request?.audioBase64 ?? '', 'base64')
check(wav.subarray(0, 4).toString('ascii') === 'RIFF', 'the recording is a RIFF WAV')
check(wav.subarray(8, 12).toString('ascii') === 'WAVE', 'the WAV header names WAVE')
check(wav.readUInt32LE(24) === 16000, 'the WAV uses a 16 kHz sample rate', wav.readUInt32LE(24))
check(runtime.stores.voice.get().transcript === '你好 DSH', 'the transcript reaches the page state')
check(calls.draftInit.length === 1, 'the transcript initializes the current draft')
check(calls.draftInit[0]?.options?.prompt === '你好 DSH', 'the draft prompt is the transcript', JSON.stringify(calls.draftInit[0]))
check(calls.draftInit[0]?.options?.whenDraftExists === 'append', 'existing draft text is appended to, not replaced')

section('hold-to-talk with immediate send')
runtime.setDelivery('send')
press(['Y'])
await settle()
check(runtime.stores.voice.get().phase === 'recording', 'a second hold starts recording again')
release()
await settle(16)
check(calls.speech.transcribe.length === 2, 'a second transcription request is sent')
check(calls.send.at(-1) === '你好 DSH', 'the transcript is sent immediately in send mode', JSON.stringify(calls.send))
runtime.setDelivery('draft')

section('cancel and failure paths')
const transcriptionsBeforeCancel = calls.speech.transcribe.length
press(['Y'])
await settle()
check(runtime.stores.voice.get().phase === 'recording', 'recording starts for the cancellation case')
press(['B'])
await settle(4)
check(runtime.stores.voice.get().phase === 'idle', 'B cancels an active recording')
check(calls.speech.transcribe.length === transcriptionsBeforeCancel, 'a cancelled recording is never transcribed')
check(calls.cancel === 1, 'cancelling a recording does not stop the agent turn')
release()
micError = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
press(['Y'])
await settle(8)
check(runtime.stores.voice.get().phase === 'idle', 'a denied microphone returns to idle')
check(runtime.stores.voice.get().mic === 'denied', 'a denied microphone is reported as denied')
check(runtime.stores.notice.get().kind === 'error', 'microphone denial shows an error notice')
release()
micError = null

section('page transcript actions')
calls.draftInit.length = 0
const delivered = await runtime.deliverText('  a second take  ', 'draft')
check(delivered === true, 'the page can insert an edited transcript')
check(calls.draftInit.length === 1 && calls.draftInit[0].options.prompt === 'a second take', 'edited transcript text is trimmed and inserted')
await runtime.deliverText('sent by hand', 'send')
check(calls.send.at(-1) === 'sent by hand', 'the page can send an edited transcript directly')

section('RemoteResult failures and recovery')
{
  const draftBefore = calls.draftInit.length
  const transcribeBefore = calls.speech.transcribe.length
  speechFaults.transcribe = true
  press(['Y'])
  await settle()
  check(runtime.stores.voice.get().phase === 'recording', 'recording still starts with a ready catalog')
  release()
  await settle(16)
  check(calls.speech.transcribe.length === transcribeBefore + 1, 'the failing transcription call was made')
  check(runtime.stores.voice.get().lastError.length > 0, 'an envelope business failure is stored as the last error', runtime.stores.voice.get().lastError)
  check(calls.draftInit.length === draftBefore, 'a failed transcription never delivers text')
  speechFaults.transcribe = false

  speechFaults.catalog = true
  await runtime.refreshCatalog()
  check(runtime.stores.voice.get().catalogError.includes('catalog offline'), 'a catalog envelope failure becomes a visible error', runtime.stores.voice.get().catalogError)
  check(runtime.stores.voice.get().checked === true, 'a failed catalog read still marks voice as checked')
  speechFaults.catalog = false
  await runtime.refreshCatalog()
  check(runtime.stores.voice.get().catalogError === '', 'a later catalog read clears the error')

  await runtime.prepareModel()
  check(calls.speech.prepare.at(-1)?.[0] === 'sensevoice-local', 'prepare is called with the selected provider')
  check(calls.speech.prepare.at(-1)?.length === 2, 'prepare supplies the optional options argument the Remote descriptor requires', JSON.stringify(calls.speech.prepare.at(-1)))
  speechFaults.prepare = true
  await runtime.prepareModel()
  check(runtime.stores.notice.get().kind === 'error', 'a prepare failure is surfaced instead of silently ignored')
  speechFaults.prepare = false
}

section('recording safety and lifecycle')
{
  const transcribeBefore = calls.speech.transcribe.length
  press(['Y'])
  await settle()
  check(runtime.stores.voice.get().phase === 'recording', 'recording starts for the disconnect case')
  gamepadList.length = 0
  stepFrame()
  await settle(16)
  check(runtime.stores.voice.get().phase === 'idle', 'a controller disconnect ends the recording')
  check(calls.speech.transcribe.length === transcribeBefore + 1, 'a controller-loss recording is still transcribed')
  gamepadList[0] = makePad([])
  stepFrame()
  check(runtime.stores.pads.get().pads.length === 1, 'the controller is discovered again after reconnecting')
  release()

  const beforeBlur = calls.speech.transcribe.length
  press(['Y'])
  await settle()
  check(runtime.stores.voice.get().phase === 'recording', 'recording starts for the blur case')
  fireEvent(windowListeners, 'blur')
  await settle(16)
  check(runtime.stores.voice.get().phase === 'idle', 'a window blur ends the recording')
  check(calls.speech.transcribe.length === beforeBlur + 1, 'a blur-ended recording is still transcribed')
  release()

  const beforeEscape = calls.speech.transcribe.length
  press(['Y'])
  await settle()
  check(runtime.stores.voice.get().phase === 'recording', 'recording starts for the Escape case')
  fireEvent(windowListeners, 'keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
  await settle(6)
  check(runtime.stores.voice.get().phase === 'idle', 'Escape cancels the recording')
  check(calls.speech.transcribe.length === beforeEscape, 'an Escape-cancelled recording is never transcribed')
  release()
}

section('session, limits, and page helpers')
{
  const before = runtime.stores.voice.get().maxSeconds
  catalogValue.maxAudioBytes = 320000
  await runtime.refreshCatalog()
  check(runtime.stores.voice.get().maxSeconds === 10, 'the byte limit caps the recording duration', runtime.stores.voice.get().maxSeconds)
  catalogValue.maxAudioBytes = 4 * 1024 * 1024
  await runtime.refreshCatalog()
  check(runtime.stores.voice.get().maxSeconds === before, 'the duration returns after the byte limit is lifted')

  sessionsById.s1.retainedBy = {}
  sessionsById.s3.retainedBy = { mainView: 1 }
  check(runtime.currentSessionId() === 's3', 'a subagent conversation retained by the main view is the current session', runtime.currentSessionId())
  sessionsById.s3.retainedBy = {}
  sessionsById.s1.retainedBy = { mainView: 1 }
  check(runtime.currentSessionId() === 's1', 'the ordinary current session is restored')
}

section('standby providers and legend preference')
{
  catalogValue.providers[0].preparation.phase = 'standby'
  await runtime.refreshCatalog()
  check(runtime.stores.voice.get().readiness === 'standby', 'a downloaded-but-unloaded provider reports standby')
  press(['Y'])
  await settle()
  check(runtime.stores.voice.get().phase === 'recording', 'standby is treated as usable for recording')
  fireEvent(windowListeners, 'keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
  await settle(6)
  release()
  check(runtime.stores.voice.get().phase === 'idle', 'the standby recording can be cancelled')
  catalogValue.providers[0].preparation.phase = 'ready'
  await runtime.refreshCatalog()

  check(runtime.stores.settings.get().legend === true, 'the button legend is on by default')
  runtime.setLegend(false)
  check(runtime.stores.settings.get().legend === false, 'the button legend can be turned off')
  runtime.setLegend(true)
  check(runtime.stores.settings.get().legend === true, 'the button legend can be turned back on')
}

section('translation dictionaries')
const source = readFileSync(CLIENT, 'utf8')
const stringsStart = source.indexOf('const STRINGS = {')
check(stringsStart >= 0, 'client.js declares the STRINGS table')
const openBrace = source.indexOf('{', stringsStart)
let depth = 0
let closeBrace = -1
for (let index = openBrace; index < source.length; index += 1) {
  const character = source[index]
  if (character === '{') depth += 1
  else if (character === '}') {
    depth -= 1
    if (depth === 0) {
      closeBrace = index
      break
    }
  }
}
check(closeBrace > openBrace, 'the STRINGS table is a complete object literal')
const dictionaries = Function(`"use strict"; return (${source.slice(openBrace, closeBrace + 1)})`)()
check(dictionaries.zh !== undefined && dictionaries.en !== undefined, 'both zh and en dictionaries exist')
const zhKeys = new Set(Object.keys(dictionaries.zh))
const enKeys = new Set(Object.keys(dictionaries.en))
const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key))
const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key))
check(missingInEn.length === 0, 'every zh key exists in en', missingInEn.join(', '))
check(missingInZh.length === 0, 'every en key exists in zh', missingInZh.join(', '))
const literalKeys = new Set([...source.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]))
for (const key of literalKeys) {
  check(zhKeys.has(key) && enKeys.has(key), `translation key "${key}" exists in both dictionaries`)
}
const actionLabels = [...source.matchAll(/label: '([^']+)'/g)].map((match) => match[1])
for (const key of actionLabels) {
  check(zhKeys.has(key) && enKeys.has(key), `action label key "${key}" exists in both dictionaries`)
}
check(zhKeys.has('keyUp') && enKeys.has('keyUp'), 'button keycaps are translated')
check(zhKeys.has('readinessReady') && enKeys.has('readinessReady'), 'provider readiness states are translated')
check(zhKeys.has('languageAuto') && enKeys.has('languageAuto'), 'speech languages are translated')

section('result')
process.stdout.write(`\n${checks} checks, ${failures.length} failure(s)\n`)
if (failures.length > 0) {
  for (const failure of failures) process.stdout.write(`FAIL  ${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('test-client: OK\n')
}
