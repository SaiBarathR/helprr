# Helprr - Media Management PWA

## Context

Build a Progressive Web App (installable on iPhone) that serves as a unified dashboard for managing Sonarr (TV series), Radarr (movies), and qBittorrent (downloads). The app provides media browsing, a calendar for upcoming releases, fine-grained push notifications, and activity monitoring with manual import capability for failed downloads.

## Tech Stack

- **Framework**: Next.js (App Router, TypeScript)
- **UI**: Tailwind CSS + shadcn/ui + Lucide icons
- **PWA**: Serwist (maintained successor to next-pwa)
- **Database**: PostgreSQL (existing) + Prisma ORM (free, open-source, local only — no cloud services)
- **State**: Zustand (UI state only), fetch + hooks (server data)
- **Notifications**: Web Push API + `web-push` npm library
- **Utilities**: date-fns, axios

## User Choices

- **HTTPS**: Cloudflare Tunnel (already set up or will set up)
- **Auth**: Basic password protection (single password gate, no user accounts)
- **PostgreSQL**: Use existing local PostgreSQL (connection string via `DATABASE_URL` env var)
- **Theme**: Dark mode default, with option to switch

## Architecture Overview

```
iPhone PWA  --(Cloudflare Tunnel)-->  Next.js Server  <-->  Sonarr / Radarr / qBittorrent
                                           |
                                     PostgreSQL (existing)
                                (settings, push subscriptions,
                                 notification prefs & history,
                                 polling watermarks)
```

All Sonarr/Radarr/qBittorrent API calls are **proxied through Next.js API routes** (solves CORS, keeps API keys server-side). Media data lives in Sonarr/Radarr — PostgreSQL only stores app config and notification state.

## Authentication

Simple password-based gate (no user accounts):
- `APP_PASSWORD` environment variable holds the password
- Login page with single password field
- On correct password, set an HTTP-only secure cookie (JWT or signed token)
- Middleware checks cookie on all routes except `/login`
- Session expiry configurable (default 30 days)
- All API routes also protected by the middleware

## Database Schema

| Table | Purpose |
|-------|---------|
| `ServiceConnection` | URL + API key per service (one per type: SONARR, RADARR, QBITTORRENT) |
| `PushSubscription` | Per-device push endpoint + keys |
| `NotificationPreference` | Per-subscription event type toggles (grabbed, imported, failed, etc.) with optional tag/quality filters |
| `NotificationHistory` | Log of sent notifications (title, body, metadata, read status) |
| `PollingState` | Watermarks per service (last queue IDs, last history date) to detect new events |
| `AppSettings` | Singleton row for polling interval, theme, alert hours, etc. |

## Pages & Features

### 1. Dashboard (`/dashboard`)
- Stats cards: total movies/series, active downloads, disk space
- Active downloads widget with progress bars (auto-refresh 5s)
- Upcoming 7 days preview (merged calendar)
- Recent activity feed

### 2. Movies (`/movies`, `/movies/[id]`, `/movies/add`)
- Grid/list view with search, sort, filter by status
- Detail page: fanart banner, metadata, file info, action buttons (search, refresh, edit, delete)
- Add page: search Radarr lookup, select quality/root folder, add

### 3. TV Series (`/series`, `/series/[id]`, `/series/add`)
- Same structure as Movies
- Detail page includes expandable season accordion with per-episode status and actions

### 4. Calendar (`/calendar`)
- Unified monthly/weekly/agenda view merging Sonarr episodes + Radarr movies
- Color-coded event pills (blue=episodes, orange=movies)
- Filter by type, monitored status, tags

### 5. Activity (`/activity`)
- **Queue tab**: Merged Sonarr + Radarr + qBittorrent queue with progress, ETA, actions (pause/resume/remove). Auto-refresh 5s.
- **History tab**: Paginated history from Sonarr + Radarr with event type icons and filters
- **Failed Imports tab**: Items with `importFailed` state. Each shows error message + **Manual Import** button that:
  1. Scans files via `GET /manualimport?downloadId={id}`
  2. Shows detected mappings (editable)
  3. Submits via `POST /command` with `ManualImport`

### 6. Notifications (`/notifications`, `/notifications/preferences`)
- History: chronological list with read/unread status
- Preferences: toggle per event type (grabbed, imported, failed, health warning, upcoming premiere), expandable for tag-based filters
- Push prompt: detects standalone mode, guides iOS users to install PWA first

### 7. Settings (`/settings`)
- Connection forms for each service (URL + API key + test button)
- General: polling interval, theme, upcoming alert hours

## Notification System

### Polling Loop (via `instrumentation.ts`)
Runs server-side on a configurable interval (default 30s):
1. Fetch queue + history from Sonarr and Radarr
2. Diff against `PollingState` watermarks to detect new events
3. Match events against `NotificationPreference` records
4. Send push via `web-push` library to matching subscriptions
5. Record in `NotificationHistory`, update watermarks

