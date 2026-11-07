# Usage Stats — Host ⇄ Client API contract (v1)

The Host half registers three exact HTTP routes on `ctx.webServer`; the Client half
reads them with `fetch` from the Harness page (same origin). Every value below is
plain JSON. Times are epoch milliseconds unless the field name says otherwise.
Money is US dollars (floating point, never rounded by the Host).

Both read routes answer only loopback callers whose `Host` header (and `Origin`,
when the browser sends one) names the loopback interface, so a page served from a
rebinding domain cannot read them. Errors answer
`{ "error": { "code": string, "message": string } }` with a non-200 status.

## GET `/dsh-usage-stats?days=<n>`

`days` is an optional integer (`7`, `30`, `90`, `365`, or `0` for all time).
It selects the `range` block, and the `models` / `sessions` lists inside it;
`totals` is always the lifetime figure, documented below.

```jsonc
{
  "version": 3,
  "revision": 42,                 // increases whenever the aggregate changed
  "generatedAt": 1793680000000,

  "scan": {
    "state": "idle",              // "idle" | "scanning"
    "total": 217,                 // sessions known to the store
    "scanned": 217,               // sessions indexed so far
    "startedAt": 1793679000000,   // null when never started
    "finishedAt": 1793679060000,  // null when never finished
    "elapsedMs": 5885,            // duration of the last completed scan
    "failed": 0,                  // stored logs that could not be read (excluded)
    "readMs": 5400,               // summed time spent inside log reads
    "migrated": 0,                // sessions read through format migration
    "restored": 217,              // summaries restored from the disk cache
    "cache": {                    // the durable summary cache (see README)
      "enabled": true,
      "file": "C:\\Users\\WU\\.dsh\\cache\\dsh-usage-stats\\summaries.v5.json",
      "savedAt": 1793703479347,   // null until this process writes it
      "loadedAt": 1793703715325,  // null when this process started with no cache
      "note": "entries 212, restored 212", // human-readable load outcome
      "error": null
    },
    "lastError": null             // string when the last scan failed or skipped logs
  },

  "totals": {
    "sessions": 217,              // every session known (including empty ones)
    "sessionsWithUsage": 191,     // sessions that reported at least one usage
    "liveSessions": 2,            // sessions currently live in this process
    "requests": 11031,            // assistant messages carrying usage
    "turns": 900,
    "userMessages": 4000,
    "toolCalls": 5000,
    "tokens": {
      "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
      "reasoning": 0, "total": 0  // total = input + output + cacheRead + cacheWrite
    },
    "costUsd": 1.234,
    "firstActivity": 1789650155983, // null when nothing was recorded
    "lastActivity": 1793680000000   // null when nothing was recorded
  },

  "range": {
    "days": 7,
    "from": 1791091200000,        // null when days is 0 (all time)
    "to": 1793680000000,
    "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
                "reasoning": 0, "total": 0 },
    "costUsd": 0.42,
    "requests": 120,
    "sessions": 23,               // sessions with activity inside the range
    "sessionsWithUsage": 21,      // ...of which at least one call reported usage
    "models": [                   // cost composition for THIS range, ascending by tokens
      { "key": "deepseek-account/deepseek-flash", "provider": "deepseek-account",
        "model": "deepseek-flash", "calls": 1497,
        "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
                    "reasoning": 0, "total": 0 },
        "costUsd": 11.4, "unpricedCalls": 0, "priced": true }
    ],
    "timeline": [                 // one row per local day, oldest first, ends today;
                                  // days without usage are present and zero-filled
      { "day": "2026-11-03", "input": 0, "output": 0, "cacheRead": 0,
        "cacheWrite": 0, "total": 0, "costUsd": 0, "requests": 0 }
    ],
    "delta": {                    // equal-length comparison windows behind the KPI chips:
                                  // the FINISHED days of this range against the equally
                                  // long window before it (today is still accruing, so it
                                  // is excluded from the comparison, never from the totals);
                                  // null when days is 0 or 1
      "days": 6,
      "current": { "tokens": { "input": 0, "output": 0, "cacheRead": 0,
                               "cacheWrite": 0, "reasoning": 0, "total": 0 },
                   "costUsd": 17.4, "requests": 2310 },
      "previous": { "tokens": { "input": 0, "output": 0, "cacheRead": 0,
                                "cacheWrite": 0, "reasoning": 0, "total": 0 },
                    "costUsd": 10.76, "requests": 563 }
    }
  },

  "sessions": [                   // only sessions active in `range`, descending by lastActivity
    {
      "id": "session-dd713b48-46d1-4724-b9c6-564f85580ae9",
      "title": "中国科学院相关研究所院士",     // "" when the log has no title
      "cwd": "D:\\Project\\dsh-normal",         // null when unknown
      "agentPreset": "standard",                 // null when unknown
      "origin": null,                            // "subagent" or null
      "parentSession": null,
      "live": false,
      "createdAt": 1789650155964,                // all-time
      "firstActivity": 1789650155983,            // all-time; null when the log is empty
      "lastActivity": 1789650189251,              // all-time
      // everything below is scoped to `range`, so the table follows the control
      "turns": 16, "requests": 390, "userMessages": 67, "toolCalls": 492,
      "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
                  "reasoning": 0, "total": 0 },
      "costUsd": 3.2,
      "cacheHitRate": 0.63,        // cacheRead / (input + cacheRead), 0 when both 0
      "models": ["deepseek-official/deepseek-flash"],
      "priced": true,              // false when any in-range usage hit the fallback price
      "allTime": {                 // the session's whole life, for the detail panel
        "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
                    "reasoning": 0, "total": 0 },
        "costUsd": 5.1, "requests": 402, "turns": 17,
        "userMessages": 70, "toolCalls": 500
      }
    }
  ],

  "prices": {                      // the exact table the estimate used; display it
    "currency": "USD",
    "unit": "per 1M tokens",
    "fallback": { "input": 1.0, "output": 3.0, "cacheRead": 0.1, "cacheWrite": 0.1 },
    "models": {
      // A flat rate...
      "opencode-go/kimi-k3": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3 },
      // ...or a model billed by time of day: each call is priced by its own UTC
      // start time (peak 01:00-04:00, 06:00-10:00 Mon-Fri; off-peak is half).
      "deepseek-official/deepseek-flash": {
        "peak": { "input": 0.3, "output": 1.2, "cacheRead": 0.006, "cacheWrite": 0 },
        "offPeak": { "input": 0.15, "output": 0.6, "cacheRead": 0.003, "cacheWrite": 0 }
      }
    }
  }
}
```

## GET `/dsh-usage-stats/live`

The cheap poll (small body). While `scan.state` is `"scanning"` the `totals`
block describes what has been indexed so far, so the panel can show progress.

```jsonc
{
  "version": 3,
  "revision": 42,             // compare with the full fetch; refetch when it changes
  "generatedAt": 1793680000000,
  "scan": { /* same shape as the full payload */ },
  "totals": { /* same shape as the full payload */ }
}
```

## POST `/dsh-usage-stats/refresh`

Asks the Host to re-scan. Answers `202 { "started": true }` when a scan began,
or `200 { "started": false, "alreadyRunning": true }` while one is running.
The panel then keeps polling `/live` until `scan.state` returns to `"idle"`.
A scan that finds nothing new can finish before the next poll observes it, so
the panel also treats a sustained `"idle"` as the end of a rescan.
