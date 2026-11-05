---
title: Cache and images
description: Image and TMDB cache tuning, and what Helprr cleans up by itself.
---

All numeric values below are optional positive integers; invalid or non-positive values fall back to the defaults.

| Variable                          | Default                   | Scenario                                                                                                    |
| --------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `IMAGE_CACHE_DIR`                 | `/app/image-cache`        | Directory for server-side cached image bytes. Bundled Compose mounts its stack-specific named volume here. |
| `IMAGE_CACHE_TTL_SECONDS`         | `604800` (7 days)         | How long a successful image is considered fresh.                                                            |
| `IMAGE_CACHE_STALE_SECONDS`       | `2592000` (30 days)       | How long a stale cached image may be served when its upstream fails.                                        |
| `IMAGE_CACHE_MAX_BYTES`           | `1073741824` (1 GiB)      | Maximum bytes in the active image-cache generation; least-recently-used entries are evicted first.          |
| `IMAGE_CACHE_MAX_ENTRIES`         | `32000`                   | Maximum entries in the active image-cache generation; sized so the 1 GiB byte quota remains authoritative for representative posters. |
| `IMAGE_UPSTREAM_FETCH_TIMEOUT_MS` | `5000`                    | Timeout for fetching an upstream image.                                                                     |
| `IMAGE_UPSTREAM_MAX_BYTES`        | `10485760` (10 MiB)       | Maximum declared and actually streamed bytes accepted from one upstream image response.                    |
| `IMAGE_UPSTREAM_MAX_PIXELS`       | `40000000` (40 MP)        | Maximum decoded input pixels Sharp will accept before transform or storage.                                |
| `IMAGE_PROCESSING_QUEUE_WAIT_MS`  | `30000`                   | Maximum fair-queue wait for visible image work, separate from the upstream timeout.                         |
| `IMAGE_PROCESSING_QUEUE_MAX`      | `256`                     | Maximum queued image jobs per app instance.                                                                 |
| `IMAGE_PROCESSING_QUEUE_PER_USER_MAX` | `64`                  | Maximum queued image jobs for one user per app instance.                                                    |
| `IMAGE_FETCH_RATE_BURST`          | `600`                     | Per-user token-bucket burst available to actual upstream image starts.                                      |
| `IMAGE_FETCH_RATE_REFILL_PER_MINUTE` | `300`                  | Sustained per-user upstream-start refill rate.                                                              |
| `IMAGE_QUOTA_LOCK_WAIT_MS`        | `2000`                    | Bounded wait for the short quota/accounting commit lock.                                                    |
| `TMDB_CACHE_DEFAULT_TTL_SECONDS`  | `600` (10 minutes)        | Default TTL for TMDb data without a more specific category.                                                 |
| `TMDB_CACHE_DISCOVER_TTL_SECONDS` | `600` (10 minutes)        | TTL for TMDb discovery responses.                                                                           |
| `TMDB_CACHE_DETAILS_TTL_SECONDS`  | `86400` (1 day)           | TTL for TMDb title/detail responses.                                                                        |
| `TMDB_CACHE_STATIC_TTL_SECONDS`   | `604800` (7 days)         | TTL for TMDb static/reference data.                                                                         |
| `TMDB_CACHE_STALE_SECONDS`        | `2592000` (30 days)       | Stale-if-error window for TMDb cache data.                                                                  |
| `CACHE_LOCK_TTL_MS`               | `10000`                   | Cache-fill lock duration; change only when diagnosing unusually slow or long-running upstream requests.     |

The bundled Compose file passes these advanced values through when they are set in `.env`. The image proxy accepts validated JPEG, PNG, and WebP raster bytes; HTML, XML/SVG, malformed, unknown, oversized, pixel-heavy, and MIME-confused responses are rejected. Redis maintains per-generation byte/entry accounting and LRU order. If Redis accounting is unavailable, a bounded validated upstream image can still be served with `no-store`, but Helprr does not create a cache file.

The bundled stable and development stacks mount separate named volumes at
`/app/image-cache`, so replacing only the app container preserves validated
image bytes. A custom `IMAGE_CACHE_DIR` is persistent only if you provision a
matching bind or named mount. Existing operators upgrading from an explicit
`IMAGE_CACHE_DIR=/tmp/helprr-image-cache` must remove that setting or change it
to `/app/image-cache`; the first upgrade may perform one final cold rebuild
while startup reconciles persistent Redis metadata with the new volume.

Fresh hits and stale delivery do not enter the processing queue or consume
upstream rate budget. Expired but valid bytes are returned immediately as
`STALE` while one lower-priority refresh runs. True misses use a bounded fair
queue, five-running-per-user and sixteen-running-per-instance limits, Redis
cross-replica leases, cancellation, duplicate-fill coalescing, and a burstable
token bucket charged only when an upstream request actually starts. TMDB poster
fetches use an appropriate server-derived size before Helprr transcodes them.

**Settings → Storage** reports cache health, queue/running work, hit/stale/miss
counts, capacity/rate/upstream failures, recoveries, quota behavior, and a
copy-safe diagnostic summary without recording source URLs or credentials. The
same bounded image-cache summary is included in administrator support bundles.

## Automatic retention

Helprr runs a bounded retention sweep once per day. Notification history uses
the value configured in **Settings → Notifications**. Cleanup history and settled
scheduled-alert occurrences are kept for 90 days, operation-audit records for
365 days, and expired session rows are removed after the fixed 30-day login-token
lifetime. Pending alerts and pending Seerr approvals are live state and are not
removed by history retention.

The same sweep reconciles image metadata, the per-generation Redis quota/LRU
index, and immutable cache files; enforces the configured byte and entry limits;
removes unreferenced files after 24 hours and temporary files after one hour; and
removes cache-generation directories abandoned for at least 24 hours. It reads
Redis successfully, takes the narrowly scoped image-quota lock, and re-checks the
active generation before touching files. If Redis is unavailable, the lock is
busy, or an admin cache purge races the sweep, filesystem cleanup fails closed
and waits for a later run. Log files continue to use the separate retention value in
**Settings → Logging**. Database backups are never removed by this sweep; only
`backup.sh` prunes them (see [Backup and restore](/helprr/maintain/backup/)).
