# Helprr Architecture

This document records Helprr's durable system structure and the non-obvious
invariants that implementation work must preserve. Repository-wide working rules
and exact commands live in `../AGENTS.md`; release operations live in
`maintainer-development-release-workflow.md`.

## System Overview

Helprr is a single Next.js application with an App Router UI, server-side API
routes, PostgreSQL persistence through Prisma, Redis-backed cache/runtime state,
background polling and cleanup workers, and a Serwist service worker. It is
mobile-first and primarily exercised as an iPhone PWA, while retaining a full
desktop dashboard and administration interface.

The `ServiceType` enum currently covers:

| Service | Primary Helprr use |
| --- | --- |
| Sonarr | TV library, activity, files, monitoring, and release actions |
| Radarr | Movie library, activity, files, monitoring, and release actions |
| Lidarr | Music library, albums/tracks, files, and monitoring |
| qBittorrent | Torrents, files, transfer controls, cleanup, and schedules |
| Prowlarr | Indexers, tests, history, sync, and statistics |
| Jellyfin | Library/watch state, playback, sessions, devices, and control |
| TMDB | Movie/TV discovery, metadata, collections, people, and images |
| AniList | Anime/manga discovery, schedules, tracking, and mappings |
| Seerr | Request creation, approval, state, users, and quotas |

All integrations are optional. Sonarr, Radarr, and Lidarr are multi-instance;
the selected `instanceId` is part of the functional and authorization context.

## Source Layout and Request Flow

- `src/app/(app)` is the authenticated application shell. It contains dashboard,
  movies, series, music, anime, discovery, requests, activity, torrents,
  calendar, watchlist, random watch, library gaps, Jellyfin, Prowlarr, insights,
  cleanup, logs, notifications, and settings surfaces.
- `src/app/api` contains application APIs and proxies to configured services.
- `src/components` contains reusable UI and feature-domain components.
- `src/lib` contains service clients and shared systems such as auth,
  permissions, polling, cleanup, search, scheduled alerts, cache, logging,
  readiness, support bundles, retention, and audit.

Browser code calls Helprr API routes rather than upstream services directly.
Routes resolve stored `ServiceConnection` records and construct clients through
the existing helpers. A mutating route must independently verify the actor,
capability or role, ownership where relevant, request shape, and selected
instance before invoking an upstream mutation.

For multi-instance services, trace `instanceId` through all of these layers:

```text
page/query state -> dialog/helper -> Helprr API request -> route validation
-> ServiceConnection selection -> upstream client
```

Falling back silently to a default instance is unsafe when the caller selected a
different one.

## Startup and Background Services

`src/instrumentation.ts` is the Node startup coordinator. Before background work
starts, `src/lib/startup-config.ts` validates the runtime environment. Permanent
configuration failures terminate startup with variable names and remediation,
without printing secret values.

After validation, startup initializes logging and shutdown handling, ensures the
bootstrap admin, loads settings, configures timezone/API logging, initializes
push, starts polling, seeds dashboard layouts, and starts the cleanup scheduler.
Transient database failures during background startup retry with capped backoff.

`src/lib/polling-service.ts` coordinates bounded, isolated poll sources for
Sonarr, Radarr, Lidarr, qBittorrent, Jellyfin, Seerr, and service reachability.
It also drives release and scheduled alerts, activity digests, disk snapshots,
retention, anime auto-mapping, cache warming, and qBittorrent bandwidth rules.
One upstream failure must not cancel every other source.

Cleanup scheduling lives separately in `src/lib/cleanup/scheduler.ts`. Timers and
polling singletons are stored safely across development hot reloads, and shutdown
drains in-flight polling/cleanup work before process exit.

## Authentication and Authorization

Helprr uses a signed `helprr-session` JWT containing a database session id. The
JWT's user/role fields are hints only. Authoritative checks in `src/lib/auth.ts`
reload the database `Session` and related `User`; revoked sessions, expired
fixed-lifetime sessions, ownerless sessions, and pending/disabled users fail
closed.

This database reload means role, status, and capability changes take effect on
the next request without waiting for the 30-day JWT to expire. Middleware in
`src/middleware.ts` provides the fast cookie boundary, login redirect, CSP, and
security headers, but route handlers still perform authoritative checks.

Permissions use code-defined admin/member templates plus per-user delta maps in
`User.permissions`. Admins allow all. Member defaults are explicit, and an
unknown or newly added capability is denied until intentionally granted.

Local passwords use scrypt. New and reset passwords require at least 15 Unicode
code points, while existing compatible hashes remain verifiable. A user may have
no local hash when Jellyfin is the only login method.

`APP_PASSWORD` seeds the bootstrap admin only when a hash is needed; ordinary
login checks `User.passwordHash`. An admin password change through Settings ->
Users updates the hash and revokes all active sessions for the target in one
transaction. `HELPRR_ADMIN_PASSWORD_RESET=true` is a separate startup recovery
path for the bootstrap admin and does not revoke existing sessions, so suspected
compromise also requires explicit session revocation.

Public middleware exceptions must remain narrow. Liveness and readiness are
exact paths, not prefixes. Share-target handling is public at middleware only so
its route can preserve the incoming payload while applying its own auth check.

## Destructive Operations and Audit

Destructive actions require capability checks and, for file operations,
ownership validation against the selected upstream media object. These checks
must occur before deletion, import, or mutation.

The unified `FileOperationAudit` model records file edits/imports and destructive
whole-media, torrent, and queue operations. It stores actor, service/instance,
operation, target, item count, whether files/data were deleted, structured
details, success, and error information. Audit persistence is intentionally
fail-soft so an audit outage never changes the real upstream result; it is not a
substitute for authorization.

