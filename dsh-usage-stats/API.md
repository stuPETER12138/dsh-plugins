# Usage & Resources — Host ⇄ Client contract

The Host half registers two exact HTTP routes on `ctx.webServer`; the Client half
reads them with `fetch` from the Harness page (same origin). Every value is plain
JSON. Times are epoch milliseconds, tokens are integers, sizes are bytes, memory
is bytes, money is floating US dollars (never rounded by the Host).

Only loopback callers are answered: peer address, `Host` header (and `Origin`,
when present) must all name the loopback interface; anything else gets `403`.
Errors answer `{ "error": { "code", "message" } }` with a non-200 status and
`cache-control: no-store`.

## GET `/dsh-usage-stats?days=<n>`

`days` selects the token range: `7` when absent, `0` for all time, anything larger
than `3660` clamped. The token sections are scoped to that range; `resources`,
`storage` and `cleanup` are independent of it.

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
  ],

  "resources": {
    "at": 1793680000000,
    "tray": true,               // false when whole-app tracking is unavailable
    "host": {
      "pid": 1234,
      "uptimeSec": 3600,
      "cpu": {
        "intervalPercent": 3.2,     // Host process, percent of ONE core (may pass 100)
        "sinceStartPercent": 1.8,   // average since start, one-core basis
        "machinePercent": 0.4,      // intervalPercent / cores
        "cores": 8
      },
      "memory": { "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 }
    },
    "app": {                        // whole Desktop process tree; null off Windows
      "processes": 6,
      "memoryBytes": 987654321,
      "at": 1793679990000
    },
    "appError": null,               // why the tree figure is missing, when it is
    "system": {
      "totalBytes": 0, "freeBytes": 0, "usedBytes": 0,
      "freeRatio": 0.31, "cores": 8, "uptimeSec": 90000,
      "platform": "win32", "arch": "x64"
    }
  },

  "storage": {
    "at": 1793680000000,
    "root": "<harness home>\\sessions",
    "scanning": false,
    "error": null,
    "sessions": 339,            // session directories under the root
    "files": 341,               // every file in them, all retained generations
    "bytes": 163000000,
    "extras": [                 // the other DSH data trees, when present
      { "key": "attachments", "bytes": 366000000, "files": 1200 },
      { "key": "storage", "bytes": 5300000, "files": 340 },
      { "key": "cache", "bytes": 29900000, "files": 190 }
    ],
    "extrasBytes": 401300000
  },

  "cleanup": {
    "ready": true,              // false until the first disk scan finishes
    "error": null,
    "days": 90,                 // configured window
    "cutoff": 1787155200000,    // lastWrite must be <= this
    "total": { "count": 27, "bytes": 12260000 },   // every eligible session
    "archived": { "sessions": 145, "bytes": 91900000 },
    "skipped": { "recent": 118, "recentBytes": 79600000, "live": 0, "liveBytes": 0 },
    "candidates": [             // at most 200 rows, largest first
      { "id": "session-033a77ae-a023-4851-9c37-788a6e61fb8e",
        "group": "--proj--",
        "title": "会话标题",
        "bytes": 3460000,
        "files": 1,
        "lastWrite": 1789320000000,
        "ageDays": 64 }
    ],
    "more": 0                   // eligible rows not listed because of the cap
  }
}
```

Invariants:

- `tokens.total === input + output + cacheRead + cacheWrite` everywhere.
- `totals` equals the sum of the rows: `Σ timeline[].total`, `Σ timeline[].costUsd`
  and `Σ timeline[].requests` match the three `totals` fields.
- `sessions[].tokens.total` sums to `totals.tokens.total` unless the session list
  was truncated; compare `totals.sessions` with `sessions.length` to tell.
- `cleanup.total` counts every eligible session, `candidates` only the listed
  ones; `more` is the difference.
- `storage.bytes` sums session directories only; the delete route targets exactly those.

## GET `/dsh-usage-stats/cleanup`

The dry run on its own: `{ "storage": <storage>, "cleanup": <cleanup> }`, the same
two objects as above. The Host waits for the first disk scan, so the answer is
never half-empty on a cold start.

## POST `/dsh-usage-stats/cleanup`

Applies a plan. The body is JSON, at most 256 KB:

```jsonc
{ "ids": ["session-033a77ae-…", "session-c34ba321-…"], "confirm": true, "days": 90 }
```

`days` is accepted for readability and ignored: the Host always uses its own
configured window. What happens:

1. `confirm` must be exactly `true` (`400 confirmation-required` otherwise) and
   `ids` must be a non-empty array of session ids (`400 no-sessions`), at most 500
   (`400 batch-too-large`).
2. The Host re-measures the disk, re-reads the archive set and the live session
   ids, and re-computes the plan.
3. Every id must still be eligible — archived, not running, written before the
   cutoff, and found by that scan. Otherwise nothing is deleted and the answer is
   `409 not-eligible`:

   ```jsonc
   { "error": { "code": "not-eligible", "message": "…" },
     "refused": ["session-…"],
     "cleanup": { … } }
   ```

4. Eligible ids are removed one directory at a time. A directory qualifies only
   when it is a scanned session row, sits exactly two levels below the sessions
   root, and its basename equals the id; anything else is reported, not touched.

Success answers `200`:

```jsonc
{
  "ok": true,
  "deleted": [{ "id": "session-…", "bytes": 3460000 }],
  "failed": [],                       // [{ "id", "error" }] when a directory would not go
  "freedBytes": 3460000,
  "storage": { … },                   // re-measured after the delete
  "cleanup": { … }                    // the plan that remains
}
```

The archive set is not rewritten: a deleted session leaves one archived id with no
log behind, which the workspace registry tolerates (unarchiving it still resolves
and introduces no unknown referent).
