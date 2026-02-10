# UI/UX Overhaul: Native Mobile App Feel

## Context

The current Helprr PWA looks like a "compact website" rather than a native mobile app. Issues:
- 6-tab bottom nav (too many), feels cramped
- Dialogs for Edit, Delete, Interactive Search, Add Torrent — web-like, not native
- Seasons use Accordions instead of drill-down pages
- Action buttons displayed as rows of web buttons instead of context menus
- Filter/sort use prominent Select dropdowns instead of icon-triggered popovers
- Cards with borders everywhere — should flow naturally
- No consistent native-style header (back + title + actions)
- Spacing/padding issues (overlap, no breathing room)

Reference design: 20 images in `/mobile-design/` showing a native iOS app (LunaSea-style).

**Incremental approach: 4 phases, each independently testable.**

---

## Phase 1: App Shell & Navigation (Foundation)

### 1.1 Bottom Nav → 5 Tabs + "More" Menu
**File:** `src/components/layout/bottom-nav.tsx`

5 primary tabs + overflow:
```
Movies | Series | Calendar | Activity | More(...)
```

- **More** button (MoreHorizontal or Ellipsis icon) opens an upward-sliding menu/popover with:
  - Dashboard
  - Torrents
  - Notifications
  - Settings
- Active tab: filled icon + accent color label
- Touch targets: 48px height minimum
- `pb-[env(safe-area-inset-bottom)]` already present, keep it

### 1.2 New Native Page Header Component
**New file:** `src/components/layout/page-header.tsx`

Reusable header for detail/sub-pages:
- Left: Back button (ChevronLeft) — `router.back()`
- Center: Page title (truncated with `text-ellipsis`)
- Right: Optional action slots (bookmark toggle, 3-dot DropdownMenu)
- Sticky top, backdrop blur, safe area top padding
- Used on: movie detail, series detail, season detail, episode detail, history, add pages, edit pages

### 1.3 Simplify App Header
**File:** `src/components/layout/header.tsx`

For top-level pages (the 5 bottom nav tabs):
- Hide entirely on mobile (bottom nav already indicates location)
- Or make minimal: just the page title left-aligned
- Remove notification bell + settings gear (moved to "More" menu)
- Remove logout dropdown (moved to Settings page)

### 1.4 Layout Adjustments
**File:** `src/app/(app)/layout.tsx`

- Conditionally hide `<Header />` on mobile detail pages
- Adjust main padding: `px-4 pt-2 pb-24` (room above bottom nav)
- Add CSS transitions for page navigation (optional: View Transitions API)

### 1.5 Global Styling
**File:** `src/app/globals.css`

- Add smooth page transition classes
- Ensure 44px minimum touch targets globally
- Increase bottom padding for safe area
- Add utility classes for native-style sections (borderless key-value rows)

### 1.6 Bottom Sheet Component
**New file:** `src/components/ui/drawer.tsx` (use shadcn Drawer / Vaul)

Install and configure the shadcn drawer component (built on Vaul):
- Slides up from bottom with drag handle
- Used for: delete confirmations, queue item details, history event details
- Replaces Dialog for mobile-context simple interactions

**Phase 1 Deliverables:** New nav structure works, pages are accessible, no functional changes to page content yet.

---

## Phase 2: Detail Pages Overhaul

### 2.1 Movie Detail Page
**File:** `src/app/(app)/movies/[id]/page.tsx`

Per reference IMG_0273-0274:
- Use `<PageHeader>` with back + bookmark + 3-dot menu
- 3-dot menu: Refresh, Automatic Search, Open in Trakt, Open in IMDb, Edit (→ edit page), Delete (→ bottom sheet confirmation)
- Poster displayed prominently (not fanart)
- Status badge above title: "DOWNLOADED" (green) or "MISSING" (red)
- Title + year + runtime + certification cleanly laid out
- Ratings row: IMDb score, TMDb score with icons
- Metadata as **borderless key-value rows** (no Card wrapper):
  ```
  STATUS        Released
  STUDIO        Warner Bros
  GENRE         Action, Adventure
  VIDEO         4K (x265)
  AUDIO         English (AAC 5.1)
  SUBTITLES     English, Spanish, +27 more...
  ```
