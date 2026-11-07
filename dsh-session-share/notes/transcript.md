# Transcript folder — discovery notes (`src/transcript.js`)

> 历史设计笔记：记录当时的调研与实现思路，部分细节可能已随代码演进变化。以 README 与 `src/transcript.js` 的实际代码为准。

Owner: transcript-scout (task-1). Pure host-side fold of one DSH session log into the
share payload consumed by the browser half. No Node imports, no I/O, no clock.

## Sources inspected

- Shipped package README:
  `D:\Software\DeepseekHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-session\README.md`
  (event vocabulary, surface events, `session.append(type, data, opts)` contract).
- Built code:
  `D:\Software\DeepseekHarness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-session\lib\index.js`
  — `KNOWN_SESSION_EVENT_TYPES` (lines 79–142), `SURFACE_EVENT_TYPES` (157–163),
  `isAppendSurfaceEvent` doc comment (184–194).
- Live logs: 231 files under `$DSH_HOME\sessions\<project>\<session>\session.vN.jsonl.zstd`.
  12 newest logs were scanned for event shapes; 40 for `surfaceOp` variants.
  Files are multi-frame zstd JSONL: first line = session header, then one event per line.

## Exact event type strings (confirmed)

| Purpose | Exact `event.type` | Payload facts used |
|---|---|---|
| Human prompt | `user/message` | `data.content[]` parts `{type:'text',text}` / `{type:'image',attachment}`, `data.source.kind` |
| Assistant reply | `assistant/message` | `data.message.content[]` parts `reasoning` / `text` / `tool-call`, `data.message.source.{provider,model}`, `data.turn/step`, optional `data.interrupted` |
| Tool start | `tool/call` | `data.callId`, `data.name`, `data.arguments` (JSON **string**), `data.turn/step` |
| Tool result | `tool/result` | `data.message.toolCallId`, `data.message.isError`, optional `data.error = {name,code}`, `data.meta` |
| Title | `session/title` | `data.title`, `data.source.kind` (`fallback` / `provider` / `user`) |

Deliberately ignored (all seen live): `session/title-llm-request`, `assistant/attempt`,
`system/message`, `developer/message`, `compaction/{start,end,prune,summary}`,
`request/header`, `request/context`, `model/selection`, `step/start`, `step/end`,
`turn/start`, `turn/end`, `agent/inbox/spliced`, `job/*`, `approval/*`, `team/*`,
`subagent/*`, `todo/write`, `workspace/changes`, `session/end-seed`, `unknown/event`.
`KNOWN_SESSION_EVENT_TYPES` in the shipped lib was used to cross-check the vocabulary.

Header line (v4, durable log; note: **no `title` field**):

```json
{"type":"session","version":4,"id":"session-a2a9d49a-8128-4d8f-8e02-e5ae177a5c06","createdAt":1793981816706,"cwd":"D:\\workspace\\demo-project","isSeeded":false,"delegationDepth":0,"agentPreset":"cordis"}
```

## Evidence samples (trimmed from real logs; `time`/`usage`/`stream`/`replayState` cut for length)

Human prompt (`session-a2a9d49a-…/session.v4.jsonl.zstd`, seq 8):

```json
{"type":"user/message","seq":8,"time":1793981865762,"data":{"content":[{"type":"text","text":"创建一个 DSH 会话视图插件。可以有选择地以markdown或者图片/pdf的形式分享当前对话内容"}],"source":{"kind":"user","rpcId":"a4e1b6b7-…","clientTimeZone":"Asia/Shanghai"},"role":"user","id":"e06db77d-…"},"surfaceOp":"append"}
```

Assistant reply (same log, seq 17 — note the mixed `reasoning` + `text` + `tool-call` content):

```json
{"type":"assistant/message","seq":17,"time":1793981869985,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"reasoning","text":"…"},{"type":"text","text":"I'll start by loading the relevant skills for plugin development in this harness."},{"type":"tool-call","id":"call_37b1bffa0b894f17861a67c7","name":"skill","arguments":"{\"name\":\"cordis-plugin-development\"}"}],"source":{"kind":"model","provider":"opencode-go","model":"deepseek-v4.1-flash"},"id":"48693561-…"},"usage":{"inputTokens":11708,"outputTokens":256,"totalTokens":12988,"cacheReadTokens":1024}},"surfaceOp":"append"}
```

