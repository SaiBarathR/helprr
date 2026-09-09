# Performance review and implementation plan

Reviewed 2026-09-06 at `d23ba09719247a91794e4f48fd591df2d26e6653`, on
`codex/mobile-responsiveness`. This records the original review and plan.

Implementation status, 2026-09-09: see [the implementation results and qualification limits](performance-implementation-results-2026-09-09.md).

The largest remaining opportunities are reducing work before the first useful
screen, reducing the amount of data required by a screen, and preventing
background/rendering work from competing with interactions. The recent navigation
fix gives immediate feedback; it does not remove those underlying costs.

## Evidence and limits

The inventory contains 91 authenticated page files, 281 API route files, and 284
component TSX files. The review traced the shared shell, dashboard, library lists,
anime/discovery rails, Watch home/detail/playback, activity/torrents, image pipeline,
query lifecycle, authentication, Redis caching, and service worker. This was a
targeted review of shared and high-traffic paths, not a claim that every line or
every feature was profiled.

Evidence categories used below:

- **Confirmed:** the dependency, request sequence, allocation, or configured behavior
  is visible in current source or the existing production build.
- **Expected impact:** the resulting user cost follows from that behavior, but its
  magnitude still requires a controlled benchmark on representative data/devices.
- **Measurement required:** a plausible secondary issue that should not receive a
  large refactor without profiling evidence.

No new Android/iPhone hardware profiling or reliable network-throttled benchmark
was performed for this review. The preceding implementation pass tested local
production navigation and held a route response explicitly; its 6–16 ms feedback
samples are not whole-app INP, cellular throughput, or physical touch latency.
Chrome DevTools MCP is unavailable, and the previous browser emulation did not
reliably enforce its requested network latency. No Lighthouse scores are invented.

### Quantified build/source evidence

| Observation | Result | Meaning / limit |
| --- | ---: | --- |
| Production service-worker precache | 635 entries | Entire install/update workload, not first-page JS alone |
| Sum of those assets | 8,623,760 raw bytes | All 635 URLs resolved to build/public files after URL decoding |
| Sum after independently applying Node gzip | 3,168,702 bytes | Compression estimate; actual transport, reuse, and headers determine transfer |
| Precached lazy HLS chunk | 509,987 raw / 156,159 gzip bytes | HLS is dynamically imported in source, but still in the SW install list |
| Precached chunk containing Recharts | 320,072 raw / 97,629 gzip bytes | Excluding widget entry chunks has not excluded every shared lazy dependency |
| Precached backup icons | 247,509 raw bytes | `icon-192.png.bak` plus `icon-512.png.bak`; no references found in app source/manifest |
| Chunk set attached to `streaming-root.tsx` in dashboard client-reference manifest | 17 files, 369,920 raw / 121,444 gzip bytes | Includes shared chunks; **not** the removable size of playback alone |
| Chunk set attached to `dashboard-client.tsx` | 21 files, 466,986 raw / 147,930 gzip bytes | Overlaps the previous set; do not add the two figures |
| API files containing separate `await requireAuth()` and `await requireCapability()` calls | 129 | Candidate duplicate auth work; not 129 calls per page |

Method: inspect `.next/server/app/(app)/dashboard/page_client-reference-manifest.js`,
`.next/react-loadable-manifest.json`, and `.next/standalone/public/sw.js` from the
production build used by the preceding verification. Sum each distinct listed
file's size; gzip each separately. Chunk hashes and these figures must be regenerated
for the eventual implementation build. The HLS identity is also recorded in the
loadable manifest; Recharts identification comes from the chunk contents.

## Existing improvements to preserve

The code already has immediate navigation feedback, lazy dashboard widget entries,
viewport-aware widget activation, windowed Watch rails, virtualized movie/series/
torrent views, query cancellation in shared fetchers, demand-driven watch/request
maps, conditional ETags on movie/series libraries, bounded image processing, and
visibility-aware polling. HLS and libass are already dynamically imported at runtime.
Do not propose those as absent, or replace the architecture wholesale.

Keep every API's authentication/capability/ownership checks, multi-instance identity,
post-mutation invalidation, truthful partial failures, logout cache clearing,
offline fallback, and playback pause/track/session semantics.