- Overview text (collapsed with "more..." link)
- Two pill buttons: `Automatic` (outlined) + `Interactive` (outlined)
- "Information" section with key-value rows + "Files & History" link
- **Remove all action button rows**
- **Remove inline Edit Dialog** → navigate to edit page
- **Remove inline Delete Dialog** → bottom sheet confirmation

### 2.2 Movie Edit Page
**New file:** `src/app/(app)/movies/[id]/edit/page.tsx`

Move edit form from Dialog to full page:
- PageHeader: "Edit [Movie Title]"
- Quality Profile select
- Minimum Availability select
- Root Folder select
- Tags (toggle badges)
- Save/Cancel buttons

### 2.3 Series Detail Page
**File:** `src/app/(app)/series/[id]/page.tsx`

Per reference IMG_0275-0276:
- Same header pattern as movie detail
- **Replace Accordion with drill-down season list:**
  ```
  Season 8    0/10    [bookmark]    >
  Season 7    10/10   [bookmark]    >
  Season 6    10/10   [bookmark]    >
  ...
  ```
  Each row is a `<Link>` to `/series/[id]/season/[num]`
- "Information" section with key-value rows below
- **Remove all Accordion, Switch, inline search buttons**

### 2.4 Series Edit Page
**New file:** `src/app/(app)/series/[id]/edit/page.tsx`

Same pattern as movie edit — Quality Profile, Series Type, Tags.

### 2.5 Season Detail Page
**New file:** `src/app/(app)/series/[id]/season/[seasonNumber]/page.tsx`

Per reference IMG_0277:
- PageHeader: breadcrumb subtitle "Series Title" + "Season N" as main title
- Year, runtime, total size metadata
- Pill buttons: Automatic + Interactive
- Episode list as tappable rows:
  ```
  10. Crossing the Line  Season Finale   [bookmark]
      2160p · Mar 8, 2019
  9.  Stars and Stripes                   [bookmark]
      2160p · Mar 8, 2019
  ```
- Each episode row → Link to episode detail page

### 2.6 Episode Detail Page
**New file:** `src/app/(app)/series/[id]/season/[seasonNumber]/episode/[episodeId]/page.tsx`

Per reference IMG_0278-0280:
- PageHeader with 3-dot menu (Open in Trakt/IMDb, Automatic Search, Delete File)
- Episode breadcrumb/title, number, runtime, air date
- Metadata rows: Network, Genre, Video, Audio, Subtitles
- Overview text
- Pill buttons: Automatic + Interactive
- "File" section: filename, quality, size
- "History" section: list of events (IMPORTED, GRABBED with dates)
  - Tapping an event opens a **bottom sheet** with details (per IMG_0280):
    - Release title, date, description
    - Key-value details: Indexer, Flags, Source, Match Type, Release Type, Group, Age, Size

### 2.7 Interactive Search → Full Page
**New file:** `src/app/(app)/search/interactive/page.tsx`
(Or keep as a route under the media path like `/movies/[id]/search`, `/series/[id]/season/[num]/search`)

Convert `InteractiveSearchDialog` to a full page:
- PageHeader: "Interactive Search: [title]"
- Search button to trigger indexer scan
- Filter controls as compact icon-triggered popovers
- Scrollable release list
- Grab button per release

Approach: Use URL query params to pass `service`, `movieId`, `seriesId`, `seasonNumber`, `episodeId`.

**Phase 2 Deliverables:** All detail pages have native drill-down feel. No more accordion. Dialogs replaced with pages/sheets.

---

## Phase 3: List Pages & Calendar

### 3.1 Movies List Page
**File:** `src/app/(app)/movies/page.tsx`

Per reference IMG_0272, 0285, 0286:
- Top bar: Filter icon (DropdownMenu) + Sort icon (DropdownMenu) + "+" add button
- Search bar below top actions
- **3-column poster grid** on mobile (bump from 2)
- Filter dropdown (from icon click): All, Monitored, Unmonitored, Missing, On Disk, Released, In Cinemas, Announced
- Sort dropdown (from icon click): Title, Year, Added, Rating, File Size, etc. + Ascending/Descending toggle
- **Remove inline Select components** for sort/filter
- **Remove grid/list view toggle** (grid-only on mobile)
- Poster cards: rounded, with small monitored/has-file overlay badges

