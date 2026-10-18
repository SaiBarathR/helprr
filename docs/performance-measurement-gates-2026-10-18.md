# Performance Measurement Gates, 2026-10-18

Two gates from the full-codebase audit plan (Workstream 16) asked for a
measurement before any change. Both were measured and both ended in **no
change**. This file keeps the evidence next to
[notification-unread-index-benchmark.md](notification-unread-index-benchmark.md),
the earlier gate it follows.

## Notification history query shapes

The unread benchmark measured four query shapes at 500,000 rows. This run
covers the shapes it left out:

- member filtered by event type and date;
- admin filtered by event type and date;
- title/body search, for a member and for an admin.

### Method

- **Database:** a disposable PostgreSQL 16 container with a database named
  exactly `helprr_migration_test`. The committed migrations (11) were applied
  with `psql`. No development or stable data was used.
- **Data:** synthetic `NotificationHistory` at 10,000, 100,000 and 1,000,000
  rows: 100 users, 10% global (null owner) rows, 95% read, 12 event types,
  spread over 90 days.
- **Queries:** the route's two queries per shape, as Prisma sends them:
  - the newest-50 list (`ORDER BY "createdAt" DESC LIMIT 50`);
  - the count.
- **Filters:**
  - event type and date: `"eventType" IN ('imported','grabbed')` over a 29-day
    range;
  - search: `title ILIKE '%term%' OR body ILIKE '%term%'`, the route's
    case-insensitive `contains`;
  - member shapes also filter on `"userId"`.
- **Timing:** each query had one cold-ish run, then five warm runs; the tables
  give the warm median from `EXPLAIN (ANALYZE, BUFFERS)`.

### Results

For the event type and date filters and for common-term searches, every
newest-50 list stayed at or under 2.2 ms at 1,000,000 rows, served by
`NotificationHistory_createdAt_idx` or `NotificationHistory_userId_createdAt_idx`.
The admin search for a rare term is the exception, below. The counts:

| Count query | 10k rows | 100k rows | 1M rows | Plan at 1M |
| --- | ---: | ---: | ---: | --- |
| Member, event type and date | 0.2 ms | 0.6 ms | 7.4 ms | Bitmap scans on the user index |
| Admin, event type and date | 0.4 ms | 3.9 ms | 57 ms | Bitmap scan on `NotificationHistory_eventType_createdAt_idx` |
| Member, title/body search | 0.5 ms | 2.7 ms | 21 ms | Bitmap scan on the user index |
| Admin, title/body search | 11 ms | 77 ms | 229 ms | Sequential scan |

At 1,000,000 rows, an admin search for a rare term takes about 250 ms for the
list and 250 ms for the count. Both are sequential scans.

### Trigram candidate

At 1,000,000 rows, a trigram candidate (`pg_trgm` GIN indexes on `title` and
`body`) was measured against the saved benchmark's gates.

**Speed:**

| Query | Without | With |
| --- | ---: | ---: |
| Rare term (457 matches), list | 255 ms | 2.5 ms |
| Rare term (457 matches), count | 249 ms | 2.9 ms |
| Common term (99,341 matches), count | 230 ms | 95 ms |
| Common term (99,341 matches), list | 1.4 ms | 0.9 ms |

**Cost:**

| Measurement | Result |
| --- | ---: |
| Index size | +180 MB on a 319 MB relation (title 28 MB, body 152 MB) |
| 10,000-row insert, rolled back | 204 ms → 330 ms (+62%) |

It fails two of the saved gates: indexes under 10% of the relation, and no
more than a 25% write regression. The synthetic bodies contain an md5 string,
which inflates the body index; real bodies are shorter.

### Scale and decision

The development stack held 5,299 notifications over three months, about 60 a
day. Real titles average 23 characters and bodies 90. At 10,000 rows the
slowest shape is 11 ms.

**No index is added.** Revisit only if a real installation's history
approaches a million rows.

## App-shell service query

`getAppShellServiceFlags()` (`src/lib/app-shell-services.ts`) runs one
`serviceConnection.findMany` whenever the authenticated app layout renders on
the server. The plan said to add a cross-request cache only if that query stays
material.

| Measurement (development stack) | Result |
| --- | ---: |
| PostgreSQL execution, 11 connection rows | 0.04–0.10 ms (planning 0.3–0.7 ms) |
| Prisma round trip from the app container, 30 runs | 0.35 ms median, 0.47 ms p90 |
| Authenticated `/settings` document, TTFB median of 15 | 63.2 ms |
| `/api/health` on the same network path, TTFB median of 15 | 46.5 ms |

The two TTFB medians differ by 16.7 ms. The separately measured 0.35 ms
query is about 2% of that difference. This is a rough comparison, not a
measured share of SSR time; the query also runs alongside the user and cache
generation lookups in the same `Promise.all`. Either way it is not material, so
**no cache is added**. The session and user
lookup on the same path stays uncached, as the plan requires.
