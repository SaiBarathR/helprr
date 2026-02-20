# Repository Guidelines

## What This Project Is

Helprr is a **PWA primarily targeting iPhone** with push notifications as a core feature. It's a self-hosted dashboard that connects to Sonarr, Radarr, qBittorrent, Prowlarr and Jellyfin polling those services and sending Web Push notifications for events like downloads starting/completing/failing, health warnings, and upcoming releases.


## Project Structure & Module Organization
- `src/app` contains Next.js App Router pages and API routes.
- `src/app/(app)` holds authenticated pages (dashboard, movies, series, activity, settings).
- `src/app/api/**/route.ts` defines server endpoints for Sonarr, Radarr, qBittorrent, Prowlarr, auth, and notifications.
- `src/components` stores reusable UI and feature components (`ui`, `layout`, `media`, `settings`).
- `src/lib` contains shared logic (service clients, auth, DB access, polling, utilities, Zustand store).
- `src/hooks` and `src/types` hold custom hooks and shared TypeScript types.
- `prisma/schema.prisma` and `prisma/migrations` manage database schema and migration history.
- Static and PWA assets live in `public/`; service worker code is in `src/app/sw.ts` and `public/sw*.js`.
- Prisma 6 with PostgreSQL. **Do not upgrade to Prisma 7** — v7 changed the datasource config pattern, breaking `url = env("DATABASE_URL")`. Key models: `ServiceConnection`, `PushSubscription`, `NotificationPreference`, `NotificationHistory`, `PollingState`, `AppSettings` (singleton with `id="singleton"`).

## Build, Test, and Development Commands
- `npm ci`: install dependencies with lockfile consistency.
- `docker compose up -d helprr-db`: start local PostgreSQL.
- `npm run db:generate`: generate Prisma client.
- `npm run db:push`: sync Prisma schema to local DB.
- `npm run db:migrate`: create/apply a Prisma migration during schema changes.
- `npm run dev`: run Next.js dev server on `http://localhost:3050`.
- `npm run build` and `npm run start`: production build and local production serve.
- `npm run lint`: run ESLint (`eslint-config-next` + TypeScript rules).

## Coding Style & Naming Conventions
- TypeScript is `strict`; keep types explicit at API boundaries and shared library code.
- Use `@/*` imports for `src` aliases (for example, `@/lib/db`).
- Follow existing file-local style (quotes/semicolons vary between generated UI primitives and app code); avoid style-only churn.
- Use PascalCase for React components, `useX` for hooks, camelCase for helpers, and kebab-case for route segments.

## Testing Guidelines
- There is currently no dedicated test runner configured.
- Minimum pre-PR checks: `npm run lint`, `npm run build`, and manual verification of affected UI/API flows.
- For new tests, prefer `*.test.ts` / `*.test.tsx` naming near the feature or under `src/**/__tests__`.

## Commit & Pull Request Guidelines
- Never commit or raise PRs for this project unless instructed by the project owner or core maintainers.

## Security & Configuration Tips
- Copy `.env.example` for local setup and never commit secrets.
- Treat `DATABASE_URL`, `APP_PASSWORD`, `JWT_SECRET`, and VAPID keys as sensitive.