### 3.2 Series List Page
**File:** `src/app/(app)/series/page.tsx`

Same treatment as Movies.

### 3.3 Calendar Page
**File:** `src/app/(app)/calendar/page.tsx`

Per reference IMG_0271:
- Default to **Agenda view** on mobile
- Agenda: grouped by date, date shown on left side:
  ```
  THU
  5       Sentenced to Be a Hero    7:00 PM
  FEB     1x05 · Sentence: Defense

          JUJUTSU KAISEN            9:00 PM
          3x06 · Cog
  ```
- Compact, no cards — just rows with subtle separators
- Filter toggle for monitored-only + type filter (Episodes/Movies)
- Navigation: left/right arrows for previous/next period
- Keep month/week as secondary accessible views but agenda is default

### 3.4 Activity Page
**File:** `src/app/(app)/activity/page.tsx`

Per reference IMG_0287-0288:
- Top bar: filter icon + sort icon + history icon (navigates to `/activity/history`)
- Show queue count ("N Tasks")
- Queue items as clean cards with title, status, progress %, ETA
- Tapping a queue item → **bottom sheet** with full details:
  - Status badge, filename, quality, tags
  - Progress bar + remaining time
  - Remove button
  - Information section: Language, Indexer, Protocol, Client, Added date
- Keep tabs for Queue/Failed/Missing/Cutoff but make them more compact (pills or segmented control)

### 3.5 Activity History Page
**New file:** `src/app/(app)/activity/history/page.tsx`

Per reference IMG_0289-0290:
- PageHeader: "History" + filter icon
- Filter dropdown: All Events, Grabbed, Imported, Failed, Ignored, Renamed, Deleted
- Instance filter (Sonarr/Radarr)
- Flat list of events with colored status labels, filenames, quality, "time ago"

### 3.6 Torrents Page
**File:** `src/app/(app)/torrents/page.tsx`

Keep separate but accessible from "More" menu. Polish:
- Same design language as Activity (clean cards, bottom sheets for details)
- Add Torrent → full page instead of dialog
- Delete → bottom sheet confirmation

### 3.7 Settings Page
**File:** `src/app/(app)/settings/page.tsx`

Per reference IMG_0284:
- Large "Settings" title
- **iOS-style grouped sections:**
  ```
  Instances
  ┌─────────────────────────────────────┐
  │ Radarr          Connected        >  │
  │ Sonarr          Connected        >  │
  │ Add Instance                     >  │
  └─────────────────────────────────────┘

  Preferences
  ┌─────────────────────────────────────┐
  │ Home            Activity          ⌄ │
  │ Polling         30 seconds        ⌄ │
  └─────────────────────────────────────┘

  Display
  ┌─────────────────────────────────────┐
  │ Appearance      Dark              ⌄ │
  └─────────────────────────────────────┘

  Account
  ┌─────────────────────────────────────┐
  │ 🔴 Sign Out                         │
  └─────────────────────────────────────┘
  ```
- Service config forms → navigate to sub-pages (e.g., `/settings/radarr`)
- Move logout here as a red "Sign Out" row at bottom

### 3.8 Dashboard Page
**File:** `src/app/(app)/dashboard/page.tsx`

Keep functional, accessible from "More" menu. Light polish to match new design language:
- Remove Card borders, use subtle sections
- Clean up typography to match global standards

### 3.9 Add Movie/Series Pages
**Files:** `src/app/(app)/movies/add/page.tsx`, `src/app/(app)/series/add/page.tsx`

Polish with PageHeader and native form styling. Keep existing flow but:
- Use PageHeader (back + title)
- Selected item uses full-width layout, not Card
- Form fields match settings-style grouped rows

**Phase 3 Deliverables:** All pages redesigned with native feel. List pages have icon-triggered filters.

---

## Phase 4: Polish & Transitions

### 4.1 Page Transitions
Add smooth slide transitions when navigating between pages:
- Forward navigation: new page slides in from right
- Back navigation: page slides out to right
- Use CSS `@view-transition` or a layout-level animation wrapper

### 4.2 Spacing & Touch Target Audit
Go through every page and verify:
- All buttons/links ≥ 44px touch target
- Proper padding at top (safe area) and bottom (above nav)
- No content hidden behind fixed elements
- Consistent spacing between sections (24px) and items (12px)

