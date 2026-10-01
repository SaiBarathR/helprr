# Helprr UI/UX audit and fix plan — 2026-10-01

## How this was produced

- **In the browser (runtime):** the dev stack (`npm run dev`, real Sonarr/Radarr/Lidarr/qBittorrent/Jellyfin data) at
  phone sizes 344×740, 375×667 and 375×812, and desktop 1280×800. On each page a DOM probe checked horizontal
  overflow, clipped text, tap targets under 28px, and controls covered by other elements; screenshots were reviewed
  by eye. About 30 pages plus their drawers and menus.
- **In the code:** five read-only agents ran in parallel, each on one area: app shell and shared primitives
  (including all 78 Drawer/Sheet/Dialog usages), media pages, operations pages, Jellyfin/insights/notifications/
  settings, and a full filter-indicator inventory. Codex `gpt-6.1-sol` ran three and Cursor `grok-4.7-xhigh-fast`
  ran two.
- Every agent finding below was either checked in the browser or re-read in the code. Status markers:
  - ✅ **confirmed in the browser**
  - 🔍 **confirmed in the code**, not yet seen in the browser
  - 📱 **needs a real iPhone**: safe-area and standalone-PWA behaviour, which the browser pane can't show
  - ❌ **refuted**, kept so nobody re-files it
- Dev-only overlays were ignored: the TanStack Query devtools button (the palm-tree icon at the top right, which
  covers the "More" tab and the Activity "Cutoff" tab in dev) and the Next.js "N" badge.

---

## Part 1 — Where the "filter is active" indicator is needed

The Activity page now has the pattern from PR #261: a dot on the filter button, plus an `ActiveFilterBar` row of
removable chips with "Clear all". It shows whenever something that **hides items** is active. Search counts as a
filter; sort order, layout and artwork toggles don't.

### 1a. Fix first — links that silently change saved filters (the same bug as Activity)

| Page | What leaks | Code |
|---|---|---|
| `/discover` | `contentType`, `genres`, `providers`, `networks`, `companies`, year/runtime/rating/votes, language, region, `releaseState`, `section`, `sortBy` from the URL (widget "View all", detail-page and section links) are written into persisted `discoverFilters` / `discoverContentType` / `discoverSort`. `?person=` also writes a persisted Movies content type. After one tap on a link, every later plain visit to `/discover` stays filtered. | `src/app/(app)/discover/page.tsx:955` 🔍 |
| `/anime/explore` | `season/year/yearMin/yearMax/status/format/genres/sort` from the URL are written into persisted `animeFilters` / `animeSort`. | `src/app/(app)/anime/explore/page.tsx:118` 🔍 |
| `/anime/library` | `?type=&status=` are restored and then saved into the shared session view state, so they carry over to plain visits in the same tab. | `src/app/(app)/anime/library/page.tsx:132` 🔍 |

**Fix:** apply the Activity approach. A URL filter applies to that visit only and shows as a chip. Dismissing it
falls back to the saved filter. Only an explicit change made in the menu is saved.

### 1b. High — filter is saved and invisible (no dot or chip while results are showing)