## Priority and delivery order

P1 means a high-value next improvement, not a confirmed production outage. Effort
is relative: S = localized change; M = several coordinated modules; L = API/UI
contract or lifecycle work. These are planning estimates, not delivery promises.

| Package | Work package | Priority | Expected benefit | Effort |
| --- | --- | --- | --- | --- |
| 0 | Reproducible baseline and performance budgets | Required first | Know which changes help real users | M |
| 1 | Reduce precache to essential assets | P1 | Less install/update traffic and contention | M |
| 2 | Right-size images and window anime/discovery rails | P1 | Less mobile transfer, decoding, and React work | M |
| 3 | Make Watch APIs return core content independently | P1 | Shorter blank/loading periods; isolate slow services | L |
| 4 | Remove eager editor/player UI from common loading paths | P1 | Faster hydration and cold startup | M |
| 5 | Resolve authentication once per API request | P1 | Less DB/CPU load across almost every screen | M |
| 6 | Reduce full-library derivation and response work | P1 | Responsive search/filter and large-library loading | M/L |
| 7 | Make Play/Stop immediate and interruptible | P1 | Playback controls respond before network completion | M |
| 8 | Separate playback clock updates from other consumers | P1 | Smoother browsing while media plays | M |
| 9 | Mobile-data playback policy | P1 for streaming | Avoid unsuitable default media bitrate | M |
| 10 | Smaller live torrent responses and restrained polling | P2 | Lower sustained data use | M/L |
| 11 | Complete cancellation and reconnect scheduling | P2 | Less obsolete work competing with new actions | M |
| 12 | Make cached/stale/offline state explicit | P2 | Useful warm starts with truthful freshness | M/L |

Do one package, or a bounded slice of a large package, per reviewable change. Record
before/after results after each change. After the baseline, fix Stop ordering from
package 7, then tackle packages 1, 2, and 5. Follow with 3, 4, and 6; then the remaining
playback work in 7–9; then 10–12 as measurements justify. Packages 3, 6, 9, and 12 need
contract/behavior decisions written into their tests.

## 0. Establish a repeatable baseline

**Evidence.** `src/lib/server-perf.ts` provides selected console timings; image
routes expose queue/upstream `Server-Timing` values. No app-wide
`PerformanceObserver`, `useReportWebVitals`, or route/action performance marks were
found. Some API duration logs stop before serialization, so they do not measure
the complete request cost.

**Implementation.** Add a small, opt-in local performance collector and a repeatable
production-build harness. Measure interaction start → first feedback paint separately
from route content ready, first data ready, first poster ready, and full request
completion. Add server spans for auth, cache, upstream, projection, and serialization
on hot read routes. Record request counts, compressed bytes, cache state, mounted
card counts, long tasks, and React commits. Record route templates, not media names,
search text, cookies, or tokens. Do not send telemetry to an external service.

Use the isolated development stack and production builds. Keep `public/sw.js` away
from the source dev server after builds. Test the same fixture sizes and service
latencies before and after each change. Do not use the dev server as the benchmark.

