# Performance implementation results — 9 September 2026

Implemented the twelve packages plus opt-in measurement from [the performance plan](performance-improvement-plan-2026-09-06.md). The original implementation was committed and pushed as `456a84e0` on `codex/stop-responsiveness`. This follow-up records the subsequent fixes and qualification; no release or deployment was performed. Android and iPhone qualification belongs to the owner, as requested.

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
| Raw bytes | 8,623,760 | 1,163,296 |
| Sum of independently gzipped assets | 3,168,702 | 544,550 |

That is **86.5% fewer raw precache bytes** and **82.8% fewer independently gzipped bytes**. This is an artifact comparison, not a cellular installation trace. Framework/runtime dependencies, fonts and the offline fallback remain; optional HLS/chart/editor chunks and backup icons are excluded.

The offline fallback was in the manifest but **not functional until the follow-up fix below**: `/offline.html` was missing from `src/middleware.ts`'s public allowlist, so precaching followed its `307` to `/login?next=%2Foffline.html` and stored login HTML under the `/offline.html` key. Adding it to `PUBLIC_EXACT_PATHS` fixed it; the page's inline `onclick` was also replaced with an anchor, because the nonce + `strict-dynamic` CSP neutralises `unsafe-inline` and the button was inert once the document became reachable. Byte figures above are from the build carrying that fix. A live old-worker/new-build transition reproduced obsolete widget chunks before the shell-stamp fix; the new worker subsequently served the current webpack build, all widgets loaded, and the saved page carried its build stamp.

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

#### Independent re-verification (9 Sep 2026, Chrome 152, 1728px)

Re-measured rather than taken from the notes above. Every automated gate was re-run on the same tree: lint, production build, `git diff --check`, the precache budget, and **1,007 passing tests with 5 skipped** (up from 1,000 with the two follow-up test files).