| Page | Filters that narrow the list | Chips to show | "Clear all" resets |
|---|---|---|---|
| `/movies` | Monitored / Unmonitored / Missing / On disk / Released / In cinemas / Announced, instance, Watched / Not watched, search | each status, `Instance: main (Radarr)`, `Watch: …`, `Search: "…"` | statuses `[]`, instance `all`, watch `all`, search `''` (also the saved search view state) |
| `/series` | Monitored / Unmonitored / Continuing / Ended / Missing / Upcoming, instance, watch, search | same pattern, `(Sonarr)` | same |
| `/music` | Monitored / Unmonitored / Missing tracks / Complete / Continuing / Ended, instance, search | same pattern, `(Lidarr)` | same |
| `/movies/collections` | Missing / Complete / Monitored, search, **instance (shared with `/movies`)** | `Collections: …`, `Instance: …`, `Search` | status `all`, search, instance. Also consider giving Collections its own instance setting: picking one here currently changes `/movies` too. |
| `/torrents` | Downloading / Seeding / Completed / Paused / Active, search | each status, `Search` | statuses `[]`, search (keep sort and view) |
| `/requests` | **Defaults to Pending** and treats that as "All". Also Movies/Series and requester. ✅ ("No pending requests" is the only hint.) | `Status: Pending`, `Type: …`, `Requested by: …` | status `all`, types `[]`, requester `null` |
| Dashboard custom Discover widgets | saved genres, providers, years, etc.; the section title is the only cue, and "View all" carries them into `/discover` (see 1a) | named chips, plus a "Browse without these filters" link | don't rewrite the saved section; editing it belongs in its editor |
| `/anime` | carousels hidden in Settings → Appearance with no hint on the page | a line such as "3 shelves hidden · Manage" | — |
| `/recommendations` | titles you excluded drop out silently | "N titles excluded · Manage" | — |

### 1c. Medium — not saved, but invisible

| Page | Gap |
|---|---|
| `/notifications/scheduled` | Defaults to **Active** and treats that as "no filter". With only sent or failed alerts the list says "No scheduled alerts yet". Show an `Active` chip and say in the empty state that only active alerts are listed. |
| `/activity/history`, `/calendar` | On phones the instance filter is a bare Layers icon (`hidden sm:inline` label) that looks the same whether or not an instance is picked. Add a dot and an `Instance: …` chip. |
| Dashboard **Requests** widget | Fixed to Pending; the header just says "Requests". Label it "Pending requests". |
| Jellyfin **User activity** drawer | Hard-coded to the last 30 days and latest 30 plays without saying so. |

### 1d. Low — already partly indicated; bring them onto the shared component

`/watchlist` (the dot ignores tags and search), `/notifications` (has its own chips; switch to `ActiveFilterBar` and
add a Search chip), `/cleanup` History (shows a count; add chips), `/logs` (already complete), `/anime/explore` and
`/discover` (show counts but no chips; also show **effective presets**: "Highly Rated" means votes ≥ 200, "Most Loved"
votes ≥ 1200, and the Seasonal sort implies season/year), dashboard Jellyfin, Prowlarr and growth widgets (range
pills are visible; add a reset), and drawers and pickers (search inputs only; add a clear button).

### 1e. Shared work for the rollout

- Extend `ActiveFilterBar` with a `Search: "…"` chip helper, and enlarge the chip's remove button from 24px to at
  least 40px of hit area while keeping the icon small.
- Extract the dot into a tiny `FilterButtonDot` and accessible label suffix so every trigger matches.
- Show instance names with their app everywhere ("main (Sonarr)"). The Activity instance menu still lists three
  identical "main" entries ✅, and Insights' health chips do too ✅.

---

## Part 2 — UI/UX findings

### P0 — blocks a task or hides important content

1. ✅ **Series → Monitor drawer: Apply and Cancel are unreachable on 667px-tall phones (iPhone SE/8).** Apply sits
   at y 688 and Cancel at 732, both below the screen. The drawer doesn't scroll and the last option is half hidden.
   *Fix:* make the options body `flex-1 min-h-0 overflow-y-auto` and keep the footer fixed.
   `series/[id]/page.tsx:2102`.
2. ✅ **Calendar opens with today hidden.** The agenda scrolls to today, but today's row (y 71–155) sits entirely
   under the sticky toolbar (which ends at y 174), so the first visible day is tomorrow. *Fix:* set
   `scroll-margin-top` to the toolbar height on day rows, or subtract it when scrolling to today.
3. ✅ **The blue edge "Search" tab covers content on every mobile page.** It's `md:hidden fixed right-0 bottom-[22%]`
   and only about 20px is visible. Seen covering the Notifications row info button, torrent ETA text, the
   Recommendations feed action rail, season-page bookmarks and dashboard widgets. *Fix:* move search into the nav
   or toolbar, or make it a full 44px button that hides while scrolling. `command-palette.tsx:56`.
