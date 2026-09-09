# Performance implementation results — 9 September 2026

Implemented the twelve packages plus opt-in measurement from [the performance plan](performance-improvement-plan-2026-09-06.md). Changes remain uncommitted on `codex/stop-responsiveness`; no release or deployment was performed. Android and iPhone qualification belongs to the owner, as requested.

## Changes

| Package | Delivered behavior |
| --- | --- |
| 0 Measurement | Opt-in, bounded local browser samples; per-request Server-Timing for authentication, session, cache, upstream, projection and serialization. No telemetry transmission. |
| 1 PWA installation | Essential shell/build-graph precache, optional chunks cached on demand, and a repeatable asset/byte budget check. Cached HTML is stamped per build so a new worker rejects obsolete shells naming removed chunks. |
| 2 Images and rails | Windowed Anime/discovery rails, bounded personal-list previews, nearby card mounting, retained keyboard focus and fixed slot geometry; responsive protected-image width buckets without offscreen priority. |
| 3 Watch reads | Four-read core home response; separately cached, independently failing shelves with at most three optional requests in flight. Details use explicit expansions; seasons load 50 episodes at a time. Existing API shapes remain available. |
| 4 Lazy UI | Dashboard grid editors, gallery and refresh drawer load on demand. Normal browsing uses a static CSS layout. Player chrome loads on first intent; its media element persists across activation, minimization, navigation and Stop. Starting playback closes the detail overlay. |
| 5 Authentication | Combined authentication/capability guards replace duplicate handler calls. Current session, user, capabilities, ownership and instance checks remain authoritative for every request. |
| 6 Libraries | Prepared search/sort keys, deferred search, visible-item actions, table-only projection, shared Anime annotation context, single-flight upstream fills, and cached serialized projections/ETags with generation and invalidation protection. |
| 7 Play and Stop | Immediate preparing/Stop feedback; selected playable items start before the remaining queue expands. New intent/Stop aborts obsolete reads and rejects late attachments. Local pause/detach precedes bounded reporting/encoding cleanup. |
| 8 Playback clock | Separate clock and general playback contexts; consumers without clock needs no longer subscribe to time updates. Reporting and subtitle timing remain unthrottled. |
| 9 Data policy | Persisted Automatic, 2 Mbps Data saver, and explicit quality choices. Automatic starts at 6 Mbps and uses bounded observed segment throughput with headroom/hysteresis for later negotiations. No screen-size assumption about network quality. |
| 10 Torrents | Projected list fields, separate widget counters, conditional responses, slower passive data-saver polling, and changed-field delta responses. Server-owned, bounded history is scoped by authenticated user/filter/mutation version; unknown or expired cursors reset to a full snapshot. |
| 11 Cancellation | Request-scoped cancellation reaches exclusive Jellyfin and torrent-detail reads; shared fills survive a single consumer abort. Reconnect schedules at most four active reads at once, foreground first. Accepted mutations are not canceled. |
| 12 Offline browse | Eligible saved JSON carries its original timestamp, expires after five minutes, and is explicitly labelled stale after a two-second stalled-network fallback. Retry clears the notice after fresh data arrives. Auth, live queues, mutations and other action-sensitive reads remain network-only. |

The plan's conditional full-library pagination and Web Worker remain unnecessary for the measured prepared-search workload. They are not silently represented as implemented. The torrent fixture did justify its conditional delta path, which was implemented. Delta history is derived from the existing shared upstream snapshot rather than introducing a new upstream sync dependency; it reduces client transfer while retaining the current two-second upstream cache.

## Build and automated checks

- `npm run lint`: passed, including settings-export validation.
- `npm test`: **1,000 passed, 5 skipped**, 159 passing files and one skipped file.
- `npm run build`: passed, including Next.js TypeScript checking.
- `git diff --check`: passed.
- `node scripts/check-precache.mjs`: passed.
- Final production build ID: `cmhxneEcfiMZJ-HDc0mc8`; repeated browser measurements used `J8dE47MDbJsE79U00235W`, followed by the final statistics-guard smoke check. Both builds emitted the same client webpack asset `webpack-f5644c805aef7525.js`. Base commit `98e64f84` plus the uncommitted working changes.