- **Optional shelves under a real stall.** With `section=latest` and `section=favorites` held for 45 s at the proxy, `section=core` returned in **536 ms** and carried a fully usable page — hero metadata, Play and More Info, and every core rail heading — with **zero loading indicators**. All three delayed shelves later returned 200 at 45.5–45.9 s: independently cached, independently slow, never blocking and never cancelled.
- **Season pagination.** No season in the library exceeds 50 episodes, so the client's own 50-per-page path cannot be exercised here; the contract underneath it was verified directly instead. Walking a 28-episode season at `episodeLimit=10` replayed `getNextPageParam` exactly: `episodesStart` echoed each request, pages returned 10/10/8, the concatenation matched the unpaginated reference **in order with no duplicates**, and the walk terminated after three requests without probing past the end.
- **Playing a middle episode** started the selected item and no other (`streamedIsTargetEpisode`), with the remaining queue expanding behind it.
- **Dashboard editing.** Entering and leaving Edit with no changes left all 30 widget geometries byte-identical, and offered no Save or Discard. After a drag on `.bento-drag-handle`, Discard appeared, Done issued a single `PUT /api/dashboard-layouts/<id>` carrying the moved coordinates, and the change survived a full reload. React-grid-layout mounts **only** in Edit mode — normal browsing has zero `.react-grid-item` nodes, confirming the static CSS layout.
- **Prepared library search.** Six rapid keystrokes into the 504-title movie library issued **zero** network requests; the grid deferred rather than recomputing per keystroke, settled to 4 matches, and restored all 34 cards on clear — also with zero requests.
- **Measurement note.** `performance.getEntriesByType('resource')` caps at 250 entries and then records nothing, so it cannot be used to prove a chunk was not loaded on a 30-widget dashboard. Diff `script[src]` after clearing and enlarging the buffer instead.

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
- Android, native iOS HLS, cellular network shaping, audio routing, lock/unlock, rotation and memory-pressure recovery remain owner tests. macOS Safari and Firefox are still unqualified — the automation available drives Chromium only.
- **iPhone PWA qualification (9 Sep 2026, iPhone 17 simulator, iOS 26.4, home-screen install over the tailnet origin).** Verified: play/stop for a movie with the stopped report ordered before `stop-encodings` and no media requests after Stop; stop-before-load followed immediately by a different title, with only the latest streaming; resume from a detail page restoring position and closing the overlay; pause pinning the chrome; the subtitle panel; Data saver renegotiating to `VideoBitrate=1616000` under its 2 Mbps ceiling while staying paused, persisted as `helprr:playback-bitrate = -1`; the labelled stale-snapshot path and its recovery; `qbittorrent/summary?view=delta` returning a reset then a cursor; and a cold reopen in 30 requests with no chunk 404s. A 30-second background kept the pause state and the position advanced only as far as the buffer allowed.
- **A production→production worker transition was qualified separately:** an installation holding shell stamp `eb179753…` opened cleanly against a build stamped `17dd39e1…`. A PWA installed while the origin served `npm run dev` is a different case and does **not** self-heal — it holds a `/sw-push.js` registration and a Turbopack shell, 404s every dev chunk, and renders blank until the installation's `ServiceWorkers/` and `CacheStorage/` are cleared once.
- **Pre-existing defect reported during qualification, addressed by the follow-up below — MKV direct play stalls silently on Chromium.** `testCanPlayMkv` trusts `canPlayType('video/x-matroska')`, which Chrome 152 answers `"maybe"`, and the `mkv` direct-play profile advertises the **MP4** codec list. An HEVC-in-MKV episode (589 kbps, so no bitrate ceiling rejects it) is therefore offered for direct play, and Chrome neither decodes it nor raises an `error` event: `readyState` stays `0`, `networkState` stays `NETWORK_LOADING`, not one media byte is requested, and the session keeps reporting `playing` every 10 s. Chrome decodes the same codec inside MP4. Neither the direct-play→transcode retry (it needs an `error` event) nor the new `waiting`-based stall detector (it needs a `waiting` event and `reachedStart`) can fire, so nothing recovers. Not introduced by this work; a load-timeout guard and a container-specific codec list are the fixes. `MaxStaticBitrate: bitrateSetting` behaves as designed and simply cannot help a file this small.
- Authentication/ownership/partial-failure coverage is automated; the live browser used the linked administrator, not a second restricted account.
- The new local benchmark does not replace before/after physical-device traces, heap profiles, field INP or a release qualification. Conditional server pagination should be reconsidered if transfer/parse dominates on a real large mobile library.
- Delta history is bounded to 64 entries, 60 seconds and 16 MiB of serialized payload accounting. Process restart, eviction, filter/permission-scope changes or mutation-version changes cause a safe full reset; there is no persistent client cursor dependency.

## Follow-up review of the seven reported concerns

The independent tester's report was checked against the source. Browser/device testing was not repeated for these follow-up changes, at the owner's request. Earlier measurements and simulator results describe the earlier tree, not qualification of these fixes.

| Concern | Assessment and action |
| --- | --- |
| Silent MKV startup / false playing state | Valid. Matroska now requires explicit `probably` responses for its own video and audio codecs; a generic container `maybe` and MP4 codec support no longer enable it. Startup waits for the play promise and usable media data, with a 30-second bound even when no media event arrives. One fallback negotiation disables direct play/stream; a second silent failure produces an error. Progress reporting skips media without current data. An autoplay denial remains paused rather than triggering codec recovery. |
| Two-second saved-data fallback | Intentional policy, not a demonstrated defect. It returns a labelled, at-most-five-minute-old snapshot while the network request continues. A slow healthy server can trigger the notice; this threshold is not a network request deadline. Cellular qualification remains open. |
| Detail resume stale after Stop | Valid. After the stopped report settles, invalidate catalog queries, including all item expansions and home shelves. Active queries refetch after server-side catalog invalidation; local Stop still completes before any network wait. |
| Safe-area coverage missing | Valid. Coverage now pins the emitted safe-area CSS, normal-flow positioning, a nonshrinking 44 × 44 Retry target, Retry interaction and stale-to-fresh visibility. jsdom cannot measure real notch geometry; the CSS assertion checks the emitted markup. |
| Notice obscures top navigation | Valid layout conflict. Mount the notice inside AppShell's main content in normal flow. Its wrapped height moves the following content down and no longer overlays the top navigation. It scrolls with the page. |
| Failed container catalog lookup errors | Confirmed intentional behavior change. Albums, playlists, folders, artists and box sets need a successful child lookup; a failed lookup surfaces a queue error rather than treating the container itself as a playable file. Already playable movies/episodes still start independently of optional queue expansion. |
| Duplicate stop-encodings during restart | Valid. The restart/seek/recovery path identifies the outgoing session it already released; replacement startup skips its second cleanup for that session. Superseded newly granted sessions still receive cleanup. |

