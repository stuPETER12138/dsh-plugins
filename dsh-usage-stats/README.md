# Usage Stats — `@local/dsh-usage-stats`

A DSH Web plugin that answers "what has this machine actually spent?" from
**this machine's own session logs** — no telemetry, no network calls, no copy of
the conversation text.

It adds one entry to the left sidebar and one dashboard panel, which opens on the
**last 7 days** (switchable to 30 days, 90 days, or all time). Every figure except
the lifetime session total follows that range:

- **Hero + KPI row** — the period's total tokens, daily average, requests and
  cost, then three cards: total tokens (input / output / cache split), sessions
  active in the period, and estimated cost. The token and cost cards compare the
  finished days of the selected range with the equally long window before it, so a
  partial today can never fake a decline.
- **Token 时间线** — stacked per-day bars (input, output, cache reads, cache
  writes) with hover and keyboard detail, a dashed daily-average line, and a peak
  marker. Days without usage are real gaps, not compressed neighbours. Cache reads
  own the accent color because they are usually the bulk of the tokens.
- **成本构成** — a single full-width card: a donut of spend by model for the
  selected range on the left, a one-per-row ranked legend on the right (vendor ·
  model, cost, share, fallback-price notice).
- **会话明细** — a single full-width table, kept compact: exactly six rows tall with
  its own scroll area. Per-session tokens, cost, models, cache hit rate, turns,
  requests and tool calls **for the selected range**, with the session's whole-life
  figures beside them in the detail panel; sortable, searchable, expandable.

## How it gets the data

| Figure | Source |
|---|---|
| Tokens and cost | `assistant/message.usage` events in each stored session log |
| Sessions, titles, activity | `sessionPersistence.list()` snapshots plus one read per changed log |
| Live sessions | the in-memory `sessions` session store, folded forward event by event |

Stored logs are read through the public `sessionPersistence` service (with
`sessionQuery.readSession()` as a fallback for older log formats), so the plugin
never parses files and never depends on the on-disk log format. A session summary
is cached against its persistence revision: reopening the panel re-reads only the
logs that changed, and a live session costs only the events committed since the
previous poll.

Forked sessions carry their parent's history as an inherited prefix; that prefix
is skipped, so a fork never double-counts its parent's tokens.

## What it indexes, and why a cold pass is slow

The scan reads **every stored session log once** — the same zstd-compressed JSONL
files under `$DSH_HOME/sessions` that the session store writes. For each session it
walks the events and keeps only a small summary (token totals, per-model and per-day
buckets, title, counts): roughly 2–3 KB per session, whatever the log size. A
session's own inherited fork prefix is skipped.

That cold pass is expensive because it means decompressing and JSON-parsing
hundreds of megabytes (about 88 MB compressed / several hundred MB of JSON for 217
sessions here), and an old-format log additionally has to be migrated and
replay-validated — several times the cost of a current-format read.

Three things keep it out of the user's way:

1. **A durable summary cache.** Summaries are cached at
   `$DSH_HOME/cache/dsh-usage-stats/summaries.v5.json` (about 1 KB per session,
   ~230 KB for 217 sessions), keyed by each session's persistence revision plus
   its event count and byte size, and invalidated wholesale when the price table
   changes. On start the panel paints from the cache immediately; the scan then
   revalidates and re-reads only sessions that actually changed. An entry is used
   only while it still matches, so a stale cache can never change a number.
   A legacy (`migration-required`) log that is not live has no writer at all —
   only this machine's format migration can touch it, and migration preserves
   every event — so its cached fold stays authoritative instead of being
   re-migrated on every start. Delete that file to force a full rebuild.
2. **Phased, recency-first indexing.** Current-format sessions are read first and
   newest first; migration-required logs go last. The panel shows its progress pill
   and usable partial totals while the tail is still working.
3. **Bounded concurrency.** Eight log reads are in flight at once, which keeps the
   decompression threads busy without starving the agent loops.

Measured on this machine (217 sessions, 218 log files, 88 MB compressed):