Focused coverage includes Stop/attachment races, immediate Play intent, isolated clock subscriptions, season pagination and independently failing expansions, auth revocation/role/capability changes on the next request, multi-instance cache invalidation, incomplete fills, protected-image sizes, 50/500-slot rail mounting/focus, offline provenance, reconnect scheduling, and torrent delta additions/removals/order/field removal/user isolation/cursor expiry/two consumers.

The standalone `tsc --noEmit` check also encounters existing test typing errors; the repository's required production build typecheck passes. No schema or migration changes were made.

## Measured results

### Installation artifacts

| Metric | Plan baseline | Final build |
| --- | ---: | ---: |
| Precached entries | 635 | 29 |
| Raw bytes | 8,623,760 | 1,163,130 |
| Sum of independently gzipped assets | 3,168,702 | 544,539 |

That is **86.5% fewer raw precache bytes** and **82.8% fewer independently gzipped bytes**. This is an artifact comparison, not a cellular installation trace. Framework/runtime dependencies, fonts and offline fallback remain; optional HLS/chart/editor chunks and backup icons are excluded. A live old-worker/new-build transition reproduced obsolete widget chunks before the shell-stamp fix; the new worker subsequently served the current webpack build, all widgets loaded, and the saved page carried its build stamp.

### Desktop browser journeys

Used production standalone on localhost:3052 with the isolated `helprr_dev` database/Redis; macOS 26.6.2 (25G83), Chrome 152, 1728×941 CSS viewport at DPR 2, Node 24.14.1. Readiness reported database, Redis and migrations healthy. The populated dashboard has 30 widgets; the media library has approximately 504 movies and 232 series. Torrent state changed from empty to one active seeding torrent during qualification.

- **Live movie:** decoded 1920-wide video with advancing time and readyState 4. The same media DOM node survived lazy chrome activation, pause, seek, quality changes, picture-in-picture and navigation. Pause intent survived a 2 Mbps quality restart. Fullscreen succeeded with the tab foregrounded and contained that same media node.
- **Detail overlay:** after the fix, starting the movie left zero open dialogs; the first Pause click paused the video.
- **Stop:** from active playback, source detach/local Stop completed **4.6 ms** after pointerdown while the stopped-session report was intercepted. Video was paused and its source absent immediately. Another minimized paused case measured 7.0 ms. These are local action measurements, not INP or physical audio-output timing. Prior real movie/episode and held-cleanup race evidence is in `plans/2026-09-07-live-playback/live-results.md`.
- **Dashboard:** all 30 widget positions and sizes were identical before and after entering/leaving edit mode. Save remained disabled without edits. Editor chunk was absent before edit and present afterwards; player chrome was absent before first Play. All widgets loaded after the current build was selected.
- **Library:** normal movie browse and search/clear worked. Live Radarr timing showed exactly **one auth verification and one session read**. Two final Jellyfin statistics reads each also reported one JWT verification and one session read (17.4/11.3 ms total). No route file still combines separate `requireAuth` and `requireCapability` calls. One projected read reported total 125.4 ms, session 13.7 ms, cache 8.8 ms, projection 99.9 ms and serialization 1.8 ms. Projection includes nested cache/upstream work: these spans must not be summed.
- **Torrents:** first `view=delta` read returned a reset; the next poll carried a cursor and changed fields for the seeding torrent. The inspected poll was **607 bytes**, preserving transfer fields without resending stable metadata.
- **Offline/stalled network:** pausing the test server produced a saved Radarr response after **2,010 ms**, marked `x-helprr-stale: 1` with the original timestamp. Reconnect scheduling showed the saved-data notice. Resuming the server and clicking Retry removed it.
- **Independent Watch shelves:** core content appeared at the 709 ms checkpoint while optional latest reads were held. At 76 seconds, core content remained usable and latest shelves were still absent.
- **Watch rails:** 14 interactive cards mounted while 163 slots existed during the independent-shelf check. Additional content mounted as it approached the viewport; fixed slots preserve rail geometry.