The earlier offline-document correction is retained: `/offline.html` is public by exact match, its Retry link requires no inline JavaScript, and changing the document bytes changes its precache revision so a worker update can replace a cached login response.

Follow-up checks passed: `npm run lint`, **1,016 tests passed / 5 skipped**, `npm run build` (build `k3ykYrgscG3kZ9KeA21Sl`), `git diff --check`, and the precache budget (29 entries, 1,163,184 raw bytes). Logs are in `plans/2026-09-09-pwa-regressions/followup-*.log`. These checks do not constitute another live playback or iPhone acceptance pass.

## HEVC HLS browser recheck (9 Sep 2026)

At the owner's subsequent request, rechecked the reported episode in Chrome against the isolated production server on localhost:3052, build `Bv1jAwN1dhIb4-kvFSKeV`. Friends S1E1 “Pilot” is HEVC in MKV at 588,564 bps. Its decoded `main.m3u8` was **244,428 bytes**. Normal playback negotiated `Transcode`, fetched the init fragment and media segments with HTTP 200, rendered 1280-wide video at `readyState=4`, and advanced from 104.66 to 120.72 seconds after resuming. The original no-segments failure did not reproduce. The page also contains an idle preview video at `readyState=0`; diagnostics must distinguish that element from the active player. This is a possible measurement pitfall, not a confirmed explanation of the earlier observation. No server encoder failure was established.

With HLS init/media requests deliberately withheld in the browser, the existing startup guard made one fallback attempt and displayed “Playback did not start. Try again or choose another quality.” after both attempts timed out. This exposed a valid cleanup defect: the terminal error left hls.js attached and retrying. The final failure path now retires its callbacks, aborts optional queue expansion, pauses media, destroys the player engines, and releases the failed encoding session without delaying the error UI. A regression test failed against the old behavior because one HLS instance remained alive, then passed with the fix.

The updated live failure check recorded exactly two negotiations, final encoding cleanup returning HTTP 200 at 60.33 seconds, and no playback reports. The error was visible at the 61.19-second observation. Through 81.92 seconds, no further HLS media requests occurred and both media elements stayed paused. Normal playback was then rechecked successfully with interception removed. These are desktop browser checks, not native iOS HLS or physical-device qualification.

Final gates passed: lint, **1,017 tests passed / 5 skipped**, production build, `git diff --check`, and the precache budget (29 entries, 1,163,184 raw bytes). Evidence and logs are under `plans/2026-09-09-hls-startup/`. Earlier measurements above retain their original scope.

## Review and rollback

Review the working diff and the results before committing or publishing. No database migration or data conversion is involved. Existing non-section catalog endpoints, full library APIs and full torrent-summary responses remain compatible. Each feature can be reverted in a follow-up code change; deploying a prior build requires its matching assets/worker. Do not reuse a cached page across builds. No media data, user settings or stable deployment must be erased to roll back these optimizations.

Local logs, fixture scripts and browser evidence are kept under `plans/2026-09-08-performance/`. Generated production `public/sw.js` is removed from the source tree after qualification so a later `npm run dev` cannot serve it accidentally.