### Event Types
| Event | Detection |
|-------|-----------|
| Episode/Movie Grabbed | New queue item ID |
| Episode/Movie Imported | New history entry after watermark |
| Download Failed | Queue item with error status |
| Import Failed | Queue item with `importFailed` state |
| Upcoming Premiere | Calendar entry within N hours |
| Health Warning | Change in health check hash |

## PWA Configuration

- `manifest.json`: `display: "standalone"` (required for iOS push), icons (192, 512, maskable), screenshots
- Apple meta tags: `apple-mobile-web-app-capable`, `apple-touch-icon`, `apple-mobile-web-app-status-bar-style`
- Service worker caching: StaleWhileRevalidate for media lists/calendar, NetworkOnly for queue/history, CacheFirst for poster images (7d)
- Push handlers: parse payload → `showNotification()`, click → deep link to relevant page

## Layout

- **Desktop**: Collapsible sidebar navigation + content area
- **Mobile**: Bottom tab bar (Dashboard, Movies, Series, Calendar, Activity) + header for secondary nav (Notifications, Settings)
- Dark mode default, with light/system toggle in settings
- iOS safe area handling (notch, home indicator)

## Implementation Phases

### Phase 1: Scaffolding & Shell
- `create-next-app`, install deps, shadcn init
- Prisma schema + migration (against existing PostgreSQL)
- Serwist + manifest + service worker skeleton
- App shell layout (sidebar, bottom nav, header, dark theme default)
- Placeholder pages for all routes
- Basic auth: login page, middleware, `APP_PASSWORD` env var
- DB Details for PostgreSQL connection
  1.DB_HOST=localhost # Database host.
  2.DB_USER=postgres # Database user.
  3.DB_PASS=Meteoldrago@1290 # Database password.
  4.DB_NAME=postgres # Database name.
  5.DB_DIALECT=postgres # Database dialect.

### Phase 2: Settings & Connections
- Settings page UI (connection forms, test buttons)
- Service client classes (sonarr-client, radarr-client, qbittorrent-client)
- Settings API routes, health check endpoint

### Phase 3: Movies & TV Series
- Sonarr/Radarr proxy API routes (CRUD + lookup)
- TypeScript types for API responses
- Shared media components (card, grid, list, search, detail header)
- Movies pages (list, detail, add)
- Series pages (list, detail with seasons/episodes, add)

### Phase 4: Calendar
- Calendar proxy routes with date range params
- `useCalendar` hook merging both sources
- Calendar components (month/week/agenda views, filters)

### Phase 5: Activity & Manual Import
- Queue/history/manualimport/command proxy routes
- Queue table with progress bars and auto-refresh
- History table with pagination and filters
- Failed imports list with manual import dialog

### Phase 6: Push Notifications
- VAPID keys + web-push setup
- Push subscription API routes
- `usePushNotifications` hook
- Notification preference UI
- Polling service (`polling-service.ts` + `instrumentation.ts`)
- Notification sending + history recording
- Service worker push/click handlers

### Phase 7: Dashboard & Polish
- Dashboard widgets
- Loading skeletons, error boundaries
- Offline detection + messaging
- Responsive refinement (iPhone safe areas, gestures)
- Performance optimization

### Phase 8: Deployment
- Production Dockerfile (standalone output)
- Docker Compose file for the app (user manages PostgreSQL and Cloudflare Tunnel separately)
- `.env.example` with all required variables

## Critical Files

- `prisma/schema.prisma` — database schema
- `src/middleware.ts` — auth middleware (cookie check on all routes)
- `src/app/login/page.tsx` — password login page
- `src/lib/sonarr-client.ts` — Sonarr API client (pattern for all services)
- `src/lib/radarr-client.ts` — Radarr API client
- `src/lib/qbittorrent-client.ts` — qBittorrent API client (cookie auth)
- `src/lib/polling-service.ts` — background event detection engine
- `src/lib/notification-service.ts` — push notification delivery
- `src/app/sw.ts` — service worker (caching + push handlers)
- `next.config.mjs` — Serwist plugin + build config
- `src/app/(app)/layout.tsx` — app shell (sidebar + bottom nav)

## Verification

1. **Settings**: Configure service URLs/keys → test connection shows green
2. **Movies/Series**: Browse, search, add, edit, delete media items
3. **Calendar**: View upcoming releases, switch views, filter
4. **Activity**: See live queue with progress, browse history, trigger manual import on failed item
5. **Notifications**: Install PWA on iPhone → enable push → trigger a download in Sonarr → receive push notification
6. **PWA**: Add to Home Screen on iPhone → app opens in standalone mode → works offline for cached data
