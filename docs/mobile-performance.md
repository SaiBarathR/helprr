# Mobile responsiveness

Authenticated navigation uses `NavigationProvider`, `AppLink`, and
`useAppRouter`. A different destination immediately replaces the visible page
with a loading view in the already-loaded application shell. The navigation
controls remain available while Next.js downloads the route. The prior page
stays mounted but hidden and inert until the transition completes. Same-page
filter, query-string, and hash changes retain the current controls.

Use `AppLink` for application links and `useAppRouter` for imperative
navigation. Content links default to no speculative route prefetch; the sidebar
and bottom navigation explicitly retain Next.js automatic prefetching. Keep
instance parameters, history semantics, modified clicks, and cancellation intact.

Search has a closable loading dialog while its code downloads. The AniList
context drawer opens before fetching an unknown list entry, displays loading or
retry controls, and permits editing only after the entry is resolved. Closing
or changing the selection cancels the obsolete request. Prowlarr test results
are displayed before optional instance names finish loading.

## Reducing mobile-data work

- Recent dashboard data is reused for up to 30 seconds, bounded by each
  widget's refresh interval. Explicit freshness settings and live focus refresh
  retain their existing behavior.
- Widget fetches consume query cancellation signals, so unobserved requests can
  be aborted after leaving the page. Shared consumers keep their active request.
- Watch genre requests wait until their section approaches the viewport;
  selecting a genre still starts its request immediately.
- Recommendation queue lookup runs only when displayed recommendations need it.
  Media download summaries poll every 60 seconds when idle and every 5 seconds
  while a download is active.
- Logs initially request 200 entries; users can expand to the existing 1,000
  entry limit.
- PWA precaching excludes optional `public/libass` subtitle engines. The five
  files total 7,699,873 uncompressed bytes and remain available on demand for
  playback. Actual transferred bytes depend on compression and cache state.
  Offline fallback precaching and authenticated API cache rules are unchanged.

## Verification recorded on 2026-09-06

`npm run lint`, `npm test`, `npm run build`, and `git diff --check` passed.
Vitest reported 145 passing files, one skipped file, 948 passing tests, and five
skipped tests. Focused regressions cover suspended and superseded navigation,
history, same-page state, link semantics, drawer loading/error/cancellation,
search fallback dismissal, widget cache reuse, and shared-request cancellation.

A local standalone production build was exercised in Chrome with a 390 × 844
mobile viewport against the isolated development database:

- Dashboard, movie library/detail, person detail, and return navigation rendered.
- Measured click-handler-to-feedback-frame samples were approximately 7–16 ms.
  With the Add Movie route response explicitly held by request interception,
  the loading view appeared in approximately 6 ms. These are feedback timings,
  not complete page-load timings or physical touch-latency measurements.
- While Add Movie remained stalled, selecting Anime opened Anime. Releasing the
  old response did not replace the newer destination.
- Search opened and dismissed. An anime item's watchlist form opened with the
  selected title; nothing was saved.
- The generated service worker contained 635 precache URL entries, including
  `/offline.html`, with no `/libass/` entries.

Network emulation did not reliably enforce the requested latency in this
browser environment. These results therefore do **not** qualify actual 3G/4G
throughput, physical iPhone PWA interaction latency, or cold offline launch.
No before/after full-load benchmark or whole-app speed multiplier is claimed.
Standalone `tsc --noEmit` additionally encounters existing unrelated test-fixture
type errors; the production build's TypeScript check passed.

For physical acceptance, test a production build on iPhone PWA and Android with
cold and warm caches, real mobile data, and an interrupted connection. Include
dashboard-to-detail-to-back, rapid destination changes, search before its chunk
loads, drawer close/reopen during an entry fetch, logs expansion, and Watch
scrolling. Check that feedback appears before the response, controls remain
usable, stale responses cannot replace newer choices, and missing data is
reported truthfully. Test subtitle playback after a fresh installation because
the optional engine now downloads when needed.

Builds generate `public/sw.js`. Keep it out of the source development server
after production verification; `npm run dev` normally removes it on startup.
