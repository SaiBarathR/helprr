# Unread Notification Partial-Index Benchmark

This record captures the measurement gate for migration
`20260730050000_notification_unread_partial_indexes`. The benchmark ran on
PostgreSQL 16.14 in the disposable database named exactly
`helprr_migration_test`; no stable or development application data was used.

## Decision gate

The thresholds were fixed before measurement:

- PostgreSQL must select each candidate for both its count and ordered-list
  query.
- Each intended query must reduce median warm execution time by at least 30% or
  shared-buffer work by at least 50%.
- The two candidate indexes together must remain below 10% of total table size.
- Repeated insert and retention-delete probes must not regress by more than 25%.

Both candidates passed, so both are included. Prisma 6 is retained; the partial
indexes live in customized migration SQL because the schema cannot express
their predicates.

## Dataset and method

- 500,000 notifications over 90 days; 100 synthetic users were seeded and 90
  appeared in owned rows.
- 24,948 unread rows (4.99%) and 50,000 global/null-owner rows.
- Four production query shapes: admin count, member count, admin newest-50
  list, and member newest-50 list.
- Each query ran once after an isolated PostgreSQL restart (cold-ish) and five
  more times for the warm median.
- Candidates were created and measured independently, then together.
- Write amplification used rollback-isolated 10,000-row inserts. Retention used
  rollback-isolated deletion of 55,554 rows older than 80 days.

## Query evidence

Times are milliseconds. Blocks are median warm shared hit plus read blocks.

| Query | Baseline plan | Candidate plan | Cold-ish ms | Warm median ms | Blocks | Warm time reduction | Block reduction |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Admin unread count | Sequential scan | Index-only scan on `NotificationHistory_unread_createdAt_idx` | 13.048 → 2.107 | 16.551 → 2.461 | 11,359 → 70 | 85.1% | 99.4% |
| Admin unread list | `NotificationHistory_createdAt_idx`, filtering 950 rows | `NotificationHistory_unread_createdAt_idx`, no filtered rows | 3.054 → 0.162 | 1.959 → 0.057 | 1,007 → 52 | 97.1% | 94.8% |
| Member unread count | `NotificationHistory_userId_createdAt_idx`, filtering 4,723 rows | Index-only scan on `NotificationHistory_userId_unread_createdAt_idx` | 14.480 → 0.073 | 4.386 → 0.117 | 5,014 → 4 | 97.3% | 99.9% |
| Member unread list | `NotificationHistory_userId_createdAt_idx`, filtering 807 rows | `NotificationHistory_userId_unread_createdAt_idx`, no filtered rows | 2.442 → 0.174 | 0.806 → 0.140 | 864 → 52 | 82.6% | 94.0% |

With both indexes present, PostgreSQL continued choosing the global partial
index for both admin queries and the user-scoped partial index for both member
queries.

## Cost guardrails

| Measurement | Result |
| --- | ---: |
| Global partial index | 560 KiB |
| User-scoped partial index | 944 KiB |
| Combined indexes / 162.2 MiB total relation | 0.91% |
| 10,000-row insert warm median | 87.022 ms baseline; 87.817 ms indexed (+0.9%) |
| 55,554-row retention delete warm median | 24.412 ms baseline; 22.593 ms indexed |
| Global index build | 95 ms |
| User-scoped index build | 117 ms |

The mutation timings are close enough to be treated as no measurable
regression, not as an expected write-speed improvement. The indexes cover only
unread rows, which bounds their disk and write-amplification cost.

## Operational compatibility

The disposable upgrade test proved that Prisma Migrate wraps this PostgreSQL
migration in a transaction: `CREATE INDEX CONCURRENTLY` failed with PostgreSQL
SQLSTATE `25001`. The committed migration therefore uses transactional
`CREATE INDEX`. It briefly blocks writes to `NotificationHistory` while each
small partial index builds; the 500,000-row benchmark timings above bound the
measured build cost. The full migration upgrade suite verifies deployment from
every released snapshot. If either index later proves ineffective on real
retained data, remove it only with a new forward migration.