| Run | First payload | Revalidation scan | Logs read |
|---|---|---|---|
| Cold, empty cache | 0.04 s (partial) | 34 s | 217 |
| Restart with cache | 0.04 s (complete) | **0.12 s** | **0** |

## Cost is an estimate

Prices are USD per 1M tokens and are **configuration, not truth**. The shipped
table follows published rate sheets (checked 2026-11-06):

- [DeepSeek API pricing](https://api-docs.deepseek.com/quick_start/pricing) —
  `deepseek-flash` = DeepSeek-V4.1-Flash-1017: input 0.30 / output 1.20 / cache read
  0.006 at peak, exactly half off-peak.
- [OpenCode Console pricing](https://opencode.ai/v2/docs/console/models/) — DeepSeek
  V4.1 Flash 0.30 / 1.20 / 0.006, Kimi K3 3.00 / 15.00 / 0.30 / 3.00, Qwen3.8 Max
  2.00 / 6.00 / 0.25 / 2.50, Claude Opus 5.5 4.00 / 20.00 / 0.20 / 5.00, GPT 6 Astra
  10.00 / 50.00 / 1.00 / 12.50.
- [OpenCode Go](https://opencode.ai/docs/go/) applies the same token rates and bills
  DeepSeek by time of day.

Peak hours are **01:00-04:00 and 06:00-10:00 UTC, Monday to Friday**; every other
hour (including the weekend) is off-peak at half price. Each logged call is priced by
its own start time, so a session that spans both windows is billed correctly. DeepSeek
also treats Chinese public holidays as off-peak, which is not modelled here — a
holiday weekday is billed at the higher peak rate.

A model the table does not name is priced by the fallback rate and flagged in the
panel (兜底单价). Edit the `config` of the `usage-stats` row in the profile's
`cordis.patch.yml`:

```yaml
- id: usage-stats
  name: '@local/dsh-usage-stats'
  config:
    prices:
      deepseek-official/deepseek-flash: { peak: { input: 0.3, output: 1.2, cacheRead: 0.006 }, offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003 } }
      my-provider/my-model: { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0.1 }
    fallback: { input: 1.0, output: 3.0, cacheRead: 0.1, cacheWrite: 0.1 }
    listIntervalMs: 15000  # how often an open panel re-enumerates stored sessions
```

Keys may be `provider/model` or a bare `model`, and an override merges **per
field** over the shipped rate for that key (naming only `input` keeps the other
three). An entry may be flat (`input`/`output`/`cacheRead`/`cacheWrite`) or carry
`peak` and `offPeak` blocks. Cached input tokens are priced by `cacheRead`;
uncached input by `input`.

## HTTP surface

The Host half serves three exact routes for the browser half, from loopback
addresses only (the `Host` header, and a present `Origin`, must name the loopback
interface), with `cache-control: no-store`:

| Route | Purpose |
|---|---|
| `GET /dsh-usage-stats?days=7` | full payload (see `API.md`) |
| `GET /dsh-usage-stats/live` | cheap poll: totals, scan progress |
| `POST /dsh-usage-stats/refresh` | start a re-scan of the stored logs |

The first read starts the first scan lazily, so a profile that never opens the
panel never indexes anything. Nothing is sent off the machine.

## Limitations

- **First scan is the expensive one.** With no cache, a cold index of a few hundred
  stored logs takes tens of seconds (34 s for 217 logs here) and the panel shows
  progress while it runs; the cache is written the moment that scan ends, so every
  later start re-reads only the sessions that changed — normally none, and the
  revalidation costs about a tenth of a second. A stored log that cannot be read at
  all is counted and reported instead of being skipped silently.
- **Cost follows the configured table.** A model missing from it is priced with
  the fallback rate and marked, so a wrong estimate is visible instead of silent.
- **Tokens are provider-reported.** A call that failed before reporting usage
  contributes nothing, and cache accounting is exactly what the provider logged.
- **The timeline is dense per day.** Days without usage appear as gaps, not as
  compressed neighbours, and ranges longer than three years fall back to sparse
  rows.
- **No live resource monitoring.** The panel reports token spend and cost only;
  CPU and memory of the Host process are not part of this plugin.
