# Usage Stats — Host ⇄ Client contract

The Host half registers one exact HTTP route on `ctx.webServer`; the Client half
reads it with `fetch` from the Harness page (same origin). Every value is plain
JSON. Times are epoch milliseconds, tokens are integers, money is floating US
dollars (never rounded by the Host).

Only `GET` is accepted, and only from a loopback caller whose peer address, `Host`
header (and `Origin`, when present) all name the loopback interface; anything else
answers `403` / `405`. Errors answer `{ "error": { "code", "message" } }` with a
non-200 status and `cache-control: no-store`.

## GET `/dsh-usage-stats?days=<n>`

`days` selects the range: `7` when absent, `0` for all time, anything larger than
`3660` clamped. Every figure below is scoped to that range.

```jsonc
{
  "generatedAt": 1793680000000,
  "days": 7,

  "scan": {
    "state": "idle",      // "idle" | "scanning"
    "scanned": 217,       // sessions indexed so far
    "total": 217,         // sessions the store lists
    "failed": 0,          // logs that could not be read (excluded from every figure)
    "error": null         // string when the last scan threw
  },

  "totals": {
    "sessions": 23,       // sessions that used tokens in the range
    "requests": 120,      // assistant messages carrying usage
    "costUsd": 0.42,
    "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 }
  },

  // One row per local day, oldest first, always ending today. A day without
  // usage is present with zeros; a range longer than 1100 days lists only the
  // days that have usage.
  "timeline": [
    { "day": "2026-11-10", "input": 0, "output": 0, "cacheRead": 0,
      "cacheWrite": 0, "total": 0, "costUsd": 0, "requests": 0 }
  ],

  // Cost composition of the range, descending by tokens.total.
  "models": [
    { "key": "deepseek-official/deepseek-flash",
      "provider": "deepseek-official", "model": "deepseek-flash",
      "calls": 1497,
      "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
      "costUsd": 11.4,
      "priced": true }    // false when the model is not in the price table
  ],

  // The 100 most recently active sessions of the range (totals.sessions counts
  // them all); sorted by lastActivity descending.
  "sessions": [
    { "id": "session-dd713b48-46d1-4724-b9c6-564f85580ae9",
      "title": "会话标题",          // "" when the log has no title
      "live": false,                // true while the session is running
      "lastActivity": 1793680000000,
      "requests": 390,
      "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
      "costUsd": 3.2 }
  ]
}
```

Invariants:

- `tokens.total === input + output + cacheRead + cacheWrite` everywhere.
- `totals` equals the sum of the rows: `Σ timeline[].total`, `Σ timeline[].costUsd`
  and `Σ timeline[].requests` match the three `totals` fields.
- `sessions[].tokens.total` sums to `totals.tokens.total` unless the session list
  was truncated; compare `totals.sessions` with `sessions.length` to tell.
- A model whose `priced` is `false` has its cost computed with the fallback rate.