### Repeated startup observations

Five runs bypassed the page's HTTP cache and service worker; ten used normal warm browser caches. Server/upstream caches were retained, so the first group is **not a cold database/server benchmark**. “Ready” is the first diagnostic observation of the dashboard's overview/Now Streaming content with its configured slots, or Watch's Continue watching section. It includes tool observation delay and does not mean every poster or optional shelf has completed.

| Route | Cache mode | n | Median observed core ready | Range |
| --- | --- | ---: | ---: | ---: |
| Dashboard | HTTP/SW bypass | 5 | 496.7 ms | 479.1–498.8 ms |
| Dashboard | Warm | 10 | 453.6 ms | 363.1–483.5 ms |
| Watch home | HTTP/SW bypass | 5 | 171.5 ms | 153.7–769.7 ms |
| Watch home | Warm | 10 | 123.2 ms | 104.9–713.3 ms |

No long-task entry was observed before those core checkpoints. This does not qualify later work or physical mobile latency. Warm page Resource Timing omits service-worker-internal transfers, so its zero/near-zero byte counts are **not** asserted as total wire bytes. No equivalent pre-change route benchmark was captured; these figures establish the new baseline and do not prove a percentage startup speedup.

### Fixture measurements

The reproducible Node fixture benchmark and raw results are in `plans/2026-09-08-performance/benchmark.mjs` and `benchmarks.json`.

- Prepared movie search over 500/5,000/20,000 rows: 100 searches each. Recorded p95 search times were 0.011/0.046/0.343 ms; one-time preparation was 5.29/1.56/5.07 ms. These short desktop microbenchmarks exclude React, network and browser parsing; JIT warm-up affects the small-size ordering. Structural tests, not timing thresholds, enforce correctness.
- At 100/1,000/5,000 active torrent fixtures, a projected full list at five-second polling estimates 27,564/221,100/1,066,476 gzip body bytes per minute. Changed-field deltas estimate **8,304/68,352/334,080** respectively. The fixture changes every torrent's progress/download/upload counters and preserves stable metadata. HTTP headers and non-list requests are excluded; real compression depends on actual names and changing fields.
- Unchanged conditional responses have zero response-body bytes. Counter-only widget bodies stay below 100 raw bytes excluding transfer information.

## Limits and owner qualification

- **AniList live home was blocked by upstream HTTP 403.** The app returned its failure state; no successful live Anime-home qualification is claimed. Rail behavior is covered by fixtures and live Watch rails. Recheck Anime when upstream access recovers.
- Android, iPhone, native iOS HLS, cellular network shaping, app suspension, lock/unlock, audio routing and memory-pressure recovery remain owner tests. macOS Safari/Firefox were not qualified in this pass.
- Authentication/ownership/partial-failure coverage is automated; the live browser used the linked administrator, not a second restricted account.
- The new local benchmark does not replace before/after physical-device traces, heap profiles, field INP or a release qualification. Conditional server pagination should be reconsidered if transfer/parse dominates on a real large mobile library.
- Delta history is bounded to 64 entries, 60 seconds and 16 MiB of serialized payload accounting. Process restart, eviction, filter/permission-scope changes or mutation-version changes cause a safe full reset; there is no persistent client cursor dependency.

## Review and rollback

Review the working diff and the results before committing or publishing. No database migration or data conversion is involved. Existing non-section catalog endpoints, full library APIs and full torrent-summary responses remain compatible. Each feature can be reverted in a follow-up code change; deploying a prior build requires its matching assets/worker. Do not reuse a cached page across builds. No media data, user settings or stable deployment must be erased to roll back these optimizations.

Local logs, fixture scripts and browser evidence are kept under `plans/2026-09-08-performance/`. Generated production `public/sw.js` is removed from the source tree after qualification so a later `npm run dev` cannot serve it accidentally.