Interactive queue/download cleanup follows a two-stage protocol:

1. Preview computes the effective config, service scope, and exact candidate
   binding, then stores a random token in Redis for five minutes.
2. Execution atomically consumes that user/cleaner-bound token and rejects
   expiry, replay, user mismatch, cleaner mismatch, config/scope drift, or a
   changed candidate snapshot.
3. Immediately before each destructive call, the cleaner revalidates current
   upstream state and skips stale or no-longer-eligible candidates.
4. Every item receives a truthful outcome so partial success/failure and actual
   upstream state are reflected in history and UI.

Scheduled cleanup is a separate trusted background path and must not be forced
through an interactive token. Scheduler locking and watchdogs prevent overlapping
or indefinitely stuck cleanup cycles.

Cleanup evaluation fails closed on missing upstream data: a torrent whose
tracker lookup failed is skipped whenever the ignore list or a tracker-scoped
rule is configured; a torrent whose `private` flag is absent (qBittorrent < 5)
is treated as private for deletion gating and matches only `both`-scoped rules;
seed time uses qBittorrent's `seeding_time` (not wall-clock since completion);
import confirmation only accepts Sonarr/Radarr history events dated at/after
the torrent's `added_on` (re-grabs must re-import); and slow-rule triggers only
apply in active download states so completed/seeding torrents are never struck.
Cleaner intervals are validated to at most 7 days and defensively clamped below
the 32-bit `setInterval` limit. Cycles report `warnings` for anything skipped
or aborted, surfaced in the preview dialog and the dashboard's last-cycle line.

## PWA and Push

Production uses `src/app/sw.ts`, compiled by Serwist for precaching, runtime
caching, offline behavior, and push handling. `npm run build` explicitly uses
webpack because the current Serwist integration is not compatible with the
default Turbopack production build.

Development disables the Serwist build and registers `public/sw-push.js`, a
lightweight push-only worker that avoids production precache URLs and Fast
Refresh loops. `src/components/sw-register.tsx` selects the worker by
environment.

VAPID is runtime configuration. `VAPID_PUBLIC_KEY` is served by
`/api/push/public-key`; the legacy `NEXT_PUBLIC_VAPID_PUBLIC_KEY` remains a
fallback. Subscriptions and preferences are per user/device, and notification
capabilities are an outer gate around per-device event preferences.

## Persistence, Migrations, and Retention

Prisma 6 and PostgreSQL are intentional. Prisma migrations are the only schema
source of truth. The Docker entrypoint applies `prisma migrate deploy` before
starting Next.js. Never use `prisma db push` as a release path, edit a migration
listed in a released snapshot, or run development migrations against stable
data.

`prisma/release-snapshots` records immutable migration names and checksums for
released versions. `npm run test:migrations` reconstructs each released baseline
in a disposable database named exactly `helprr_migration_test`, seeds
representative user/service/cleanup/audit data, deploys all current migrations,
and verifies preservation and final migration state.

Persistent runtime data is bounded through the relevant subsystem:

- Notification retention follows `AppSettings.notificationHistoryRetentionDays`.
- Cleanup history and settled scheduled-alert occurrences use bounded history
  retention.
- Expired sessions and old operation audit rows are pruned.
- Disk samples and log files use their own retention windows.
- Image-cache retention reconciles database/Redis generations and orphan files.

When adding a new history or audit table, define and test its retention behavior
instead of leaving it unbounded.

## Health, Readiness, and Diagnostics

`GET /api/health` is unauthenticated liveness only: a success means the Node
process can serve a request and says nothing about dependencies.

`GET /api/ready` performs bounded checks for PostgreSQL, Redis, and the exact set
of fully applied migration directories. It returns HTTP 200 only when all checks
are `ok`, otherwise 503. Responses expose coarse status only, never connection
details or secrets.

Admin diagnostics include an update notice and downloadable support bundle. The
bundle collects version/runtime metadata, coarse readiness, safe database counts,
service configuration presence, migration names, and recent logs. It redacts
known current secrets, URL credentials, sensitive fields, and likely historical
credential shapes. A redacted support bundle is still private operational data.

Settings imports are hostile input: validate schema, reject unsafe values, and
preserve secret-handling behavior before applying any imported configuration.

## Docker and Release Boundaries

The stable and development Compose files are standalone stacks. They use
different container names, networks, volumes, databases, credentials, and host
ports. Source and `edge` builds belong only in the development stack. Stable
application replacement must target only `helprr`; PostgreSQL and Redis remain
running unless a separately authorized recovery procedure requires otherwise.

GitHub CI runs settings-export validation, ESLint, Vitest, Prisma validation,
released-snapshot upgrade tests, and a production build. Docker publication
builds native amd64 and arm64 images, scans both with Trivy, and assembles the
multi-architecture manifest only after both pass.

A push to `development` publishes `edge`. A version tag builds only the exact
version image and a draft release with the no-clone deployment assets. Stable,
minor, and major aliases move only after the exact digest has been backed up,
deployed, and smoke-tested through the manual promotion workflow. See
`maintainer-development-release-workflow.md` for the complete runbook.

## Current Technology Constraints

- Next.js 16 currently warns that `middleware.ts` is deprecated in favor of
  `proxy`. Migrating the auth/CSP/public-route boundary must be a focused,
  fully tested change rather than incidental cleanup.
- Tailwind CSS 4 uses `@tailwindcss/postcss`.
- Prefer Sonner over deprecated toast components.
- Strict TypeScript service-worker code requires Web Worker-specific typing;
  `src/app/sw.ts` is intentionally outside the main DOM-oriented type path.
