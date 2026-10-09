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
| Jellyfin | Library/watch state, in-app playback (direct play, remux, HLS transcode, subtitles), sessions, devices, and control |
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

Jellyfin in-app playback follows the same boundary. The browser never talks to
Jellyfin with an API key. Catalog and `PlaybackInfo` go through authenticated
Helprr routes (`jellyfin.view`). Stream, subtitle, HLS, Live TV, and attached
subtitle-font bytes go through `/api/jellyfin/media/...` after an allowlisted path
check and a per-item access check on every item path; libass's fallback font is a
static asset under `/libass`. The proxy rewrites
HLS playlist entries on the Jellyfin origin onto Helprr URLs and strips token
query parameters (`ApiKey`, legacy `api_key`) from them; an entry on any other
origin is passed through unchanged. Playback DeviceId is per-browser, with a
shared `helprr-pwa` fallback when browser storage is unavailable, so Helprr users
do not clobber one shared Jellyfin session. PGS
bitmaps are not advertised for client-side overlay so the server can burn them
in; ASS/SSA uses the same libass worker as jellyfin-web, falling back to a
server burn-in when that worker cannot render. libass sizes its canvas once, at
`loadedmetadata`, and Safari's native HLS reports no video dimensions until
`loadeddata`, so on iOS the canvas was never sized and every ASS track fell
back. The provider now waits for real dimensions (`whenVideoHasDimensions`),
asks libass to size itself again, and only then starts the check that decides
on the fallback. Verified on the iOS Simulator (iOS 27), not on a physical
iPhone.

Native text subtitles (WebVTT/SRT) are placed by writing `cue.line`, in one
place only — `applyCueLine` in the playback provider. It has two modes. With
the player chrome hidden it counts text rows up from the bottom of the video
box, which is what jellyfin-web does and what the Raise/Lower control in the
subtitle panel means. While the chrome is up it instead pins the cue box's
bottom edge to the top of the chrome, as a percentage of the video box with
`lineAlign: 'end'`. Rows and pixels only agree at one viewport size, so on a
phone the row placement drew the seek bar through the last line of a cue; a
percentage measured against the obstacle clears it at any viewport, for any
number of rendered rows including wrapped ones. The stage measures the
obstruction (it owns that DOM) and reports it through
`reportChromeObstruction`. Blink has no `VTTCue.lineAlign`, so a percentage line
there anchors the cue's top edge and draws it through the chrome. In Chrome the
cue instead sits on the bottom row and the browser's cue container is raised by
the obstruction: `applyCueLine` returns the distance, the provider sets
`data-cue-lift` and `--hpr-cue-lift` on the video element, and the rule that
reads them is in `globals.css`. A UA that has the attribute but ignores it falls
back to rows.
libass is not adjusted — it positions from the subtitle script inside the video
frame whether or not the chrome is up.

The authenticated shell keeps the Jellyfin watch and Seerr request providers
mounted so their React Query caches and optimistic updates survive navigation.
Their network queries run only while an eligible media consumer has registered
demand. The command-palette hotkey and mobile launcher remain in the shell, while
the dialog implementation loads on first open.

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

Image-cache startup is fail-soft and precedes background services. It probes a
randomized zero-secret file in the configured directory, creates the active
generation directory, and reconciles Redis metadata with immutable files. An
unwritable mount or unavailable Redis is reported as degraded diagnostics but
does not make liveness depend on optional cache storage; validated bounded
images continue through the no-store bypass path.

`src/lib/polling-service.ts` coordinates bounded, isolated poll sources for
Sonarr, Radarr, Lidarr, qBittorrent, Jellyfin, Seerr, and service reachability.
It also drives release and scheduled alerts, activity digests, disk snapshots,
retention, anime auto-mapping, cache warming, and qBittorrent bandwidth rules.
One upstream failure must not cancel every other source.

Cleanup scheduling lives separately in `src/lib/cleanup/scheduler.ts`. Timers and
polling singletons are stored safely across development hot reloads, and shutdown
waits up to 30 seconds for in-flight polling/cleanup work to drain before process
exit.

## Authentication and Authorization