### 4.3 Poster Grid Polish
- 3 columns with 12px gap
- Rounded corners (12px radius)
- Subtle shadow on poster cards
- Monitored indicator as small bottom-right badge

### 4.4 Color Accent Consistency
- Status colors: green (downloaded/imported), red (missing/failed), blue (downloading/grabbed), orange (warning), purple (upcoming)
- Primary accent: used for active tab, active states, links
- Muted: used for secondary text, borders

### 4.5 Remove Deprecated Components
- Remove `src/components/ui/accordion.tsx` (no longer imported)
- Clean up unused Dialog patterns
- Remove unused Card wrappers from detail pages

---

## Files Summary

### Modified
| File | Changes |
|------|---------|
| `src/components/layout/bottom-nav.tsx` | 5 tabs + "More" popover |
| `src/components/layout/header.tsx` | Minimal/hidden on mobile |
| `src/app/(app)/layout.tsx` | Padding, conditional header |
| `src/app/globals.css` | Transitions, spacing, touch targets |
| `src/app/(app)/movies/page.tsx` | Poster grid, icon-triggered filters |
| `src/app/(app)/movies/[id]/page.tsx` | Native detail, 3-dot menu, no dialogs |
| `src/app/(app)/series/page.tsx` | Same as movies |
| `src/app/(app)/series/[id]/page.tsx` | Drill-down seasons, no accordion |
| `src/app/(app)/calendar/page.tsx` | Agenda-first |
| `src/app/(app)/activity/page.tsx` | Clean queue + bottom sheets |
| `src/app/(app)/torrents/page.tsx` | Polish + bottom sheets |
| `src/app/(app)/settings/page.tsx` | iOS grouped settings |
| `src/app/(app)/dashboard/page.tsx` | Light polish |
| `src/app/(app)/movies/add/page.tsx` | PageHeader, native forms |
| `src/app/(app)/series/add/page.tsx` | PageHeader, native forms |
| `src/app/(app)/notifications/page.tsx` | Minor polish |
| `src/components/media/media-card.tsx` | 3-col grid adjustments |
| `src/components/media/media-grid.tsx` | 3 cols on mobile |
| `src/components/media/interactive-search-dialog.tsx` | → convert to page |
| `src/lib/store.ts` | New UI state if needed |

### New Files
| File | Purpose |
|------|---------|
| `src/components/layout/page-header.tsx` | Native detail header |
| `src/components/ui/drawer.tsx` | Bottom sheet (shadcn/vaul) |
| `src/app/(app)/movies/[id]/edit/page.tsx` | Movie edit page |
| `src/app/(app)/series/[id]/edit/page.tsx` | Series edit page |
| `src/app/(app)/series/[id]/season/[seasonNumber]/page.tsx` | Season detail |
| `src/app/(app)/series/[id]/season/[seasonNumber]/episode/[episodeId]/page.tsx` | Episode detail |
| `src/app/(app)/activity/history/page.tsx` | History sub-page |

### Removable After Migration
| File | Reason |
|------|--------|
| `src/components/ui/accordion.tsx` | Replaced by drill-down navigation |

---

## Reusable Existing Code
- `src/lib/store.ts` — Zustand store (extend for new state)
- `src/components/media/media-card.tsx:getImageUrl()` — image URL extraction
- `src/components/ui/dropdown-menu.tsx` — for 3-dot context menus
- `src/components/ui/sheet.tsx` — basis for bottom sheets
- `src/components/ui/badge.tsx`, `progress.tsx`, `skeleton.tsx` — keep as-is
- All API route handlers (`src/app/api/`) — unchanged
- All service clients (`src/lib/`) — unchanged
- `date-fns` format utilities already used across pages

---

## Verification (per phase)

1. `npm run dev -- --webpack` — verify app loads
2. Navigate all routes via bottom nav + More menu
3. Test drill-down: Series → Season → Episode → back → back → back
4. Verify bottom sheets open/close properly
5. Check mobile viewport (375px width) in DevTools
6. Test safe area handling (simulate notch with DevTools)
7. Verify no content hidden behind bottom nav
8. Test filter/sort popovers open and apply correctly
9. Run `npm run build` to check for build errors