4. 🔍 **Dialogs have no height cap**, so long content pushes the title and close button off the top and the actions
   off the bottom: Prowlarr "Test All" results (`prowlarr/page.tsx:1263`), the interactive-search download-client
   override (`interactive-search-dialog.tsx:669`), Watchlist add/edit with many tags (`watchlist-add-dialog.tsx:182`),
   and the Insights file comparison (`file-explorer-card.tsx:73`). *Fix (shared):* give `DialogContent` a
   `max-h-[85dvh]` flex-column default with a scrolling body slot, as `run-preview-dialog.tsx` already does.
5. 🔍 **Discover carousel editor sheet pushes Save off-screen.** The form scrolls but isn't `min-h-0 flex-1`, so the
   footer overflows. `discover-layout-settings.tsx:252`.
6. ✅ / 🔍 **Unsaved-changes bars** (`settings/downloads`, `settings/dashboard-refresh`):
   - ✅ at 344px "You have unsaved changes" is crushed into three lines;
   - 📱 the bar sits at `bottom-0` with no safe-area padding (on the home indicator) and, with the bottom nav, under
     the tab bar (`z-30` vs `z-50`).
   - Cleanup's bar uses `bottom-16 sm:bottom-0`, which is wrong for both nav positions and between 640 and 767px.
   - *Fix (shared):* one fixed-bottom-bar helper that knows the nav position and safe area.
7. 🔍 **Now-playing bar:** eight `shrink-0` 32px buttons need about 376px, so on a 344px phone Stop and Queue fall off
   the screen. It always reserves bottom-nav space (a floating gap when the nav is on top), never pads the page
   behind it, and on desktop covers the sidebar's "Collapse" button. `now-playing-bar.tsx:18`.
8. 🔍 **Manual import (`/activity/import`)** uses `h-[100dvh]` inside the shell, which creates two scrollers. The last
   file cards sit under the fixed Import bar.
9. 📱 **Watch (cinematic) headers** are `sticky top-0 z-50`, so they slide under the status bar and Dynamic Island,
   and overlap the top nav. `cinematic-header.tsx:151/192/261`.

### P1 — overflow, clipping, scroll and spacing