Tool call (`skill`):

```json
{"type":"tool/call","seq":18,"time":1793981869985,"data":{"turn":1,"step":1,"callId":"call_37b1bffa0b894f17861a67c7","name":"skill","arguments":"{\"name\":\"cordis-plugin-development\"}"}}
```

Failed tool result (same log, seq 78; `data.error` present only on failures):

```json
{"type":"tool/result","seq":78,"data":{"turn":1,"step":5,"message":{"role":"tool","source":{"kind":"tool","callId":"call_…"},"toolCallId":"call_…","content":[{"type":"text","text":"Error: Client Cordis inspect Slots.listSubTree rejected input: \"input\" must be an object"}],"isError":true,"id":"…"}}}
```

Successful tool result shape: same minus `data.error`, with `"isError":false` (1703 of 1745 live
results); failures carried `data.error = {"name":…,"code":…}` (33) or only `isError:true` (9).

Title events (last wins; same log):

```json
{"type":"session/title","seq":14,"data":{"title":"创建一个 DSH 会话视图插件。","messageSeqs":[8],"source":{"kind":"fallback"}}}
{"type":"session/title","seq":16,"data":{"title":"DSH会话内容分享插件","messageSeqs":[8],"source":{"kind":"provider","provider":"session-title-first-prompt-llm","model":{"provider":"opencode-go","model":"deepseek-v4.1-flash"}}}}
```

Image part inside `user/message` (`session-ef02653d-…`):

```json
{"type":"image","attachment":{"attachmentId":"sha256:1d517c63…","mediaType":"image/jpeg","width":1024,"height":765,"bytes":88514,"name":"Untitled.webp"}}
```

## Live-log statistics that drove the fold rules (12 newest sessions)

- `user/message` 171 total, by `data.source.kind`:
  `user` 54, `time-context` 55, `runtime-context` 21, `skill-catalog` 13,
  `subagent-settled` 11, `model-selection` 7, `agent-message` 6, `user-approval` 2,
  `session-reference` 1, `compact-checkpoint` 1. Content parts: `text` 200, `image` 3.
  → only `kind === 'user'` is a human prompt; everything else is injected context.
  Image-only human prompts exist (4 found), so they are kept with `text: ''` + `images`.
- `assistant/message` 1129 total: 110 have non-empty `text`, 1019 have none
  (pure `reasoning` + `tool-call` steps). Content parts: `reasoning` 1029,
  `tool-call` 1697, `text` 110. Whitespace-only text blocks (`"\n\n"`) occur 39×.
  Models seen: `deepseek-account/deepseek-flash` 600, `opencode-go/deepseek-v4.1-flash` 527,
  `intern/deepseek-v4.1-flash-1017` 2. `assistant/attempt` is `{turn,step,stream}` only
  (failed/retried attempt, no message) → ignored.
- `tool/call` 1697 / `tool/result` 1745; `tool/call.data.arguments` is always a JSON string
  (e.g. `read {file_path}`, `pwsh {command,description}`, `glob {pattern}`, `grep {pattern,path}`,
  `web_search {queries}`, `team_task_get {task_id}`, `skill {name}`, `present {files}`).
- `session/title` 20, `source.kind`: `fallback` 10, `provider` 7, `user` 3. Title is always a string.
- `surfaceOp` on surface events: `user/message` `"append"` 296 vs `{op:'replace',…}` 6;
  `assistant/message` `"append"` 1875. The shipped lib says replacement copies are model-only:
  “a landed replacement would erase conversation the user already saw. Append-origin events are
  that transcript’s durable source material” (`isAppendSurfaceEvent`, lib/index.js:184–194).
  → `{op:'replace'}` copies are skipped here.

## Fold rules implemented

