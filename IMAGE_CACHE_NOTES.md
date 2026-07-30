# Image Cache Notes

Notes from the 2026-07-30 investigation into broken image loading on the
development deployment. Kept for the follow-up work that was deliberately left
out of scope.

## What was fixed

Images loaded on stable but were largely blank on development. The cause was a
Redis Lua serialization bug, not the rate limiting the symptoms pointed at.

`REGISTER_SCRIPT` in `src/lib/cache/image-cache-accounting.ts` returned
`cjson.encode(evicted)`. In Redis Lua, `cjson.encode({})` returns `"{}"` — an
empty JSON *object*, not `"[]"` — because Lua cannot distinguish an empty array
from an empty dict. Verified against the dev Redis:

```
cjson.encode({})     -> {}
cjson.encode({1,2})  -> [1,2]
```

The JS reader guarded with `if (!Array.isArray(rawEvicted)) throw`, so every
fill that evicted nothing — the normal case — threw. The caller's `catch`
deleted the file it had just written and returned a `200 BYPASS` that
incremented no counter.

Observed consequences on development:

| Signal | Value |
| --- | --- |
| `imageFiles` / `imageBytes` | `0` / `0` |
| `quotaEntries` / `quotaBytes` | `59` / `2294662` (ledger with no backing files) |
| `cacheHits` | `0` after 281 `upstreamFetches` |
| `rateLimited` | `341` |
| `cacheBypasses` | `13` (nowhere near reconciling) |

Because nothing could ever be cached, every page view re-fetched and
re-transcoded every poster, permanently saturating the 4-concurrent-per-user
processing limiter. That produced the `429`s, and `FadeInImage` hides an image
permanently on first error, so each `429` became a blank poster.

The fix emits an explicit `'[]'` for the empty case, makes the reader tolerate
`"{}"` so a version-skewed script cannot discard a written file, counts the
previously silent registration failure, and replaces `429`-on-concurrency with a
bounded wait for a free slot.

## Known pre-existing issue: quota-lock contention

**Not addressed** — predates the fix above and was left out of scope.

The fill path acquires a single global quota lock
(`acquireImageQuotaLock(redis, generation)`, key
`helprr:cache:lock:image-quota:v{generation}`) before `saveCachedImage` and
`registerImageCacheEntry`. It uses `NX` with no wait, so on failure the request
returns `cacheStatus: 'BYPASS'`: the image is served correctly (`200`) but never
stored.

Measured after the fix: 12 concurrent cold fills for distinct cache keys
returned a mix of `MISS` (stored) and `BYPASS` (served, not stored). A following
serial pass over the same 12 keys gave 8 `HIT` / 4 `MISS` — roughly a third of
the burst fills had to be re-fetched and re-transcoded from upstream because
they lost the global lock.

This is a cache-effectiveness problem, not a correctness one: no broken images,
and entries converge to cached on later access.

Also worth folding into that work: `IMAGE_QUOTA_LOCK_TTL_MS` is
`max(CACHE_LOCK_TTL_MS, 5 min)`, so a lock leaked by a crashed process blocks
all image caching for up to five minutes.

Options to weigh:

- Give the quota lock a short bounded wait, mirroring
  `acquireBoundedImageProcessingLease` in `src/lib/cache/image-cache.ts`.
- Narrow the lock to guard only the quota/eviction accounting rather than the
  file write plus registration.
- Reconsider whether a global lock is needed at all, given `REGISTER_SCRIPT` is
  already atomic and recomputes bytes/entries and evicts under the limits.

## Testing caveat

The fake Redis doubles in `src/lib/__tests__/image-cache-*.test.ts` reimplement
each Lua script in JavaScript and return `JSON.stringify([])`, a valid array.
They validate the accounting contract but never real Lua/cjson semantics, which
is why this outage passed a green suite. Anything depending on how Redis
serializes a Lua value needs a real-Redis check, for example:

```bash
docker exec helprr-dev-redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning EVAL "return {cjson.encode({}), cjson.encode({1,2})}" 0'
```

The doubles also match on the script's version comment, so bumping
`-- image-cache-register-vN` requires updating them or every fill silently
fails.