1. ✅ (fixed in #261) Seeding rule chips overflowing; Activity drawer not scrolling; "1 Task" spacing; series download
   card spacing.
2. 🔍 Drawer titles and descriptions have no long-string protection: delete torrent/movie/series/artist, season
   unmonitor, AniList and Sonarr mapping, refresh interval. Long release names run past a 344px drawer. *Fix
   (shared):* `min-w-0 [overflow-wrap:anywhere]` on `DrawerTitle` and `DrawerDescription`.
3. 🔍 Drawer metadata rows (movie/episode file history, torrent category picker, download-client override) have no
   `min-w-0` or truncation, so long indexer or client names collide with labels.
4. 🔍 Two `ScrollArea` lists cap the wrong element (rename preview, language picker), so long lists may not scroll.
5. 🔍 Pending-approval rows on `/requests`: the Approve and Decline buttons (about 200px) squeeze the title to a sliver
   on phones.
6. 🔍 Information sections on movie, artist and album pages truncate every value to `max-w-[60%]` (paths, root
   folders, tags) with no way to see the full text or copy it.
7. 🔍 Overview mode on the library pages: a long instance label in the title row can push the title out; badges
   inherit `whitespace-nowrap shrink-0`.
8. 🔍 `/share` and `/protocol`: long URLs and error strings don't wrap, the back link sits under the status bar 📱, and
   on desktop the layout has no max-width.
9. 🔍 Cleanup History rows use `grouped-row … flex-col` without `grouped-row-stacked`, so lines centre and clip.
10. 🔍 Prowlarr History: long queries push the type badge out (missing `min-w-0 flex-1`).
11. 🔍 Jellyfin History rows: the device line and date column don't truncate on phones.
12. 🔍 AniList TTL settings rows: the input and hint cluster (about 210px) crushes the label; "Clear AniList cache" overflows.
13. 🔍 Full-screen player transport row is about 324px of buttons plus padding, so the gear is clipped at 344px.
14. 🔍 Jellyfin season list in cinematic mode is centred inside a scroller, so with many seasons you can't scroll back
    to Season 1.
15. 🔍 Sheet overrides (`p-0`) drop the primitive's safe-area padding (Discover advanced filters, carousel editor), and
    the sheet close button ignores insets 📱.
16. 🔍 Toasts use Sonner's default bottom offset, which overlaps the bottom nav and home indicator 📱.
17. ✅ `/logs` (mobile): the toolbar wraps, leaving the download button alone on a second row. Each log entry's header
    (level, source, timestamp, GMT offset, request id, route) spreads across 2–3 messy lines.
18. ✅ Dashboard stat tiles truncate their labels at 375px ("INDEXE…", "113 missi…").
19. ✅ Cleanup → Queue tab: large empty gap between the tab bar and the "GENERAL" section title.
20. ✅ `/activity/history` wraps release names to three lines per row while the queue cuts them to one;
    pick one rule (for example `line-clamp-2`).

### P2 — tap targets (mobile)

- ✅ Seen in the browser:
  - Torrent select checkboxes are 13×13.
  - Dashboard widget toggles are 22×20, "View details" 18×18, "Activity history" 14×14.
  - Discover/Anime poster overlay buttons are 20–24px.
  - Carousel dots and Calendar toggles are 24–26px.
  - Activity toolbar icons are 28px (`w-7 h-7`).
  - Cleanup token-chip "×" buttons are 20px.
  - shadcn `Switch` is 32×18 everywhere.
  - "View all" / "See all" text links are 16–17px tall.
- 🔍 Found in the code:
  - Calendar previous/next are 28px.
  - Dialog and sheet close buttons are about 16px.
  - Data-table pagination and context-menu items are 32px; the coarse-pointer CSS actually *reduces* them.
  - Jellyfin task start/stop are 24px.
  - Watch Search/Leave icons are 22px.
  - Classic Watch sub-nav icons are about 28px and unlabelled.
  - Library-gap search and watchlist poster menus are 28px.
- *Fix:* add a `touch-target` utility (44px hit box, icon stays small, via padding or a negative margin) and sweep.
  Torrents and Watchlist toolbars already use `min-h-[44px] min-w-[44px]`.

### P3 — placement and safety

- ✅ Prowlarr: a red delete button sits right next to "Test" on every indexer row. Move delete into a menu or swipe action.
- ✅ Jellyfin overview: Restart and Shutdown are in the same row as Scan Libraries.
- ✅ Dashboard "Edit dashboard" floating button covers the Activity widget header (list toggle, "View all").
- 🔍 Dashboard edit bar is `sticky top-0` (not `--header-height`), so it slides under the status bar 📱; its buttons are 30px.
- ✅ The series header "…" actions button has no `aria-label` and no text.
- 🔍 Cleanup preview, import and export warnings use near-white text on a 5% red background, which is nearly
  unreadable in light themes (the `dark:` variant follows the OS, not Helprr's `data-scheme`).

### P4 — desktop layout

- ✅ Detail pages (series and movie) are the phone layout stretched to about 1,150px: key/value rows span the full
  width with values far from their labels, and the right side is mostly empty. Suggest a two-column layout at
  `lg` (poster and metadata on the left, overview, seasons and cast on the right) or a `max-w-5xl` content column.
- ✅ Torrents on desktop: full-width cards with 1,100px progress bars. Consider the table layout at `lg`.
- ✅ Dashboard: an empty "Now Streaming" widget and the Today widget leave large empty areas; Active Downloads shows
  one small card across a full-width row. Consider collapsing empty widgets to a compact state.
- ✅ Sidebar: at 800px tall the nav list hides Notifications and Settings below the fold, behind a hidden scrollbar
  with no fade. Add a fade or scroll hint, or tighten item spacing.
- 🔍 Edit forms (movie, series and music edit) stretch across the content area; cap at `max-w-2xl`.

### P5 — consistency and polish

- ✅ Discover's cold load shows a lone spinner on a black page for more than 3 seconds; other pages show skeletons.
- ✅ Insights is the only primary page with a visible title and subtitle block; the others hide the title.
- ✅ Instance names are ambiguous everywhere ("main", "main", "main"). Always add the app name.
- ✅ Movie-detail rails stay blank briefly after a fast scroll (`animate-rail-in`), which looks like an empty section.
- ✅ Library-gaps summary tiles scroll sideways with no hint that more tiles exist.

### Checked and refuted (don't re-file)

- ❌ Settings → Downloads weekday buttons clipping Saturday at 344px: all seven fit.
- ❌ Torrent titles pushing the row menu off the card: titles truncate and the menu stays visible at 375px.
- ❌ Activity tabs cut off next to the toolbar icons at 344px: all four fit. The 28px icons are a real issue (P2).
- ❌ Recommendations feed card running under the nav: with the nav **on top** it ends exactly at the screen bottom.
  The claim may still hold with the **bottom** nav (📱, I didn't switch your preference).
- ❌ Dashboard widget rows "covered": the widget lists scroll internally, so that was a false positive.

---

## Part 3 — Suggested fix plan

Each batch is a focused PR into `development`. The shared primitives go first, because they fix many pages at once.

| # | Batch | Contents | Size |
|---|---|---|---|
| A | **Shared primitives** | `DialogContent` max-height plus scroll-body contract; `DrawerTitle` and `DrawerDescription` wrapping; Sheet safe-area kept under `p-0`, inset-aware close button; `touch-target` utility; fixed-bottom-bar helper aware of nav position and safe area; Toaster offset; edge Search tab redesign | M |
| B | **P0 page bugs** | Monitor drawer scroll; Calendar scroll-to-today offset; settings and cleanup save bars on the new helper; Prowlarr Test All, interactive-search and watchlist dialogs; Discover carousel sheet; manual import `100dvh`; now-playing bar (compact controls on phones, real offsets) | M |
| C | **Filter leaks** | Discover, Anime Explore and Anime Library URL params visit-only (Activity pattern) | S–M |
| D | **Filter indicator rollout** | 1b pages (Movies, Series, Music, Collections, Torrents, Requests), then 1c (Scheduled alerts, History and Calendar instance, Requests widget), then 1d convergence; `ActiveFilterBar` Search chip and bigger hit area | M–L |
| E | **Tap-target sweep** | P2 list using the `touch-target` utility | M |
| F | **Overflow and wrapping sweep** | P1 items 2–20 | M |
| G | **Desktop layouts** | detail pages two-column or max-width, torrents table at `lg`, dashboard empty-widget compaction, sidebar scroll hint, edit form max-width | L |
| H | **Safety and polish** | Prowlarr delete placement, Jellyfin power controls, Edit-dashboard button placement, light-theme warning contrast, unlabelled icon buttons, Discover skeleton, consistent page headers, instance naming | M |

📱 items should be checked once on a real iPhone in standalone PWA mode (nav on top and nav on bottom) after batch A.

---

## Housekeeping noticed along the way (not UI)

- `npm audit` after #261 still lists moderate advisories in production dependencies (`brace-expansion`,
  `dompurify`) and one high in a dev-only dependency (`js-yaml` via ESLint). None of these trips the HIGH/CRITICAL
  image gate, but they're worth a routine bump.
- When a lockfile change is needed, regenerate it with the image's npm (`node:24-alpine`, npm 11.17). A local npm 11.6
  pruned nested wasm optional entries, and the Docker `npm ci` rejected the result.
- Next 16.3.6 builds log an Edge-runtime warning from its own `dynamic-rendering` module, and the dev server warns
  that the `middleware` file convention is deprecated in favour of `proxy`.
- The one remaining lint warning is in `src/lib/query-client.ts:49` (`window.location.assign` on an internal page).