1. `user/message`: keep append-origin events whose `data.source.kind` is `'user'` (missing kind is
   treated as human for older/synthetic logs); join non-empty text parts with `\n\n`, preserve inner
   newlines, count `image` parts into `item.images` and keep their JSON-safe refs in
   `item.imageRefs` (`attachmentId`, `mediaType`, `width`, `height`, `bytes`, `name`) so the Host
   route can resolve the stored bytes; skip when no text and no image.
2. `assistant/message`: keep append-origin events with at least one non-empty `text` part
   (reasoning and tool-call-only steps are invisible); join text parts with `\n\n`;
   `item.model` = `data.message.source.model`; optional `item.provider` = source.provider.
   Model/provider are captured from every assistant message, including invisible tool-use steps.
3. `tool/call` → one grouped `kind:'tool'` item per contiguous run of tool activity (a run ends at
   the next visible user/assistant item): `text: "调用了 N 个工具"`, `toolCalls[]` entries
   `{name, title, detail?, status?}`. `status` comes from the matching `tool/result` by
   `callId`/`toolCallId` (`isError` or `data.error` → `'error'`, else `'ok'`; no result → omitted).
   `title` picks the first non-empty of description / file_path / pattern / path / url / task_id /
   job_id / agent_id / target / name / title / command / query, then `queries`, `files[].path`,
   `questions[].question`, `N 项待办`, `prompt`; `detail` = clipped command/message/prompt.
4. `session/title`: last non-empty `data.title` wins; fallback `header.title`; else `''`.
5. `session.updatedAt` = time of the last included event (visible item or tool call), else
   `header.createdAt`; `session.createdAt` = `header.createdAt`; `cwd` = `header.cwd` or null;
   `session.model` = last assistant model, fallback last `request/context` / `model/selection` model.
6. `options.maxTextChars` clips each visible item’s text (append `…`); the Host route passes
   200_000. `options.includeTools:false` drops tool items. `options.userSourceKinds` overrides the
   human-prompt kinds. Tool title/detail clips default to 120 / 240 chars.
7. Robustness: every event is folded inside `try/catch`; non-object events are skipped; a missing
   `seq` falls back to the array index; a missing `time` becomes `null`; malformed data never throws.

## Contract deviation (additive only)

The required item shape is produced exactly. Two **optional additive** fields are added when known:
`item.provider` (assistant items) and `session.provider` (plain provider id); `model` remains the
plain model id (`deepseek-v4.1-flash`), not a `provider/model` composite. Everything else matches
`{ id, kind, seq, time, text, images?, model?, toolCalls? }` / `{ session: { id, title, cwd,
createdAt, updatedAt, model } }`.

## Test

`tools/test-transcript.mjs`, run from the plugin directory with the bundled Node:

```powershell
node tools/test-transcript.mjs
```

It asserts the synthetic fixture above (order, kinds, text/newlines, images, tool grouping and
statuses, title/model/updatedAt, id uniqueness, malformed tolerance, option handling) and then
folds the newest readable real `session.vN.jsonl[.zstd]` under `$DSH_HOME/sessions`
(`~/.dsh/sessions` by default), SKIPping gracefully when none is readable. It prints one
PASS/FAIL/SKIP line per check plus `SUMMARY pass=… fail=… skip=…` and exits non-zero on failure.
The zstd reader is a local multi-frame decoder because `zlib.zstdDecompressSync` only decodes the
first frame; a torn tail from a session still being written is tolerated.

## Remaining uncertainty

- Tool grouping is per contiguous run of tool activity, so a turn whose assistant steps have no
  visible text produces **one** `调用了 N 个工具` item for the whole turn. If the UI wants per-step
  granularity, split the run on every `assistant/message` instead (one-line change).
- `item.time` for a tool group is its first `tool/call` time; `session.updatedAt` tracks the last
  contributing event, so it can be slightly later than the last item’s `time`.
- The real-session test picks the newest log by mtime, which may be the currently running session;
  that is intentional (live-log evidence) and torn tails are skipped.
- `kind:'note'` is reserved by the shape but never emitted today.
- Compaction is not replayed: original pre-compaction user/assistant messages stay in the transcript
  and `compact-checkpoint` injected user messages are skipped.