Helprr uses a signed `helprr-session` JWT containing a database session id. The
JWT's user/role fields are hints only. Authoritative checks in `src/lib/auth.ts`
reload the database `Session` and related `User`; revoked sessions, expired
fixed-lifetime sessions, ownerless sessions, and pending/disabled users fail
closed.

This database reload means role, status, and capability changes take effect on
the next request without waiting for the 30-day JWT to expire. The proxy in
`src/proxy.ts` (Next.js 16's renamed middleware, on the Node.js runtime)
provides the fast cookie boundary, login redirect, CSP, and security headers,
but route handlers still perform authoritative checks.

Permissions use code-defined admin/member templates plus per-user delta maps in
`User.permissions`. Admins allow all. Member defaults are explicit, and an
unknown or newly added capability is denied until intentionally granted.

Local passwords use scrypt. New and reset passwords require at least 15 Unicode
code points, while existing compatible hashes remain verifiable. A user may have
no local hash when Jellyfin is the only login method. Signing in with Jellyfin
also connects that member's playback credential; see "Jellyfin Identity and
Playback Credentials" below.

`APP_PASSWORD` seeds the bootstrap admin only when a hash is needed; ordinary
login checks `User.passwordHash`. An admin password change through Settings ->
Users updates the hash and revokes all active sessions for the target in one
transaction. `HELPRR_ADMIN_PASSWORD_RESET=true` is a separate startup recovery
path for the bootstrap admin and does not revoke existing sessions, so suspected
compromise also requires explicit session revocation.

Public proxy exceptions must remain narrow. Liveness and readiness are
exact paths, not prefixes. Share-target handling is public at the proxy only so
its route can preserve the incoming payload while applying its own auth check.

## Jellyfin Identity and Playback Credentials

Helprr holds two different Jellyfin credentials per member, and the split is
deliberate.

`ServiceConnection.apiKey` is the admin API key and serves every **read**.
Catalog, resume, watch-status, and next-up calls pass an explicit `userId`
parameter, so the key reads any member's data scoped to that member. Reads stay
on the key on purpose: a member's own token going bad must degrade playback
only, never blank someone's library.

`User.jellyfinToken` is the member's own Jellyfin access token and serves only
**playback**. This is not an optimization. Jellyfin resolves a session's user
from the token alone -- the `/Sessions/Playing*` models carry no `UserId` field
-- so an API-key session belongs to nobody. Before this split, every Helprr
session showed no user in the Jellyfin dashboard, `/Sessions/Playing/Progress`
was rejected on every tick, and Playback Reporting had nothing to attribute.
Resume state was correct only because it is also written out-of-band through
`POST /UserItems/{id}/UserData?userId=`, which the API key may do for any user.

Jellyfin has no impersonation endpoint, so an admin key cannot mint a member
token. Each member authenticates once themselves, either through "Sign in with
Jellyfin" (which stores the token as a side effect of logging in) or through
Settings -> Account, which posts to `/api/account/jellyfin/link`. That route
verifies the authenticated Jellyfin user matches the profile's existing
`jellyfinUserId` and rejects a mismatch, because valid credentials for a
*different* account would otherwise let a member watch and record history as
somebody else. A member with no link yet is auto-linked, guarded by the unique
index on `jellyfinUserId`. The route shares the per-IP, per-username, and global
backoff keys used by the login routes so it cannot be used to work around those
caps.

Tokens are encrypted at rest with AES-256-GCM under a key derived from
`JWT_SECRET`/`APP_PASSWORD`, marked by an `enc:v1:` prefix. The prefix means a
plaintext value written before encryption landed still reads back and is
re-encrypted on the next write. A token that cannot be decrypted -- typically
after a secret rotation -- is treated as absent rather than raising, so the
member is asked to reconnect instead of every playback request failing.
`toSafeUser` exposes only a boolean; the token itself never reaches a response.

`JellyfinClient` takes the playback token beside the API key and **throws**
rather than falling back when it is missing, because silently signing a playback
call with the admin key is the exact defect this design removes.
`getJellyfinPlaybackContext` is the entry point for the JSON playback routes, and
`jellyfinConnectGateResponse` is where they answer
`409 { error: 'jellyfin_connect_required' }`; the media proxy resolves the member's
token itself and returns the same response. On the JSON routes both a missing
token and a missing identity link map to that one response, since connecting
also links. On the media proxy only a missing or rejected token does: an item
request from a member with no identity link fails the per-item access check
first and returns `404`.

Revocation has no push signal: a Jellyfin admin deleting the device in
Dashboard -> Devices invalidates the token silently. A `401`/`403` on any
playback call is therefore the only evidence, and the stored copy is dropped at
that point. The media proxy carries the token per HLS segment, so a mid-stream
revocation is caught there too.

Device identity matters in two places and they are not the same. A member's
token is minted against a stable per-account `DeviceId` derived from a hash of
the Jellyfin username, so members stop overwriting one shared device row in
Jellyfin's Devices view. Playback then presents that token with the *browser's*
own device id, giving one Jellyfin session per browser (browsers on the
`helprr-pwa` fallback share one). A token is accepted when
presented with a `DeviceId` other than the one it was minted against, which is
what makes a single stored token per member sufficient; that behaviour is
recorded as verified evidence in `docs/upstream-compatibility.md`.

### Player Queue and Next Up

`/Shows/NextUp` takes two narrowing parameters that are not interchangeable.
`ParentId` filters by **library**; `SeriesId` is the only way to ask for one
show. NextUp returns episodes, whose `ParentId` is their *season*, so a series
id passed as `ParentId` can never match a row and the call answers with an empty
list. `getNextUp` accepts both and `/api/jellyfin/catalog/next-up` exposes both;
every per-series caller must use `seriesId`.

The player's queue carries the **whole series** and the index carries the
position. jellyfin-web queues from the played episode onward and nothing before
it (`playbackManager.translateItemsForPlayback` filters the episode list with a
`foundItem` flag), which suits a player that only auto-advances. Helprr's player
has an episode panel, and a queue that begins at the current episode cannot show
one -- it reported a nine-item queue for a thirteen-episode show and marked row
one as playing. `resolvePlayable` therefore returns `{ items, startIndex }` and
`flattenPlayables` translates a caller's index into the flattened queue; the
series queue is capped at 500 episodes so one Play cannot become a
multi-megabyte payload.

Two consequences worth preserving. `el.play()` rejecting with `AbortError` or
`NotAllowedError` is not a playback failure -- hls.js assigns its own
MediaSource URL from `attachMedia`, so an interrupted start is routine; this
mirrors jellyfin-web's `htmlMediaHelper.playWithPromise`. And every switch that
replaces the stream must release the outgoing `playSessionId`: Jellyfin holds a
transcode for its idle timeout after the client stops reading it, and a
superseded start attempt has to hand back the session it was granted.

## Destructive Operations and Audit

Destructive actions require capability checks and, for file operations,
ownership validation against the selected upstream media object. These checks
must occur before deletion, import, or mutation.

The unified `FileOperationAudit` model records Manage files edits and imports and
the destructive whole-media, torrent, and queue operations a user performs
directly. It stores actor, service/instance, operation, target, item count,
whether files/data were deleted, structured details, success, and error
information. Queue and download cleaner runs, scheduled or interactive, do not
write to it: their per-item outcomes go to `CleanupHistory`, which records the
trigger (`auto` or `manual`) and the preview id but no actor. Audit persistence
is intentionally fail-soft so an audit outage never changes the real upstream
result; it is not a substitute for authorization.

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
through an interactive token. Scheduler locking prevents overlapping cycles of
the same cleaner; the queue and download cleaners hold separate slots and can run
at the same time. Every upstream call carries its own timeout, so a cycle always
settles; the watchdog only logs one that runs past five minutes, and that
cleaner's next cycle stays blocked until it does.

Cleanup evaluation fails closed on missing upstream data: a torrent whose
tracker lookup failed is skipped whenever the ignore list or a tracker-scoped
rule is configured; a torrent whose `private` flag is absent (qBittorrent < 5)
is treated as private for deletion gating and matches only `both`-scoped rules;
seed time uses qBittorrent's `seeding_time`, falling back to wall-clock time
since completion only when that field is absent;
import confirmation requires a complete import, not any import — an arr must
have grabbed the download, and every episode/movie in that arr's history for it
must have an import as its newest event (a newer failed or ignored event leaves
it unfinished), read from the download's full history rather than one page, so
a season pack with some episodes held back for manual import is kept; it only
accepts import events dated at/after the torrent's `added_on`, less a
five-minute clock-skew allowance (re-grabs must re-import); every configured arr
has a veto — confirmation is withheld while any arr queue lists the download in
a non-imported state, while any arr that grabbed the torrent has not finished
importing it, and whenever any arr's queue or history cannot be read completely;
a download no arr grabbed (added by hand, then imported) is never confirmed,
because without grabs nothing says what it should have delivered and an empty
arr queue is not proof the arr is finished; a paged arr read counts as complete
only when it delivers a records array that meets the arr's reported total; and
slow-rule triggers only apply in active download states so completed/seeding
torrents are never struck.
Cleaner intervals are validated to at most 7 days and defensively clamped below
the 32-bit `setInterval` limit. Cycles report `warnings` when a cycle aborts and
when torrents are skipped because an arr or tracker data could not be read,
surfaced in the preview dialog and the dashboard's last-cycle line.

## PWA and Push

Authenticated routes share scroll restoration in `AppShell`. Navigation captures
the outgoing route before displaying its loading feedback, which preserves the
outgoing page's layout height. Positions are tab-scoped and keyed by pathname and
canonical query string, including service instance. The shared controller restores
the document and nested scrollers as content becomes available, and yields to user
scroll gestures and explicit controls. Saved destinations settle after 400 ms of
quiet layout, with an eight-second upper bound for unreachable positions. Lazy
placeholders below the viewport do not block restoration. A layout-induced
clamp does not overwrite a higher saved destination. Inline overflow and Radix
scrollports participate, and dashboard keys include widget identity. Page components must not add competing mount-time scroll resets.
Use `data-scroll-restoration-key` for independently scrolling rails and panels.

`useRouteViewState` retains small presentation state that determines the layout,
such as expanded seasons, selected sections, filters, and table pages.
`useRestorableInfiniteQuery` retains the loaded page count and rebuilds that depth
after the query payload cache expires. Payloads remain in TanStack Query; action
dialogs, pending mutations, and credentials are not retained as view state.

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
- Image-cache retention reconciles Redis generation and metadata records with the
  files on disk and removes orphans.

The bundled stable and development Compose stacks persist image bytes in the
distinct `helprr-image-cache` and `helprr-dev-image-cache` named volumes, both
mounted at `/app/image-cache`. Authorization decisions are never stored there:
both image routes reauthorize before cache lookup, and the Jellyfin route also
rechecks per-item access unless the user is an admin or holds `jellyfin.sessions`
or `jellyfin.stats`. A generation bump remains authoritative over browser,
PWA, Redis, foreground fills, and background refreshes.

Fresh files are returned without queue or rate accounting. Expired files inside
the stale window are returned immediately and schedule one low-priority,
generation-safe refresh. True misses enter a bounded per-instance fair queue,
coordinate five-per-user/sixteen-global running leases through Redis, and charge
the per-user token bucket only immediately before a real upstream start. Local
promise coalescing and the Redis fill lock prevent duplicate fetches. Successful
transforms are written to randomized immutable files before a short, bounded
quota-lock transaction registers metadata and performs deterministic LRU
eviction. Retention uses a separate renewable-duration maintenance lease.
Settings and administrator support bundles expose only bounded aggregate image
diagnostics; source URLs, cache keys, filesystem paths, credentials, and raw
user identifiers are excluded.

`/api/image` always re-encodes, so Sharp metadata validation is followed by one
full transform decode; pass-through `/api/jellyfin/image` keeps the separate
full-decode validation. TMDB URLs are right-sized server-side without changing
the logical cache key. The PWA caches only non-stale `/api/image` responses for
a fixed seven days from fetch and never caches Jellyfin artwork.

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
different container names, networks, image-cache/database/Redis/log volumes, databases, credentials, and host
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

- Next.js 16 renamed `middleware.ts` to `proxy.ts`. A proxy always runs on the
  Node.js runtime and rejects the `runtime` segment config; it must stay
  DB-free and never exit the process, since it runs on every request.
- Tailwind CSS 4 uses `@tailwindcss/postcss`.
- Prefer Sonner over deprecated toast components.
- Strict TypeScript service-worker code requires Web Worker-specific typing;
  `src/app/sw.ts` is intentionally outside the main DOM-oriented type path.
