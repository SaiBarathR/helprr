# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## What This Project Is

Helprr is a **PWA primarily targeting iPhone** with push notifications as a core feature. It's a self-hosted dashboard that connects to Sonarr, Radarr, and qBittorrent, polling those services and sending Web Push notifications for events like downloads starting/completing/failing, health warnings, and upcoming releases.

## Commands

```bash
npm run dev          # Dev server with Webpack on port 3050
npm run build        # Production build (Webpack required for Serwist)
npm run start        # Production server on port 3050
npm run lint         # ESLint (Next.js core-web-vitals + TypeScript)
npm run db:generate  # Generate Prisma client
npm run db:push      # Sync schema to database (no migration files)
npm run db:migrate   # Prisma migrate dev
```

**Important:** Both `dev` and `build` use the `--webpack` flag because Serwist is incompatible with Turbopack (Next.js 16 default).

## Environment Variables

Required: `DATABASE_URL`, `APP_PASSWORD`, `JWT_SECRET`
Optional (push notifications): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
Optional (proxy): `TRUST_FORWARDED_PROTO` — set to `true` only when behind a reverse proxy that strips client-supplied `x-forwarded-proto`. Enables the session cookie's `Secure` flag for proxy-terminated HTTPS.

Generate VAPID keys with: `npx web-push generate-vapid-keys`

## Architecture

### Request Flow

All Sonarr/Radarr/qBittorrent API calls are proxied through Next.js API routes (`src/app/api/`). Service clients (`src/lib/sonarr-client.ts`, `radarr-client.ts`, `qbittorrent-client.ts`) use Axios. Factory functions in `service-helpers.ts` create configured clients from database-stored connection settings.

### Authentication

JWT cookie-based (`jose` library, HS256). Single shared password checked against `APP_PASSWORD` env var. Cookie name: `helprr-session`, 30-day expiry. Middleware in `src/middleware.ts` protects all routes except `/login`, `/api/auth/login`, SW files, manifest, and static assets.

### Background Polling

`src/instrumentation.ts` starts the polling service on server startup. `src/lib/polling-service.ts` runs concurrent polls for Sonarr, Radarr, qBittorrent, and upcoming calendar items. State tracked in `PollingState` DB table to detect new events. Interval configurable via `AppSettings` (default 30s).

### Push Notifications

`src/lib/notification-service.ts` sends push via `web-push`. Subscriptions stored in DB with per-device, per-event-type preferences. Event types: `grabbed`, `imported`, `downloadFailed`, `importFailed`, `upcomingPremiere`, `healthWarning`, `torrentAdded`, `torrentCompleted`, `torrentDeleted`.

### Service Worker (Dual-Mode)

- **Production:** `src/app/sw.ts` built by Serwist (precaching + runtime caching + push handling). `sw.ts` is excluded from main `tsconfig.json` to avoid webworker/dom type conflicts — it uses `/// <reference lib="webworker" />`.
- **Development:** `public/sw-push.js` is a lightweight push-only worker (no precaching). Serwist is disabled in dev because it causes Fast Refresh loops, and production `sw.js` has hardcoded precache URLs that 404 in dev.
- **Registration:** `src/components/sw-register.tsx` (client component in root layout) picks the right SW based on `NODE_ENV`.

### Client State

Zustand stores in `src/lib/store/` manage UI state (sidebar collapse, media view preferences, sort/filter settings).

### Routing

`src/app/(app)/` is the layout group for the authenticated app shell (sidebar + bottom nav + header). Main sections: dashboard, series, movies, activity, calendar, notifications, settings, torrents. `src/app/login/` is unprotected.

### Database

Prisma 6 with PostgreSQL. **Do not upgrade to Prisma 7** — v7 changed the datasource config pattern, breaking `url = env("DATABASE_URL")`. Key models: `ServiceConnection`, `PushSubscription`, `NotificationPreference`, `NotificationHistory`, `PollingState`, `AppSettings` (singleton with `id="singleton"`).

## Tech Constraints

- **Next.js 16** deprecates `middleware.ts` in favor of `proxy` — middleware still works but shows a warning
- **shadcn/ui:** `toast` component is deprecated; use `sonner` instead
- **PushManager.subscribe:** `applicationServerKey` needs `.buffer as ArrayBuffer` cast for strict TypeScript
- **Tailwind CSS v4** with `@tailwindcss/postcss` plugin
- Server components by default; client components marked with `'use client'`