**Initial acceptance targets, to calibrate against baseline:** p95 interaction
feedback under 100 ms in the chosen controlled mobile profiles; field INP at or
below 200 ms where measurable; no task over 50 ms caused by routine search/filter
or a playback clock update. These are targets, not current measurements. INP is a
visit-level metric and is not interchangeable with a single click timing.
[INP guidance](https://web.dev/articles/optimize-inp?hl=en).

Use physical input-to-visible-feedback testing on browsers without the required
performance APIs. Record supported metrics rather than substituting zeroes.

## 1. Stop downloading optional code during every PWA installation

**Confirmed evidence.** [next.config.ts](/Users/ginpachi/Dev/helprr/next.config.ts:11)
excludes libass public files and chunks directly containing widget entry modules.
It keeps initial chunks and other lazy dependencies. The generated manifest still
contains HLS, Recharts, route assets, and `.bak` icons. The worker registers at mount
in [sw-register.tsx](/Users/ginpachi/Dev/helprr/src/components/sw-register.tsx:7).
Its install can therefore overlap first-screen requests.

**Implementation.** First exclude unused backup files. Then generate an explicit
essential-asset policy from the build graph: offline document, required install
icons/fonts, framework, and assets needed to hydrate the supported initial shell.
Leave optional player engines, editor/gallery UI, noncritical route chunks, and
lazy chart dependencies to existing runtime caching. Analyze shared dependencies
instead of excluding every chunk with a matching filename. Add a manifest assertion
that optional lazy HLS/libass/editor chunks and `.bak` assets are absent.

**Acceptance.** Measure actual cold-install and warm-update bytes; verify fresh
install, offline fallback, first chart, first HLS/ASS playback, old-tab update,
and failed optional chunk download/retry. Preserve the small static shell needed
offline. Do not globally delay registration and accidentally delay Web Push.
Target a substantial measured reduction from the 3.17 MB synthetic gzip total;
set the precise budget after identifying the essential graph.

## 2. Render and download only nearby rail content at appropriate sizes

**Confirmed evidence.**
[AnimeMediaRail](/Users/ginpachi/Dev/helprr/src/components/anime/anime-media-rail.tsx:322)
maps every item and marks the first four of **every** rail as priority, independent
of vertical visibility. Each card owns action/dialog state and query consumers.
Anime home loads the entire CURRENT and PLANNING lists for its rails, without a
home-preview cap. DiscoverMediaRail also marks four images per rail as priority.
This differs from the already-windowed Watch rails.

The anime card calls `toCachedImageSrc` without a width, then marks the resulting
protected URL `unoptimized`. The proxy's
[default width is 600](/Users/ginpachi/Dev/helprr/src/app/api/image/route.ts:77).
The `sizes` string alone does not produce responsive variants for these unoptimized
URLs. A small poster can therefore download/decode a 600-pixel image unnecessarily;
appropriate resolution depends on its CSS size and device pixel ratio.

**Implementation.** Reuse the geometry-preserving WindowedRailItems approach for
anime/discovery rails. Defer whole sections until near the viewport, then mount a
bounded horizontal window with focus-aware overscan. Keep stable wrappers and snap
positions. Start with a capped preview of personal library rails and an explicit
View All/pagination route. If the upstream cannot paginate that collection cheaply,
still project/cap the browser response; do not describe it as upstream savings.

Provide one selected-item action/dialog host per rail/page. Mark only the actual
hero and visible first-row artwork as eager. Build a protected-image component
with a same-origin loader/srcset using a small width bucket set such as
160/240/320/480/640, selected from displayed width × DPR. Preserve authorization,
generation stamps, cache keys, image validation, and the existing sharp queue.
Avoid requesting both a default source and a replacement source during hydration.

**Acceptance.** Test 50/500-item personal lists, long horizontal scroll, keyboard
focus, context actions, and back restoration. At first paint, offscreen rails must
not request their priority posters. Mounted interactive cards must scale with the
viewport/overscan, not the entire collection. Compare image bytes, naturalWidth,
visual quality at DPR 2/3, decoded memory, and server transform queue wait. Do not
remove the protected proxy or raise its concurrency to mask excessive requests.

## 3. Split Watch home/detail into core content and independent sections

**Confirmed evidence.**
[home/route.ts](/Users/ginpachi/Dev/helprr/src/app/api/jellyfin/catalog/home/route.ts:33)
waits for seven requests, then starts up to twelve latest-library requests: up to
19 upstream calls in two stages before one response. The second stage unnecessarily
waits for all seven initial results, not just the library list. There is no response
cache/single-flight at this handler. `getUpcoming` and movie recommendations produce
fields with no reads found in current Watch UI consumers. The cinematic header uses
the entire home payload merely to obtain library views, including on other Watch
routes; its shared query avoids duplicates within one client but not the overfetch.

[item detail](/Users/ginpachi/Dev/helprr/src/app/api/jellyfin/catalog/items/[itemId]/route.ts:27)
waits for the core item and all expansion jobs. Several expansions happen by type
regardless of the requested `expand` set. The modal requests episodes for a series
before displaying core information; the series request has no season restriction.
Even `expand=segments` can trigger additional type-based jobs.

**Implementation.** Introduce small views/core-item reads and separately keyed
home/detail section reads. Make expansion names authoritative in a new explicit
contract; migrate consumers before changing legacy defaults. Load hero/title/play
controls from core data, episodes only for the active season with pagination, and
similar/trailers/children as their sections approach the viewport. Start per-library
latest reads as soon as views resolve, with bounded concurrency. Migrate the header
to views-only data. Stop requesting unused upcoming/recommendation sections after
checking remaining API consumers; do not silently remove public response fields.

Use short, per-user/per-Jellyfin-identity caches and in-flight deduplication for safe
reads. Keep authorization before cache access. Watched/favorite/link changes must
invalidate affected snapshots. Represent a failed section separately from a truly
empty one; do not cache a partial result as complete.

**Acceptance.** Hold a latest/recommendation/episode endpoint for 30 seconds: core
content and unrelated sections must still appear. Header navigation must not fetch
home rails. Opening a long-running series should request its selected season, not
all episodes. Test admin and linked/unlinked members, favorite/watch mutations,
two Jellyfin identities, and one failed library. Record call counts and first-core
response time, not just total completion time.

## 4. Reduce eager shell and dashboard editing code

**Confirmed evidence.**
[streaming-root.tsx](/Users/ginpachi/Dev/helprr/src/components/jellyfin-streaming/streaming-root.tsx:3)
statically imports the playback provider, VideoStage, and NowPlayingBar for every
authenticated page, including non-Watch pages and users who cannot use Watch.
VideoStage imports settings, queue, connection, and subtitle UI. The media engines
are already lazy; the surrounding player UI is not.

[dashboard-client.tsx](/Users/ginpachi/Dev/helprr/src/app/(app)/dashboard/dashboard-client.tsx:9)
eagerly imports the widget gallery and refresh drawer. Both grid variants import
react-grid-layout; the mobile grid also imports its item component from the desktop
grid module. Disabling dragging in view mode does not remove the editor code cost.

**Implementation.** Lazy-mount gallery/configuration UI only when opened, with an
immediate closable loading shell. Extract shared widget cells from the desktop grid
module. Benchmark a static positioned/CSS layout for normal view mode, loading the
drag/resize implementation on entering edit mode while preserving exact stored
geometry and compaction semantics.

First lazy-load dormant player panels/stage UI around a stable playback owner. If
the baseline shows the remaining provider is costly, introduce a lightweight action
facade that loads the controller once on first playback intent and keeps it mounted
across routes. Preserve a stable media element and user-gesture handling; blindly
delaying its creation can break Safari playback. Keep a clear preparing state and
retry when a lazy chunk fails. Follow
[Next.js lazy-loading guidance](https://nextjs.org/docs/app/guides/lazy-loading).

**Acceptance.** Compare cold dashboard/non-Watch JS and hydration time. No editor
chunks before edit intent. No dormant panel chunks before player intent. Verify
first play on physical Safari, background audio across routes, mini-player, connect
gate, close/reopen, and all mobile/desktop saved dashboard layouts. Determine
removable bytes from a fresh bundle graph; the shared chunk totals above are not
an estimate of savings.

## 5. Resolve the authenticated user once per API invocation

**Confirmed evidence.** [auth.ts](/Users/ginpachi/Dev/helprr/src/lib/auth.ts:83)
uses React `cache()` around the session DB read, with a comment asserting duplicate
guards share the result. React documents that cache access is supplied in Server
Components; outside that context the memoized function does not share its result.
Route handlers should not rely on that mechanism.
[React cache documentation](https://react.dev/reference/react/cache).
Hot routes such as Radarr separately call requireAuth and requireCapability, each
decoding/loading the session. Actual SQL multiplicity must be verified in the
production handler harness, rather than inferred from mock test memoization.

**Implementation.** Prefer the existing `requireUserCapability(cap)` once, pass its
user/session to service helpers, and eliminate redundant downstream user lookup.
For genuinely multiple checks in one handler, evaluate them against that resolved
user. Review each handler individually; do not remove a distinct capability or
target-instance/ownership check. No cross-request session cache or TTL: revocations
and role changes must remain effective on the next request.

**Acceptance.** Count JWT verification and session SQL reads per request for image,
library, queue, and settings reads. Aim for one session load where one is sufficient.
Verify unauthenticated 401, incapable 403, disabled/revoked sessions, role changes,
ownership, and secondary-instance authorization. Test separate consecutive requests
to prove deduplication has not become stale authorization caching.

## 6. Reduce whole-library CPU, response size, and cold-cache duplication

**Confirmed evidence.** Movie/series lists are already slim and virtualized, but the
client still downloads the whole collection. In
[movies/page.tsx](/Users/ginpachi/Dev/helprr/src/app/(app)/movies/page.tsx:393),
search/filter performs collection-wide work and sort, context-action objects are
created for every movie, and table rows are derived even when another view is shown.
The context-action memo depends on navigation callbacks that change with search.
Virtualization limits DOM work, not these calculations.

[Radarr GET](/Users/ginpachi/Dev/helprr/src/app/api/radarr/route.ts:101)
resolves labels and maps the entire collection before
[etagJson](/Users/ginpachi/Dev/helprr/src/lib/etag-json.ts:13) serializes and hashes it,
even for an unchanged 304. Tagged-library cache misses have no internal single-flight
guard; direct routes and background warming can independently duplicate work.
Separately, anime home calls the annotation helper five times, and each call rebuilds
the full ARR lookup structures in
[anime-library.ts](/Users/ginpachi/Dev/helprr/src/lib/anime-library.ts:38).

**Implementation, first pass.** Defer expensive search results from the urgent input
state, normalize sortable/searchable keys once, avoid sorting again when only the
search subset changes where ordering permits, and build actions only for mounted or
selected items. Derive table-only structures only in table mode. Build one annotation
context per anime-home request and reuse it across all sections. Add single-flight
to tagged-library loading keyed by scope, instance, cache generation, and invalidation
version; a pre-mutation load must not repopulate a post-mutation cache.

Cache the projected serialized list plus its ETag/version so warm revalidation does
not repeat mapping/stringification/hash work. Invalidate on library changes and on
profile/tag/instance label changes. Retain full-object consumers and per-instance
labels; do not remove overview or sort fields still used by a selected view.

**Conditional second pass.** If large-library first transfer/parse still dominates,
add a paged list endpoint with server-side search/filter/sort over the cached snapshot.
Include total count and stable snapshot/cursor identity. Retain existing list APIs
for other consumers. Bulk “select all filtered” must resolve the full authorized
selection, not just loaded rows. Watched filtering needs equivalent server-side
identity matching before migrating it; otherwise retain that mode's existing path.
Do not introduce a Web Worker before measuring whether the simpler changes suffice.

**Acceptance.** Use 500/5,000/20,000 media fixtures, title/date/quality sorts, watch
filters, multi-instance overlapping IDs, bulk actions, and scroll restoration. Hold
a cold upstream load while simultaneous page/poller requests arrive and verify one
load per key. Assert invalidation races cannot restore deleted media. Compare input
latency, derived allocations, 200/304 server CPU, JSON bytes, and peak browser memory.

## 7. Make Play and Stop respond before their network work

**Confirmed evidence.**
[playItems](/Users/ginpachi/Dev/helprr/src/components/jellyfin-streaming/playback-provider.tsx:1131)
awaits `Promise.all(items.map(resolvePlayable))` before setting the queue or calling
startItem. Series/albums/folders can require network expansion. startItem has
supersession protection and loading state, but those begin after this initial
resolution stage. A slow album/series selection can therefore appear ignored, and
two unresolved play selections can finish out of order before startItem owns them.

There is an even more direct responsiveness problem in
[stop](/Users/ginpachi/Dev/helprr/src/components/jellyfin-streaming/playback-provider.tsx:1178):
it awaits the stopped-session report and encoding cleanup **before** calling
`el.pause()`, clearing the stream, or hiding the player. Both are network requests.
A stalled cleanup can therefore delay the visible and audible result of Stop.
The local Pause toggle already acts synchronously and should retain that behavior.

**Implementation.** Reserve the play-intent token and set preparing-item state at
the public play action boundary. Open the relevant player shell immediately. Make
queue resolution abortable and bounded; resolve the selected playable first when
queue order permits, then fill remaining entries. Retain correct flattenPlayables
index mapping. Shuffle needs a well-defined queue snapshot, so show preparation
while it resolves rather than start an incorrect item. Apply supersession checks
to the resolution stage as well as stream attachment and clean up replaced sessions.

For Stop, capture the outgoing session and final position first, immediately pause
and detach local playback, retire its intent, and clear the visible state. Send the
captured stopped report and bounded encoding cleanup afterward, with errors handled
without restoring the old player. Cleanup must retain the old session ID and must
never destroy a newer player started while the previous cleanup is pending. Preserve
report ordering and final resume position; do not make local Stop wait for the server.

**Acceptance.** Delay series/album expansion, tap another item, close, retry, and
select a middle queue entry. Latest intent must win, no stale audio may begin, and
preparation must appear before the network returns. Retain pause intent, source/
audio/subtitle selection, connect gating, repeat/shuffle, and stopped reports.
Hold both stop endpoints: sound and player UI must stop immediately. Start another
item during cleanup, release the old responses, and verify the new stream survives.

## 8. Keep playback clock updates out of unrelated React consumers

**Confirmed evidence.**
[onTime](/Users/ginpachi/Dev/helprr/src/components/jellyfin-streaming/playback-provider.tsx:1449)
sets position state on timeupdate; position is part of the large
[PlaybackContext value](/Users/ginpachi/Dev/helprr/src/components/jellyfin-streaming/playback-provider.tsx:1689).
Consumers that only need `playItem` or `status` subscribe to the same changing object.
The impact scales with mounted consumers, including previews, pages, and modal UI;
it does not imply every non-consuming descendant automatically rerenders.

**Implementation.** Split stable actions, infrequently changing playback state, and
position/buffer telemetry into separate contexts or a selector-based external store.
Only visible progress/lyrics controls subscribe to the clock. Keep imperative seek,
skip, Media Session, and report positions in refs so action callbacks remain stable.
Do not throttle authoritative playback reporting or subtitle timing to reduce UI work.

**Acceptance.** React Profiler should show no clock-driven commit in a page/preview
that only reads actions or idle status. Test scrolling while audio plays, scrubbing,
lyrics, mini-player/expanded transitions, background/resume, and rapid track changes.

## 9. Make streaming bitrate policy usable over mobile data

**Confirmed evidence.** The initial maxBitrate is zero (“Auto”).
[fetchStream](/Users/ginpachi/Dev/helprr/src/components/jellyfin-streaming/playback-provider.tsx:138)
uses a 120 Mbps device-profile ceiling for that setting and omits an explicit
maxStreamingBitrate request value. Manual lower limits exist, but the default path
does not derive a connection budget. This is a ceiling, not a claim that all streams
transfer at 120 Mbps. It can nevertheless admit media beyond cellular throughput.

**Implementation.** Offer a persisted playback data preference such as automatic,
data saver, and an explicit bitrate. Make the effective ceiling visible and allow
immediate manual override. Bound Auto using measured transfer/buffering evidence
and conservative initial negotiation, with hysteresis to avoid repeated transcode
restarts. Audit the server's profile/MaxStaticBitrate and direct-play decisions so a
selected ceiling applies to direct sources as well as transcoding. Do not infer
cellular state from “mobile screen.” Use Network Information only as an optional
hint: [availability is limited](https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation).

**Acceptance.** Test representative low/high-bitrate files on real 3G/4G and Wi-Fi,
direct play, native Safari HLS and Android MSE/HLS, no-transcode permission, and slow
transcoding hardware. Measure startup, rebuffer ratio, and bytes/minute. Preserve
HDR/audio/subtitle capability rules. If the server cannot supply a suitable stream,
show that limitation rather than repeatedly retrying or silently ignoring the cap.

## 10. Stop retransmitting complete torrent lists at every live poll

**Confirmed evidence.**
[qBittorrent summary](/Users/ginpachi/Dev/helprr/src/app/api/qbittorrent/summary/route.ts:28)
fetches and returns the complete matching torrent array plus transfer metadata.
Its two-second Redis cache/single-flight reduces upstream work, but each successful
client poll still receives a full JSON response. The default page poll is five
seconds. Existing client row reconciliation saves rerenders, not wire bytes.

**Implementation.** First project only fields used by the list and move infrequent
metadata to a slower resource. Separate transfer counters from the torrent snapshot
and add conditional responses for unchanged data. If bytes remain high at realistic
torrent counts, implement an authorized versioned delta endpoint (changed rows,
removed hashes, full-reset marker) backed by a server-owned qBittorrent sync state.
Do not expose upstream credentials or reuse one client's cursor incorrectly across
filters/sessions. Keep full snapshot fallback after reconnect/version gaps.

Allow a slower data-saver cadence for passive lists while retaining quick feedback
and reconciliation after explicit actions. Do not simply slow active transfer
feedback everywhere, or replace polling with SSE without evidence it is needed.

**Acceptance.** Measure bytes/minute at 100/1,000/5,000 torrents, idle and active.
Verify removals, category/filter changes, partial failures, cursor gaps, reconnect,
two tabs, and optimistic rollback. No deleted row may reappear from an old snapshot.

## 11. Carry cancellation through to obsolete upstream work

**Confirmed evidence.** Shared browser fetchers consume AbortSignal, but ARR/Jellyfin
service clients mostly expose timeout-only axios methods. A closed UI can stop
reading while the server continues work. Imperative requests remain too, for example
[torrent details](/Users/ginpachi/Dev/helprr/src/app/(app)/torrents/page.tsx:958),
which checks selection ownership but never aborts. The shared query client enables
reconnect refetch; many stale active queries can resume together. Retained old page
state during navigation is not itself a guarantee that its in-flight work stops.

**Implementation.** Inventory read-only imperative flows and give them explicit
loading/error/cancellation ownership. Thread request.signal into exclusive upstream
reads and introduce per-operation time budgets with clear retry states. Shared
cache fills require reference-counted ownership or a separate fill lifetime: one
aborted consumer must not cancel work still needed by another. Do not cancel accepted
mutations, audits, encoding cleanup, or progress reports as if they were reads.

Prioritize the newly selected view and stagger noncritical reconnect/background
refreshes with bounded concurrency. Keep action-triggered reconciliation immediate.
Start with hot paths identified by traces, not a new scheduler around every fetch.

**Acceptance.** Hold requests, close/reselect/navigate, and inspect browser and server
cancellation. Reconnect a populated dashboard with a foreground navigation in flight.
Check request peaks, wasted bytes, two consumers sharing one request, auth failures,
and truthful timeout UI. A known stale-response race should receive a focused test.

## 12. Make warm-cache and offline behavior fast without misleading users

**Confirmed evidence.**
[sw.ts](/Users/ginpachi/Dev/helprr/src/app/sw.ts:70) waits up to ten seconds before
using a cached allowlisted GET during a stalled network. This was intentional to
avoid replaying old post-mutation data. The client Query cache is in memory only;
after a PWA process restart, a cached HTML shell does not imply cached application
data is already in React. Offline fallback bodies have no explicit freshness marker
for jsonFetcher to distinguish them from current network data.

**Implementation.** Keep the safe allowlist and authoritative fresh-read path.
For approved read-only browsing resources, make snapshot availability and age explicit
and render a cached snapshot while a separate fresh read proceeds. Reuse the existing
user-scoped cache where practical; do not persist the entire query cache by default.
Mark stale/offline responses in a response envelope/header and surface a clear
last-updated/offline state. Mutations and their reconciliation must bypass stale
fallback, as must auth, sessions, previews, live queues, and other action-sensitive
reads. Decide snapshot permissions/expiry before implementing persistence.

Retain logout/cross-tab cache clearing, and test capability changes. Bound persistent
data by bytes/age as well as entries. Account for storage loss: WebKit documents
[quota and eviction behavior](https://webkit.org/blog/14403/updates-to-storage-policy/),
so an installed PWA must recover gracefully when its cache is gone.

**Acceptance.** Warm launch with a stalled connection should show explicitly stale
browsing data before ten seconds; a post-save refresh must show server truth or an
explicit failure, never silently revert. Test offline cold/warm launch, expired
sessions, user switch, permissions, cache eviction, old/new service-worker versions,
and interrupted updates. Never cache RSC responses by URL alone.

## Device/browser qualification matrix

| Environment | Required scenarios | Special observations |
| --- | --- | --- |
| Physical mid/low-range Android, Chrome tab and installed PWA | Cold start, scrolling, rapid navigation, search/filter, drawers, playback | Main-thread cost, GC, decoded images, MSE/HLS, back button, keyboard |
| Physical iPhone, Safari tab and Home Screen PWA | Same flows, app switch/resume, lock/unlock, interrupted connection | User-gesture playback, native HLS, memory/process recovery, safe areas, focus restoration |
| Desktop Chromium | Large libraries, multiple tabs, keyboard navigation, playback while browsing | Larger mounted grids, multiple polling clients, background/resume |
| macOS Safari and desktop Firefox | Core browsing/edit flows, cache recovery, supported playback | Feature-detection fallbacks; no dependence on Chromium-only network/metrics APIs |

For each core environment use fresh cache, warm memory cache, and warm disk cache
after process restart. Test real cellular service and a controlled proxy with verified
rate/latency shaping. Suggested lab profiles: 1.5 Mbps down / 750 kbps up / 300 ms
RTT and 8 Mbps down / 2 Mbps up / 100 ms RTT, plus a temporary outage. These are
repeatable test profiles, not claims about all 3G/4G networks. Verify observed request
latency and throughput actually match the profile before accepting results.

Run at least five cold and ten warm repetitions per comparison and report median,
range, and sample count; use larger samples for meaningful percentiles. Separate
server-cache misses from mobile transfer latency. Record device/OS/browser/build,
library size, layout/widget configuration, server hardware, and upstream state.

Core journey: dashboard → movie/series library → detail → back; type and change
filters; open/close/reopen a form while its read is delayed; navigate twice before
the first response returns; scroll through long rails; open Watch detail then play;
browse while audio plays; pause/change track; suspend/resume; save and verify fresh
data. Include admin and restricted-member identities and secondary ARR instances.

## Checks before accepting each implementation

Run the repository gates: lint, tests, production build, and diff check. Add focused
behavioral tests for changed cache/permission/request ownership and query contracts.
Use structural budgets only where meaningful (precache membership, bounded mounted
cards, request count); wall-clock microbench assertions in unit tests are unstable.
Compare production artifacts and repeat the affected physical/browser journeys.

Each implementation report must state what improved, actual before/after measurements,
tradeoffs, unresolved device limits, and rollback approach. API splits should retain
a compatibility path until consumers migrate; cache changes should be reversible
without destroying user settings or media data. Commit/push/release/deployment remain
separate actions requiring the owner's instruction.

## Lower-priority hypotheses: measure before changing

- Image shimmer uses an animated background position while posters wait; many
  simultaneous placeholders may consume paint time. Profile before replacing it
  with a static or compositor-friendly indicator. Reduced-motion handling exists.
- Movie/series scroll-state persistence writes a small sessionStorage object at
  most every 150 ms. Only move to idle/flush-on-leave if traces show meaningful
  synchronous cost; it is unlikely to outrank oversized images or full-list work.
- A widget remains mounted after first entry to preserve state, although offscreen
  refresh is disabled. Profile long-session chart/DOM retention before adding eviction.
- JSON caching is tied to the image-cache setting in getCachedJson. Verify intended
  settings semantics before separating toggles; do not call the cache absent or
  change an operator's explicit preference silently.
- The shared watch-status map may become a large cold transfer for very large
  libraries. Measure its compressed size before replacing its efficient O(1)
  lookups with scoped/batched reads that could introduce per-card requests.

Do not prioritize another framework migration, broad CSS rewrite, global permanent
prefetch, blanket stale API caching, or a native-app rewrite. The confirmed work
above can be addressed within the existing Next.js/PWA architecture.
