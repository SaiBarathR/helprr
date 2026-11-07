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
| Prowlarr | Indexers, quick edit, search and grab, app sync, tests, history, and statistics |
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

A value that becomes part of an upstream path is matched against a strict
pattern in the route first. Jellyfin ids are strings rather than numbers, and the
URL parser resolves dot segments, so an id such as `../Items/<id>?` would turn a
call signed with the server's key into a call to another endpoint. As a second
line, `JellyfinClient` refuses to send any path carrying a dot segment, `?`, `#`,
`%`, a backslash, whitespace, or a control character, and the media proxy rejects
a path with `%` or a control character, which the parser would read as a
traversal after the allowlist check. The proxy does not decode a segment a second
time (Next has decoded it once), and it checks the path of the upstream URL it
built against the allowlist again before sending.

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
back to rows. Gecko has it but swaps `'end'` and `'center'` for a percentage
line, so in Firefox `cueBottomLineAlign` anchors with `'center'`, which Gecko
draws as a bottom anchor.
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
Sonarr, Radarr, Lidarr, Prowlarr health, qBittorrent, Jellyfin, Seerr, and service reachability.
It also drives release and scheduled alerts, activity digests, disk snapshots,
retention, anime auto-mapping, cache warming, and qBittorrent bandwidth rules.
One upstream failure must not cancel every other source. Sonarr, Radarr, and
Lidarr instances share two polling slots per cycle; an instance that fails twice
in a row is skipped (without taking a slot) for 30 seconds, doubling to 5
minutes from the start of the failing cycle, until it answers again or its
connection is edited. Cache warming skips that library meanwhile. Skips still
show as failures in the polling status, with the last error.

Cleanup scheduling lives separately in `src/lib/cleanup/scheduler.ts`. Timers and
polling singletons are stored safely across development hot reloads, and shutdown
waits up to 30 seconds for in-flight polling/cleanup work to drain before process
exit.

## Authentication and Authorization

Helprr uses a signed `helprr-session` JWT containing a database session id. The
JWT's user/role fields are hints only. Authoritative checks in `src/lib/auth.ts`
reload the database `Session` and related `User`; revoked sessions, expired
fixed-lifetime sessions, ownerless sessions, and pending/disabled users fail
closed. A session whose stored `lastSeenAt` is older than the 14-day idle
timeout (`src/lib/session-policy.ts`) is refused and revoked on that request.
`lastSeenAt` is written at most once every five minutes per session, so normal
requests do not each write to the database.

This database reload means role, status, and capability changes take effect on
the next request without waiting for the 30-day JWT to expire. The proxy in
`src/proxy.ts` (Next.js 16's renamed middleware, on the Node.js runtime)
provides the fast cookie boundary, login redirect, CSP, and security headers,
but route handlers still perform authoritative checks.

Permissions use code-defined admin/member templates plus per-user delta maps in
`User.permissions`. Admins allow all. Member defaults are explicit, and an
unknown or newly added capability is denied until intentionally granted.

A read that pages under different capabilities depend on is gated with
`requireUserAnyCapability` (for example quality profiles, read by the library
pages under `*.view` and the add pages under `*.add`), so gating it never breaks
a page a member can already open. `get-route-capability-matrix.test.ts` assigns
every GET route exactly one policy and fails when a route and its declared
policy drift apart.

List routes read `page`, `pageSize`, `skip`, `take` and `limit` through
`src/lib/pagination.ts` (`parsePageParams`, `parseSkipTake`, `parsePageNumber`
for AniList and TMDB page numbers, or `parseInt32` with a maximum), so a
hand-written query string cannot ask the database or a service for an unbounded
page or a deep offset. Invalid values fall back to the
route's default and out-of-range ones are clamped. `route-pagination-guard.test.ts`
fails when a route reads one of these parameters another way and is not listed
there with the reason it is bounded.

The same rule covers pages that several sections link to. Discover title,
person and collection pages, and their routes, accept any capability in
`TMDB_TITLE_PAGE_CAPABILITIES` (Discover, Movies, Series, Recommendations,
Watchlist); Anime detail pages accept `ANIME_DETAIL_PAGE_CAPABILITIES`. The
Discover and Anime home pages, the Anime schedule and explore pages, and their
list routes need `discover.view` / `anime.view` themselves. The global
search's TMDB scope also needs `discover.view`, except for a member who can
create requests (with Seerr connected) and open the title pages: TMDB search is
their only way to find a title to request. `canUseSearchProvider` holds that
rule for both the palette and the provider route.

Stored service API keys and custom header values never leave the server; the
settings API returns a mask. A mask sent back means "keep the stored value", and
is honoured only with the URL that value was stored for. Testing or saving a
connection under another URL needs the secret typed again, and a URL change drops
stored headers the request does not carry. Otherwise managing instances would be
enough to read a key by pointing its connection at another address.

For the same reason the service clients do not follow a redirect to another
host. The HTTP library drops `Authorization` and `Cookie` when a redirect leaves
the host, but not `X-Api-Key`, custom headers, or the body of a 307 or 308,
which for a sign-in is the password. `refuseRedirectToAnotherHost`
(`src/lib/redirect-guard.ts`) is passed as `beforeRedirect` to every client that
carries a credential; the same host and port is still followed, including an
upgrade from http to https. A connection whose URL redirects elsewhere fails
until the URL is corrected.

Local passwords use scrypt. New and reset passwords require at least 15 Unicode
code points, while existing compatible hashes remain verifiable. A local login
that verifies a hash weaker than the current scrypt parameters stores a fresh
current-policy hash, replacing only the hash it verified, so a later cost
increase reaches every active account without a reset. A stronger stored hash
is kept. A user may have
no local hash when Jellyfin is the only login method. Signing in with Jellyfin
also connects that member's playback credential; see "Jellyfin Identity and
Playback Credentials" below.

`APP_PASSWORD` seeds the bootstrap admin only when a hash is needed; ordinary
login checks `User.passwordHash`. Without `APP_PASSWORD`, the first admin is
created in the browser at `/setup` (`src/lib/first-admin.ts`). That screen and its
routes (`GET /api/setup/state`, `POST /api/setup/admin`) are open only while the
`User` table is empty and `APP_PASSWORD` is unset; the answer is latched per
process once a user exists, and no app path empties the table again. The claim
creates the row with the fixed `BOOTSTRAP_ADMIN_ID` in a transaction that re-checks
the table, so the primary key decides a race. It requires same-origin JSON: with
`APP_ORIGIN` set the `Origin` must equal it, otherwise `Origin` must match `Host` and
be a local address (IP, `localhost`, single-label, `.local`, `.lan`, `.home.arpa`,
`.internal`), which rules out DNS rebinding. The residual case is a single-label
name completed through a hostile network's wildcard search domain; `APP_ORIGIN`
closes it. It is rate-limited per IP when a trusted
proxy gives one, and to ten claims a minute per process. On boot the bootstrap
admin is renamed to `HELPRR_ADMIN_USERNAME` only when that variable is set, so a
name chosen at `/setup` survives a later `APP_PASSWORD` reset. An admin password change through Settings ->
Users updates the hash and revokes all active sessions for the target in one
transaction. A user's own change through Settings -> Account (`POST /api/me/password`)
checks the current password behind the same IP, per-username and global throttles as
sign-in (a wrong one counts as a failed sign-in and returns 403, since the client sends
every 401 to Login), then writes the hash and revokes every other session of that user in
one transaction; the current session stays valid without a new cookie. Accounts without
a local password (Jellyfin-only) get 409.

Settings -> Account also lets a user delete their own account (`DELETE /api/me`). The
user comes from the session only; an id in the body is ignored. A local account
re-enters its password behind the same throttles as a password change; a Jellyfin-only
account enters its Jellyfin password behind the same throttles, checked against Jellyfin
as the linked Jellyfin user (its name looked up by id; a sign-in that lands on another
Jellyfin user is refused, and an unreachable Jellyfin answers 502 and counts nothing).
In one transaction it takes the last-admin guard lock (for
an admin), locks the user row only if it is still the account just confirmed (same hash,
Jellyfin link, role and status, this session still live), then runs the same guarded delete and cascade
as Settings -> Users (`deleteUserUnlessLastAdmin` in `src/lib/user-deletion.ts`). Every
change that can remove an active admin (delete, demotion, disable) takes the same
transaction-scoped advisory lock before counting the admins left, so two of them cannot
both pass the guard. The self-delete writes `USER_DELETED` with the user as actor and
clears the cookie. `GET /api/me/export` is the matching "Download my data": the user's
own rows, by named columns, never a hash, token, push endpoint or key, session id or
another user's rows. It includes the recommendation ratings and "Not interested"
events (not impressions, clicks or plays), the stored taste profile, and the per-video
seen/hidden flags of YouTube and Twitch videos.

Invite and password-reset links (`src/lib/password-links.ts`, table `PasswordLink`,
one row per user) let a person set their own local password. An admin makes one in
Settings -> Users: creating a user with `invite: true` makes a `pending` user with no
password plus an invite in one transaction, and `POST /api/users/[id]/password-link`
makes an invite for a pending user or a reset for an active user with a local password
(409 for disabled and Jellyfin-only accounts). The token is 32 random bytes, returned
once in that response (never logged), and only its SHA-256 is stored; a new link
replaces the row, which ends the old one, and `DELETE` revokes it. A PATCH that sets a
password or changes status also ends it. A link is `/invite#<token>` on the configured
`APP_ORIGIN` (sent with the token as `origin`, or `linkOrigin` on user create), or on
the admin page's own address when `APP_ORIGIN` is unset; a set but invalid
`APP_ORIGIN` makes no link (500, and no invited user is created): the token is in
the fragment, which browsers never send to a server. The public `/invite` page (excluded
from the service worker's page cache, served with `Referrer-Policy: no-referrer`) reads
`location.hash` once, replaces the URL with `/invite` (one tick later, through the router's
`replaceState` hook) so the token leaves the address bar and the tab's Back history, and
posts the token in a JSON body to `POST /api/invite/state` and
`POST /api/invite/accept`; the proxy exposes exactly those three paths. Both routes are
JSON-only behind their own throttles (`src/lib/invite-rate-limit.ts`), apart from
sign-in's so junk links cannot lock anyone out of signing in: a 10/min per-IP bucket
(trusted proxy only) and a global backstop of 30 failures per 15 minutes, where malformed
bodies and unusable links both count. The per-IP bucket runs before the body is read, so
it limits junk bodies too. The trade-off, as for sign-in's global backstop: a caller who
keeps sending bad links can hold the invite page at 429, but never sign-in. Every unusable link gets one 404 answer (unknown,
malformed, expired, used, revoked and wrong-state alike) and an `INVITE_LINK_FAILED`
audit row with no token, coalesced per coarse IP and minute. A link works until `expiresAt` (7 days for an invite, 24 hours for a reset) and only
while the user is still `pending` (invite) or `active` (reset). Accepting runs one
transaction: a conditional user update on that status (password, `active`), a delete of the
link matching its id and hash (single use; a race loser rolls back), and a revoke of every
session of the user; then it signs the browser in. Making, replacing, revoking and using
links are security audit events. `HELPRR_ADMIN_PASSWORD_RESET=true` is a separate startup recovery
path for the bootstrap admin: in one transaction it sets the password from `APP_PASSWORD`,
deletes the admin's password link, calendar feed link and API tokens, turns off two-step sign-in (secret
and recovery codes, with an `MFA_DISABLED` audit row when it was on), and revokes every
session of the admin (and any
owner-less legacy session, which the startup attach would otherwise hand to the admin). It
does this on every start while the flag is set, so remove it after one boot.

Two-step sign-in (`src/lib/totp.ts`, `otpauth` for RFC 6238): optional per user, for
accounts with a local password. `User.totpSecret` is enc:v1 (the Jellyfin-token cipher, via
`twitch/token-cipher.ts`); it counts only once `totpEnabledAt` is set, so an unconfirmed
setup changes nothing. With it on, a right password (or Jellyfin sign-in) returns no
session but a 5-minute HS256 "MFA pending" JWT with its own audience and no `sid`, so
`decodeToken` never accepts it. It is bound to the user by an HMAC stamp of the password
hash, Jellyfin link and `totpEnabledAt`, so any of those changing ends it.
`POST /api/auth/login/totp` checks it, applies the sign-in throttles keyed on the account,
verifies a code (±1 step) and uses it up in the same conditional write
(`totpLastUsedStep < step`), then spends the token's `jti` in Redis (`SET NX`, fail closed)
and makes the session. The first step no longer clears the username backoff or IP bucket
for these accounts, so a known password cannot reset them between code guesses, and every
wrong code counts (no repeat-guess dedupe). Before a code is checked, one Redis script
counts the attempt atomically: 10 authenticator codes per account per fixed hour (sign-in,
enable and disable share it; cleared when a code passes; recovery codes skip it, so someone
with only the password cannot lock the owner out of them) and 5 per pending token, and it
answers "expired" for a token already used, so a retry after a lost response burns no code.
A password-reset link for such an account sets the password and makes no session; a reset
link an admin made after two-step sign-in was turned on (not an older one, and not one the
user made for themselves) also turns it off in the same transaction (`MFA_DISABLED`,
`reset-link`). An admin can turn off another
user's two-step sign-in (`DELETE /api/users/[id]/totp`), which ends every session of that
user in the same transaction; their own needs the password and a code. Turning it on can
also end the user's other sessions (`signOutOtherDevices`). Ten
80-bit recovery codes are stored as SHA-256 (`RecoveryCode`, deleted on use) and still work
after a `JWT_SECRET` change, when the secret no longer decrypts. Setup needs the current
password; turning it off needs the password and a code. Settings export never carries
either. Audit: `MFA_ENABLED`, `MFA_DISABLED`, `MFA_RECOVERY_CODE_USED`, and a wrong code as
`LOGIN_FAILED` with method `totp`.

Trusted-header sign-in (`src/lib/trusted-auth.ts`, `POST /api/auth/trusted`): off unless
`HELPRR_TRUSTED_AUTH_HEADER` and a valid `HELPRR_TRUSTED_AUTH_SECRET` (32+ printable
non-space ASCII, not a placeholder, not `JWT_SECRET`) are both set; a bad value turns it
off with a startup warning naming the variable, never stopping startup. Addresses are never
trusted (route handlers cannot see the connecting address, and `X-Forwarded-For` is the
visitor's): the proof is the shared secret in `HELPRR_TRUSTED_AUTH_SECRET_HEADER`
(default `X-Helprr-Proxy-Secret`), compared with `timingSafeEqual` on SHA-256 digests.
The login page asks `GET /api/auth/trusted` (`{ enabled }`) and then POSTs once. The POST
is same-origin JSON only (a JSON content type needs a CORS preflight Helprr never grants,
and a `Sec-Fetch-Site` other than `same-origin` is refused), behind the sign-in throttles: a
missing secret header counts as a malformed request (401, so the page quietly shows its
form), a wrong one as a global failure plus `LOGIN_FAILED` method `trusted-header-secret`
with the name masked. A missing secret is checked before the IP bucket, so the login page reached some other
way spends no attempts. With the right secret the named user must be the exact username,
as at password sign-in (Prisma's `mode: 'insensitive'` is an unescaped `ILIKE`, and case
folding would let a proxy's `Admin` in as `admin`); the per-name backoff is skipped, since
the proxy vouched for the name. A disabled or pending account or none is `LOGIN_FAILED`
method `trusted-header-no-account`, and nothing is ever provisioned. Header names HTTP,
Next.js or Helprr already use (`Cookie`, `User-Agent`, `X-Forwarded-For`, `Range`, `If-*`, `sec-*`, …) are
refused at config time. Success makes a normal session (`LOGIN_SUCCEEDED`, fields
`['trusted-header']`) without two-step sign-in: the proxy's sign-in is the second factor.
Its JWT carries the username in claim `tu` and an HMAC stamp of the proxy secret in `ts`
(`src/lib/trusted-session.ts`): the request proxy and `decodeToken` refuse it unless
trusted-header sign-in is still validly on with the same secret and the user header still
names exactly that user, so a sign-out at the proxy, another user signing in there, a
changed secret or the feature turned off refuses it on the next request (the row is not
revoked: restoring the same config makes it work again). The stamp is an HMAC under
`JWT_SECRET`, so a holder cannot test guesses at the proxy secret against it. Server auth
also refuses it once the account's username is no longer `tu`. Logout still revokes such a
session: the request proxy lets `/api/auth/logout` through without the binding, and
`getCurrentSid` checks only the signature. Only sessions made this way are bound; a
password session on the same browser is not.
The logger redacts the configured secret wherever it appears and the default header name
as a key; request headers are never logged.

Generated secrets: with the bundled Compose file, a short-lived `helprr-init`
service (`docker/init-secrets.sh`, the app image run as root with no network) makes
what `.env` does not set, once, on the fixed-name `helprr-secrets` volume: a root-only
master per value (`jwt_secret` and the time it was made, `vapid_keys` holding both
push keys, `postgres_password`, `redis_password`), published with `ln` so two runs at once never both write one
and never regenerated while it exists, plus per-reader copies in `app/` (the image's
`nextjs` group) and `worker/` (`TWITCH_PGID`). Readers own nothing in the volume:
folders are `root:<group>` 0750 and copies `root:<group>` 0640, staged in a per-run
root-only folder and moved in, so a reader cannot plant a link the root init would
follow; the app mounts the volume read-only. A value set in the environment always
wins, its stale copies are removed, and the VAPID pair is all or nothing. `docker-entrypoint.sh` exports the app's copies
before migrations and `node server.js` only when the environment has none, so the
proxy, startup validation and every token cipher see one value; the worker loads its
`JWT_SECRET` copy first thing in `main.ts`. An older Compose file has no init and no
volume, so the app never generates into its container layer and the environment must
provide the values, as before. `update.sh` runs the init (it never regenerates) before
replacing the app, and `backup.sh` saves the volume beside each dump as
`<dump>.secrets.tar`. When the generated JWT secret is younger than some user (the
volume was lost), the app warns at startup and on **Settings -> Status** for 14 days:
stored tokens are unreadable and every session ended.

Start with no `.env`: `POSTGRES_PASSWORD` and `REDIS_PASSWORD` are generated the same
way when unset, so `docker compose up -d` with only the Compose file runs Helprr.
Postgres and Redis run as root at start (both then drop to their own user: Redis's
wrapper gives `/data` to uid 999, then starts through its image's
`docker-entrypoint.sh`, which drops root) and Redis's group is 1000, the worker's
default group, so they never mount `helprr-secrets`: each gets a root-only copy
(0600) of its own password on its own small volume
(`helprr-db-auth`, `helprr-redis-auth`), which init rewrites from the master on every
run. Their Compose entrypoints read the copy only when the environment has no
password and refuse to start when there is neither; the official image's
`POSTGRES_PASSWORD_FILE` is not used because it exits when `POSTGRES_PASSWORD` is also
set. Postgres reads the password only when it creates the database, so removing a
password from `.env` later does not change the database's password: keep `.env`
once it exists. The app gets `DATABASE_URL=${DATABASE_URL:-}` and builds the default
URL in `docker-entrypoint.sh`: an explicit URL, else `POSTGRES_PASSWORD`, else the
`app/` copy (generated passwords are hex, so nothing needs encoding); `REDIS_PASSWORD`
likewise. The worker builds its URL in the same order at the top of `main.ts`. The
development Compose file keeps requiring its explicit values.

Importing apps from Seerr and Prowlarr (`src/lib/service-import.ts`, admin only): Seerr's
`/settings/sonarr|radarr` return each server's API key, Prowlarr masks every key. Keys
never reach the browser; an import looks Seerr's key up again on the server and sends it
only to the exact address Seerr holds (scheme, host, port, path), else a typed key is
needed. To find an address Helprr can reach, the list sends credential-free `GET /ping`
requests (2.5 s, redirects not followed, exactly 200) to the addresses those apps hold,
the same port on Prowlarr's own host, and `host.docker.internal`. A changed Seerr or
Prowlarr config can therefore make each admin listing touch other addresses, learning
only whether they answered: the same trust as an admin-configured connection.

Public proxy exceptions must remain narrow. Liveness, readiness and the
first-admin screen and routes are exact paths, not prefixes. Share-target handling is public at the proxy only so
its route can preserve the incoming payload while applying its own auth check.

The calendar feed (`GET /api/calendar/feed.ics`, Calendar -> Subscribe in
Calendar) is an exact public path too: calendar apps send no session. Its
credential is a named `CalendarFeedToken` link (`src/lib/calendar-feed/token.ts`),
up to 10 per user, each with its own stored filters (type, instance, monitored
only): 32 random bytes sent as `?token=`, of which only the SHA-256 is stored, so
the link is shown once when made (`POST /api/calendar/feed-token` with a name and
filters, `calendar.view`). Turning one off deletes its row
(`DELETE /api/calendar/feed-token/[id]`, own links only, 404 otherwise); both are
in the security audit. The single link from before named links became one named
"Calendar" with no stored filters; its URL's `?type=&instance=&monitored=` still
apply, and on any link they can only narrow its own filters. Movie and album
releases are all-day events on the local date of the upstream instant in the
app's time zone (`AppSettings.timeZone`, Settings -> Preferences -> Timezone),
not its UTC date (the Calendar page itself uses the browser's zone); episodes
stay timed in UTC. A password change (own, an
admin reset, a reset link used, or the `HELPRR_ADMIN_PASSWORD_RESET` startup
reset), an admin disabling the user, and a settings import that restores a
different password hash or status also delete it, in the same transaction as the
user update, so re-enabling an account does not bring an old link back. Taking
`calendar.view` away (Settings -> Users permissions, or an import) deletes them
too, so giving it back does not either. Each of these ends every link the user has. "Sign out other sessions" leaves it. Every fetch re-reads the
owner's status, role and capabilities: an unknown, replaced or malformed token, a
disabled owner and a missing `calendar.view` all get the same bare 404. Only then
is it rate-limited per token hash in Redis (30 per 15 minutes, failing closed
when Redis is down), so guessed tokens never create per-token keys. Behind a
trusted proxy (the sign-in client IP), a well-formed token that opens no feed
also counts against the client IP: after about 30 in 15 minutes that IP gets 429
for any token until the window ends. The cap is checked before the lookup and
counted after it, so a burst of parallel requests can overshoot it; reading it
fails closed (503) and refused requests do not extend the window, while counting
a miss is best-effort. There is no global backstop, so one client cannot lock
everyone's feeds, provided `TRUSTED_PROXY_HOPS` matches the proxies in front:
with too few hops every visitor shares the proxy's address and its cap. The token grants only that read; `type`, `instance` and `monitored`
query parameters narrow it the way the Calendar page's filters do and are
validated. The window is 30 days back to 180 ahead (whole days in the app time
zone); episodes are timed events, movie and album releases all-day. The request
log redacts the token, but a reverse proxy's access log may keep it.

Personal API tokens (`ApiToken`, `src/lib/api-tokens.ts`; Settings -> Sessions ->
API tokens) open the read-only status API and nothing else. A token is `hlp_` and
32 random bytes (base64url); only its SHA-256 is stored, so it is shown once when
made (`POST /api/me/api-tokens` with a name, scopes and an optional expiry of 1 to
365 days; up to 10 per user). Its scopes are read capabilities from a fixed list
(`src/lib/api-token-scopes.ts`), and each must be one the owner holds when it is
made (403 otherwise). It is sent as `Authorization: Bearer hlp_…`, which the proxy
lets through only for `GET /api/v1/summary` and `GET /api/v1/queue` (exact paths)
and refuses with 401 on every other path and method, before any other rule, so a
public path or a session cookie never carries one elsewhere; without the header
those two paths are 401 too, so a session never opens them. No CORS headers are
sent and preflights are refused. Each request (`authorizeApiTokenRequest`)
re-reads the token and its owner: a missing, malformed, unknown, turned-off or
expired token, or an owner who is not active, is the same 401 with
`WWW-Authenticate: Bearer`, and counts against the client IP behind a trusted
proxy: after 30 refusals in 15 minutes that IP's refused tokens get 429 instead
(reading the cap fails closed; refusals while held do not extend it). The cap is
applied only to refusals, after the lookup, so a stale widget's old token never
locks a live token on the same IP out. A live token is rate-limited by its hash
(300 per 5 minutes, failing closed), and only the scopes the owner still holds
are used; none left is 403. A role or capability change therefore narrows a token on its
next request without ending it (Settings shows which scopes are not used now). A
password change (own, an admin reset, a reset link used, or the
`HELPRR_ADMIN_PASSWORD_RESET` startup reset), an admin disabling the user, a
settings import that restores a different password hash or status, and deleting
the user end every token the user has ("Revoke all other sessions" and an admin
turning off two-step sign-in do not). A token is made only while the creating
session is live, in a transaction that holds its row, so a password change either
deletes it or ends the session first. The first use from a network a token has
not been used from (the coarse IP, or `unknown` without a trusted proxy; the last
20 are kept per token) is an `API_TOKEN_NEW_NETWORK` audit row; making and turning
off a token are `API_TOKEN_CREATED` (with the scopes) and `API_TOKEN_REVOKED`,
with the token as the target (type `api-token`, its id and name). A password
change, reset or disable that ended some, and the startup reset, are one
`API_TOKEN_REVOKED` row on the user with the count; a settings import that ends
them is covered by its `SETTINGS_IMPORTED` row. The status API
(`src/lib/status-api.ts`) is a public contract, versioned in the body: the summary
holds one section per scope the token may use (downloads from qBittorrent, the
queue size, free space on the disks of the apps whose view scope it has, the next
three releases, active Jellyfin streams, unread alerts), null when that service is
not set up or did not answer (the queue count is null when any instance did not
answer, which `QueueResult.partial` reports), and leaves the rest out; it is
cached for 10 seconds per scope set, never when a section did not answer (alerts
are per user and live). The queue is the first 100 items of the combined
Sonarr/Radarr/Lidarr queue (page 1 of each instance), soonest estimated
completion first, with `partial`, without paths, download ids or indexers.
Responses are `no-store`. The request log never holds the header, and the logger
redacts `Authorization` by key and any `hlp_…` string. Settings exports never
include tokens.

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
Resume state was correct then only because Helprr also wrote it out-of-band
through `POST /UserItems/{id}/UserData?userId=`. With the member's token, Jellyfin
saves the resume position from the session reports themselves, as it does for its
own clients (the latest report wins), so Helprr no longer makes that extra write.

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
Jellyfin signs the URLs in its playback negotiation with that token
(`TranscodingUrl` carries `ApiKey=`), so the `mediaSource` that
`buildHelprrStreamInfo` returns is limited to the fields the player reads, and
`mediaUrl` and the subtitle and attachment URLs are rewritten onto the media
proxy with token parameters stripped. The item beside it, and the catalog item
route's item and extras, pass through `withoutSourceLocation`: Jellyfin's
single-item endpoints return the server path and, for a remote source, its
address and request headers, and none of that is sent to the browser.

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

"Add to queue" appends what an item holds, never a container: a series becomes
its episodes, a season only its own, an album its tracks. A container queued as
it stood was a row the player could not start. An addition belongs to the queue
it was asked for: a Play or a Stop discards one still being looked up, and a
Play that is still expanding its own container puts back, after the expansion,
whatever was queued in the meantime. While another item's start is in
flight the outgoing stream still belongs to the outgoing item, so nothing may
act on it as if it were the incoming one: a seek that restarts the stream waits
out the pending start, and the "has reached its start offset" flag is reset
only when the new stream is adopted, not when it is requested.

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

The unified `FileOperationAudit` model records file edits and deletes, manual
imports, and the destructive whole-media, torrent, and queue operations a user
performs directly, including removing *arr blocklist entries
(`REMOVE_BLOCKLIST`: one row per request and instance, with the entry ids in its
details; the request must name an instance of that service, never the default),
changing the root folder of library items from the bulk editor (`MOVE_MEDIA`:
one row per request and instance, with the item ids, the folder, and whether files
were to be moved; success means the *arr accepted the change and queued any move, not
that the move finished; it needs the service's `changePath` capability, and the folder must
be one of that instance's root folders),
removing several queue items from Activity's Select mode (`REMOVE_QUEUE`: one
row per request and instance, the queue ids and removal options in its details;
the client sends at most 1000 ids per request, one request at a time per
instance. The *arr removes item by item and skips ids it no longer has, so after
the call, failed or not, the route reads that instance's queue again (at most
10 s) and records `remainingIds` (still listed) and `removedIds` (no longer
listed, so it includes ids already gone before the call), with the item count as
`removedIds`, or `outcome: 'partial-unknown'` when the queue cannot be read in
full in time) and marking a grabbed or imported history event failed
(`MARK_FAILED`, which blocklists the release and searches again; the *arrs have
no history get-by-id, so the route forwards any numeric event id of that
instance and only the UI limits it to grabs and imports). Those two, and Grab now
on a delayed queue item, also require an explicitly named instance of that
service. Grab now is not audited: it releases a download early and removes
nothing. These interactive removals are a user's direct action, like the single
queue Remove, not a cleaner run, so they take no cleanup preview token.
The bulk editor's other settings (quality and
metadata profile, series type, season folder, monitor-new, minimum availability) are
admin-only, as on the single-item edit, and profile ids are checked against the
instance before the write.
It stores actor, service/instance, operation, target, item count, whether files/data were to be deleted (the choice made: a failed row may
have deleted nothing), structured details, success, and error
information, plus when the upstream call started and, for a row written while
an API request is handled, that request's `x-request-id` (`withApiLogging` opens
an `AsyncLocalStorage` request context that `recordOperationAudit` reads). The
row's `createdAt` is when the result was known: every caller writes it right
after. An import is checked before it is queued, because the *arr's
`ManualImport` command moves whatever path it is handed: from a title's file
manager every path must be in that title's folder, and from the Activity page
every path must be one the *arr lists for the download. A Lidarr import is also
checked against Lidarr's album: each album must be the named artist's, on one
of its releases, with the tracks that release's, because Lidarr
imports to whatever ids it is handed. The command routes do
not accept `ManualImport`. A rename's file ids are checked against the title it
names, as the file manager's edits and deletes are, because the *arr renames
whatever ids it is handed. A rename (per-file or Organize) needs `activity.manage`
and the title's file capability: `series.manageFiles`, `movies.manageFiles`, or for
music, which has none, `music.delete` (the capability on its track files). Renames
are not audited; the *arr keeps them in its own history. Queue and download cleaner runs, scheduled or interactive, send
their per-item outcomes to `CleanupHistory`, which records the trigger (`auto`
or `manual`), the actor (`actorUserId`/`actorUsername`: the user who ran the
preview or run, or `system:cleanup-scheduler` with a null id for a scheduled
cycle) and, for an interactive run, the preview id. Every upstream call a
cleaner makes that can delete something also gets its own operation-audit row,
written once that target is reconciled: `DELETE_TORRENT` for a qBittorrent
deletion, `REMOVE_QUEUE` with the service and instance for each *arr queue
removal. `success` is true only when the target's intended final state was
observed (the queue item gone and, when the call also removed the download from
the client, the torrent gone too); its details hold the hash, queue item id,
rule, preview id, options, before/after state and the call's error. Dry runs,
stale or failed revalidations and re-searches write no audit row, and the
preview token is never stored. Audit
persistence is intentionally fail-soft so an audit outage never changes the real
upstream result; it is not a substitute for authorization.

`SecurityAuditEvent` is the separate security and admin trail behind the
admin-only **Security** tab of Operation audit (`GET /api/security-audit`).
`src/lib/security-audit.ts` writes it, fail-soft and after the action, from
local and Jellyfin sign-in (success and failure, including a wrong current
password on the self password change, a Jellyfin account with no linked
profile, and a wrong password or wrong account when a member connects their own
Jellyfin account), first-admin setup, user create/edit/delete (an admin
password reset with the sessions it revoked), a member linking their own
Jellyfin account, permission changes, the self password change, session
revocations, service connection add/edit/delete (main, external URL, YouTube,
Twitch, AniList and the Seerr/Prowlarr import), settings import, and a user
making or turning off a calendar feed link (renewals before named links appear as rotations), and making,
turning off or ending personal API tokens and a token's first use from a new network. A row holds the actor (id not a FK, username
denormalized), action, target type/id/label, the coarse IP (IPv4 /24, IPv6 /64,
from the trusted-proxy address only), a 256-character user agent, the request
id, and `fields`: the names of what changed (or the sign-in method, or the
imported sections), never a hash or key; the one value kept is a new role, as
`made admin` or `made member` in place of `role`. A failed sign-in has no actor
(the signed-in user for a self-service check) and keeps the username as typed
(owner decision 2026-11-07, accepting that a password typed into the username
box is kept too), with control and format characters (zero-width, bidi) and line
separators removed and at most 64 code points (`(unprintable)` when nothing is
left); the account is `targetId` when the name is an active Helprr
account. `recordFailedSignIn` upserts on a `coalesceKey` that is an HMAC under
`JWT_SECRET` (or `APP_PASSWORD`) of (method, full normalized username, coarse IP,
actor, minute), so repeats add to one row's `count`. The tab pages 50 rows at a time and can hide failed
sign-ins (`hideFailedSignIns=1`) so a flood cannot bury account and connection
changes; the switch also hides `INVITE_LINK_FAILED` rows. Only attempts that reach the credential check are recorded,
so the sign-in rate limits and global backstop also bound how many rows a flood
can write.

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

The Queue Cleaner links each torrent, by hash, to the queue items of every
configured Sonarr, Radarr and Lidarr instance; a removal goes through each
instance that queued it, with that instance's id, and a re-search asks Sonarr
for the episodes or seasons, Radarr for the movie and Lidarr for the albums.
A queue that cannot be read completely aborts the cycle, and a check before
removal refuses the item. Each app can be turned off in the Queue Cleaner's
settings (`includeSonarr`/`includeRadarr`/`includeLidarr`): its queues are then
never read, so they cannot abort a cycle, and its torrents are evaluated as
unlinked (qBittorrent-side rules only; no blocklist, re-search or failed-import
strikes for that app).

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
A removal's outcome is decided from what the upstreams report afterwards, before
its `CleanupHistory` row is written. If that row cannot be written the failure is
logged and the outcome stands, so a torrent that was removed is never reported as
a failed removal.

## Library cleanup ("Leaving soon")

`src/lib/library-cleanup/` removes whole library titles nobody watches. It never
deletes on its own: preview → mark Leaving soon → countdown → an admin's
explicit, token-bound **Delete now**. Rules, preview, marking and deletion are
admin-role only (`requireAdmin`; `cleanup.manage` alone is not enough). The
shelf (`GET /api/leaving-soon`) lists only the types the caller may view, and
**Keep** (`POST /api/leaving-soon/[id]/keep`) needs view access to the stored
title's type. Keep and Delete now both claim the `LeavingSoonItem` row
(`deleteMany` by id, count 1) before calling the arr, so only one of them acts;
Keep then adds the configured keep tag through the arr's editor (`KEEP_MEDIA`
audit row), puts the row back when the arr call fails, and answers 409 when a
run holds the title. Changing the keep tag stops protecting titles kept with
the old one.

- **Inputs** (`inputs.ts`), gathered fresh for every preview, mark and delete,
  fail closed with `LibraryCleanupUnavailableError` (503) when any configured
  Radarr/Sonarr instance (titles, tags, the complete queue), Jellyfin or Seerr
  cannot be read completely. Seerr not being connected is a warning (Helprr's
  pending requests still count); Jellyfin not being connected blocks. For
  **every** Jellyfin user Helprr reads the library as that user sees it (the
  provider-id index is their union), everything marked played or partly
  watched, and every item
  with a `LastPlayedDate` (`SortBy=DatePlayed`, newest first, paged until the
  first undated item: a play in progress or stopped early has a date and a
  `PlayCount` but is neither played nor resumable). Series use their episodes,
  since series items carry no `LastPlayedDate`. Whatever `/Sessions` shows
  playing counts as watched now. A Seerr request waiting for approval is always
  open; 4K requests are judged by `status4k`; a partly available series stays
  protected.
- **Exclusions** (`evaluate.ts`, always on): keep tag, any watchlist (TMDB/TVDB,
  library-id saves on any instance, AniList via mapping or any name the arr
  knows the title by), an open Seerr or Helprr request or one created in the
  last N days, in the queue, watched in the last N days, a play without a date,
  not matched in Jellyfin, no files. For a marked title the window starts at the
  earlier of `markedAt` and N days ago, so a watch or request during the
  countdown always protects it.
- **Delete now** reuses the cleanup preview-token store with cleaner
  `library`; the binding holds the settings fingerprint, the arr connections,
  the import-list choice and the ready titles. Execution re-gathers everything
  and refuses the whole run (409, nothing deleted) when the ready set differs.
  A title whose instance is no longer connected, or whose arr id now carries
  other provider ids than when it was marked, is never deleted. Right before
  each call the run claims the row (a Keep that got there first wins) and
  re-reads that one title: a keep tag added in the arr, or other provider ids,
  stop it. A failed call is checked against the arr (404 means it is gone) and
  otherwise puts the row back. Every attempted
  title writes one `DELETE_MEDIA` audit row and one `CleanupHistory` row
  (`cleaner: library`, `removedFromLibrary` / `failed` / `skipped`); titles
  already absent from the arr leave the list with a `skipped` row. One run per
  process at a time.
- Marking can push the title's past requesters (`leavingSoon`, gated by
  `notify.requests` and view access; watchlisted titles cannot be marked).
  Settings travel in the settings export's `cleanup.libraryConfig`; marked
  titles do not.

## Manual Downloads (Sonarr/Radarr)

Add Torrent can send a magnet or `.torrent` to Sonarr or Radarr for one title
(`src/lib/manual-downloads/`, `src/app/api/manual-downloads/`, model
`ManualDownload` with its `ManualDownloadEvent` history). Arr owns the download;
Helprr authors no parsing and never trusts its own reading of a release.

- **Arr-managed (default).** `preflight.ts` asks Arr: the title by TMDB/TVDB id,
  the add options, `GET /api/v3/parse` for the release name (Radarr maps by TMDB
  id only when the year agrees; Sonarr maps by title first), monitoring, an
  earlier grab of the same hash, and the download client (Arr's tag and priority
  rules; several eligible clients mean the user chooses). `send.ts` records the
  workflow under an advisory lock (one active workflow per instance and hash;
  `@@unique([createdByUserId, clientRequestId])` makes a retried submission
  return the same workflow), adds the title with searches off when it is new,
  pushes the release (`POST /api/v3/release/push` with `downloadClientId`), and
  proves the grab from Arr's history by download id. A `.torrent` is offered to
  Arr through a single-use link: the bytes sit in Redis under a 256-bit token
  for two minutes (`GETDEL`), served by the public, unlogged
  `/api/manual-downloads/torrent/[token]` at `ARR_CALLBACK_ORIGIN` (else
  `APP_ORIGIN`). When Arr cannot have the release (a failure before the push,
  a release Arr turns down or answers with its own 4xx, or one it accepts
  without grabbing), a title the workflow added is removed while it has no
  files and nothing else uses it. When the outcome is unknown (a lost answer, a
  gateway's 5xx), the title stays and the workflow goes to `BLOCKED` for the
  status worker to follow.
- **Advanced fallback (`QBIT_REVIEWED`).** For choosing files first: the torrent
  is Helprr's own in qBittorrent, outside any category Arr watches, and every
  file is recorded (`ManualDownloadFile`) as chosen or not; one workflow per
  torrent across instances (an advisory lock on the hash). A download client in
  Arr with no category watches every torrent: the check warns, and Arr may then
  import the torrent on its own, outside Helprr's choice. The check proves Arr can
  see qBittorrent's save folder (the remote path mappings for the host Arr knows
  Helprr's qBittorrent by, longest first, then the path unchanged, each
  confirmed by Arr's own folder listing); every scan resolves it again. When the
  torrent completes, each chosen file is checked in qBittorrent (same index,
  name and size, set to download, complete), then Arr's manual import reads it
  (never with a title id, which makes Arr scan the title's folder); candidates
  are matched by exact path. Helprr imports on its own only when Arr maps every
  chosen video to the target without objection (a chosen video Arr leaves out
  goes to the user), otherwise `NEEDS_MAPPING` until the user decides per file
  on the Map files page, after Arr has checked that exact mapping. Imports use
  `ManualImport` with `importMode: copy` (hardlinks), so the torrent keeps
  seeding; an import that upgrades a file replaces it (Arr deletes or recycles
  the old one, and the audit lists it in `replacesFileIds`); with Arr's Import
  Extra Files on, an import stops when a video's
  folder holds an extra that was not chosen. A scan, an import or a cancel first
  claims the workflow (a conditional update to `IMPORT_PENDING` from the status
  and `updatedAt` read) and writes only while still holding it, so none of them
  overlap (the status worker takes over a claim held for 10 minutes) and races
  run once. The decisions, targets, baseline and send time (`importSentAt`) are
  saved before Arr is asked: an import interrupted by a restart, or one Arr did
  not answer, stays claimed until the status worker proves it from history,
  adopts it from Arr's command list (queued since it was sent), or leaves it to
  the user; it is never sent again on Helprr's own. Only a claim that sent an
  import is recovered this way; any other expired claim (a scan, a cancel, or an
  import interrupted before it was sent) reads the files again and leaves the
  import to the user (`NEEDS_MAPPING`).
- **Status authority.** The `pollManualDownloads` polling source reconciles
  every open workflow each cycle against its own instance: Arr's queue, then its
  history, or qBittorrent for the fallback. `IMPORTED` requires file ids the
  target did not have before (a new movie file; for Sonarr, a new file on every
  target episode), each from this download's own import event; for the
  fallback, from the decided file's own path. Writes apply only from the status
  and `updatedAt` read at the start of the cycle, so a cancel landing meanwhile
  wins. Sends interrupted by a restart are settled after 10 minutes from Arr's
  grab history. Only Arr history from an hour before the workflow began counts
  (an earlier send of the release is at least 12 hours older), so Helprr's and
  Arr's clocks must agree within that hour.
- **Permissions and audit.** Sending needs `torrents.add` + `activity.manage` +
  the service's `movies.add` / `series.add` (the fallback also `torrents.manage`);
  reading needs `torrents.view` + `activity.view`; importing, scanning again,
  cancelling and unlinking need `activity.manage`, and cancel's removals also
  `torrents.delete` and `movies.delete` / `series.delete`. Adding a title
  (`CREATE_MEDIA`), pushing a release (`PUSH_RELEASE`), imports, queue removals,
  torrent and title deletions are all operation-audited. Magnets and torrent
  links are never stored or logged: a workflow keeps the info hash and name.

## PWA and Push

Authenticated routes share scroll restoration in `AppShell`. Navigation captures
the outgoing route before displaying its loading feedback, which preserves the
outgoing page's layout height. Positions are tab-scoped and keyed by pathname and
canonical query string, including service instance. Only Back/Forward and reload
restore a saved position; a push (or a plain replace) starts the new view at the
top, and a `scroll:false` URL sync keeps the viewport, restoring the synced URL's
own offset only when the view was not itself a fresh, unscrolled arrival. Because
positions are per URL, two history entries for the same URL share one. The shared controller restores
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

The `pages`, `api-readonly`, and `api-images` caches belong to one signed-in
session (`src/lib/client-cache.ts`). Login clears them when it opens and
`/api/me` answers 401, which covers sign-out, expiry, and a session revoked from
another device; a signed-in or offline visitor keeps them. Sign-in clears them
again before it completes and refuses to sign in if it cannot.

The `pages` cache stores HTML shells stamped with the current build version;
older or unstamped shells are cache misses because they can reference removed
chunks. Shells whose CSP nonce differs from the first body nonce are never
stored and are evicted on read. Validation reads only through that first nonce,
preserving streaming and fast cached starts. A mismatched navigation response,
including navigation preload, is retried once with a plain fetch; if that fails
or still mismatches, the worker returns the precached `/offline.html`. The retry
is served directly; subsequent background revalidation can refill the cache.
`/offline.html` (also the fallback for a never-visited route) reloads itself
every 10 seconds with a meta refresh so it leaves on its own once the connection
returns; it cannot use a script because it is served with the nonce CSP.
Navigation preload is off, and the worker turns it off on activate because the
flag lives on the registration: after a cache hit WebKit cancels the preload and
the worker's wait on `preloadResponse` never settles, which kept the previous
worker busy and an update "waiting" until the installed app was force-quit. The
mismatch retry above only matters while a registration still has preload on.
The worker that first ships this was preceded by one with preload on, so that one
handover can still need a force-quit; later updates take over on their own.

Development disables the Serwist build and registers `public/sw-push.js`, a
lightweight push-only worker that avoids production precache URLs and Fast
Refresh loops. `src/components/sw-register.tsx` selects the worker by
environment and is the only registration: Serwist's own is off
(`register: false`).

VAPID is runtime configuration. `VAPID_PUBLIC_KEY` is served by
`/api/push/public-key`; the legacy `NEXT_PUBLIC_VAPID_PUBLIC_KEY` remains a
fallback. Subscriptions and preferences are per user/device, and notification
capabilities are an outer gate around per-device event preferences.

On app open and notification settings visits, the push hook compares the browser
subscription's application server key with the runtime public key before
re-registering a missing server row. After a key rotation, granted permission
allows it to unsubscribe the stale browser subscription and register a new
subscription that takes over the old server row (preferences and name are kept).
A revoked device stays revoked. If automatic recovery fails, the device is shown
as disabled and the re-enable banner offers
the same replacement with one tap. Explicit enable/disable actions clear the
re-registration notice across the banner and settings. Browser subscription
lookups time out after five seconds so an unresponsive PushManager cannot keep
the controls loading indefinitely. The Devices page flags consecutive delivery
failures with recovery guidance alongside the recorded failure and delivery times;
the subscription stores those counts/times, not the push service's error text.

"Now in your library" (`watchlistAvailable`, `src/lib/polling/watchlist-available.ts`)
is sent from the Radarr/Sonarr history poll: a non-upgrade import of a title on
someone's watchlist sends that person their own copy (a follower event, gated by
`notify.watchlist` plus `movies.view`/`series.view` and `watchlist.view`). Items
match by TMDB/TVDB id, or by the arr id for items saved from a library page (with
several instances of the app, the title must match too). An import is an upgrade,
and skipped, when the same poll's history has an Upgrade file deletion for it
within a minute. Each watchlist item is claimed once through
`WatchlistItem.availableNotifiedAt` before sending (at most once: a failed send
is not retried), so imports on several instances, later episodes and cleared
notification lists never push again; the history dedupe key is per person per
title, for two instances claiming different saved copies of one title. The
tap opens `/watchlist?focus=<id>` (Open or Remove), the iOS stand-in for the
Android/desktop Remove button.

"New episode" (`watchingNewEpisode`, `src/lib/polling/watching-episodes.ts`) runs
right after it in the Sonarr poll. A non-upgrade episode import alerts each active
person with their own Jellyfin link (`User.jellyfinUserId`; the admin fallback to
the connection user is not used) who played that series in Jellyfin within
`UserSettings.watchingEpisodeDays` (default 14, 0 = off; Settings → Notifications
→ Watchlist), gated by `series.view` and `notify.watchlist`. Plays come from
Jellyfin's own per-user play state (`/Items` sorted by `DatePlayed`, paged until
older than the 90-day maximum or 1,000 plays, then the series' provider ids in chunks of 100),
cached per person for the watch-status TTL, so the Playback Reporting plugin is
not needed. Series match by TVDB id when both sides have one, otherwise TMDB id.
A Jellyfin error skips that person; two people in a row with no answer end the batch.
Both personal alerts claim each episode they announce in `AnnouncedEpisode`
(`userId` + `<title key>:S01E05`, inserted with `skipDuplicates`, keys sorted)
before sending, so an episode reaches a person once across instances and across
the two alerts, even after they clear their notifications; "Now in your library"
skips a series send whose episodes were all claimed already and releases
its watchlist claim for the next episode. Rows are never
pruned (one per person per announced episode). With grouping on, three or more
new episodes for a person in one poll send one grouped push.

A subscription's endpoint is a URL the server posts to, and it arrives in a
request. `src/lib/push-endpoint.ts` therefore accepts only the push services
browsers use (FCM, Mozilla autopush, Apple, Windows Notification Services): the
subscribe route refuses any other address and logs its host, and the sender
checks again before every push. A browser on another push service cannot
subscribe until its host is added there.

### Outbound notification channels

`NotificationChannel` rows (ntfy, Gotify, Apprise, JSON webhook, SMTP email)
belong to one user. `config` holds the non-secret fields; the secret fields are
one enc:v1: encrypted JSON object (`src/lib/notification-channels/config.ts`,
the TOTP/Twitch cipher) that the API never returns: it reports only which
secret fields are set. An empty secret field keeps the saved value, null clears
it, and keeping a secret while the channel's address changes is refused, the
rule masked service-connection keys follow. Every user, admins included, reads
and changes only their own channels; an admin also gets counts of everyone's.
A settings export with secrets carries only the exporter's own channel secrets.

`notifyEvent` claims the dedupe row, then selects the enabled channels that
picked the event, filters them through the same `recipientAllowed` gate as push
(capability, `ADMIN_ONLY_EVENT_TYPES`, targeted `userIds`), the owner's quiet
hours and a per-channel backoff (5 minutes doubling to 6 hours), and starts
delivery without awaiting it, so a slow endpoint never holds up a polling cycle.
Grouping happens before `notifyEvent`, so channels get grouped messages.

Every outbound address goes through `src/lib/outbound-url.ts`: http(s) only, no
credentials in the URL, and link-local, cloud metadata and reserved addresses
(also wrapped in NAT64, 6to4 or IPv4-compatible IPv6) refused both as typed and
for every address a name resolves to at connect time (`createGuardedLookup`;
SMTP connects to the address resolved through the same guard, with the name
kept for TLS). LAN, loopback and Tailscale addresses are allowed for an admin's
channel (the reach service connections have, which only admins manage) and
refused for anyone else's, decided by the owner's current role at save and at
send time. At most two guarded DNS lookups run at once. HTTP sends refuse
redirects to another host, bypass any proxy, and stop at 10 seconds. Sends to
one channel run one at a time in a process; after a failure the rest of a
burst is dropped, and failures within a minute count once. A failure stores only a fixed short reason (`HTTP 401`, `Timed out`),
never a response body or a secret; channel routes do not log bodies and the
logger redacts the channel secret field names.

`updateAvailable` (once per release: a Redis marker of the last announced
version plus the dedupe key `updateAvailable:<version>`, from a six-hourly
polling job using the update-check cache) and
`securityAlert` (an admin's sign-in from a user agent family, versions
stripped, not among their last 200 sign-ins; 10 failed sign-ins
in 10 minutes, two-step sign-in turned off; raised from the security audit
writes without being awaited) are admin-only events for push and channels.

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

Database backups come from two places. `scripts/backup.sh` runs `pg_dump` in the
database container and saves the generated secrets beside the dump. After a dump is
validated and its secrets are saved, it records the time in
`AppSettings.lastDatabaseBackupAt` with one `UPDATE` through the same container; that
write is best effort and never fails the backup.

Backups made in Helprr (`src/lib/database-backup.ts`) run `pg_dump` from the app image
(`postgresql16-client`, the bundled server's major) into `BACKUP_DIR` (`/app/backups`,
the `helprr-backups` volume; `helprr-dev-backups` for development). The connection goes
to the child only in libpq's variables (`PGHOST`, `PGUSER`, `PGPASSWORD`, ...), never in
argv, and its environment is only those and `PATH`. The dump is written to an exclusive
0600 partial file, checked with `pg_restore --list`, then hard-linked to
`helprr-backup-<UTC stamp>.dump` (renamed after a free-name check where the folder has
no hard links), so nothing is overwritten. A client past its timeout gets SIGTERM, then
SIGKILL, and the run ends either way, so a hung mount cannot hold the lock. In the Docker image the folder must be a mount (read from
`/proc/self/mountinfo`), or no backup is made: one in the container's own layer would be
lost on the next update. One run at a time per process (a promise on `globalThis`), for
**Back up now** (`POST /api/admin/database-backup`, 202, 409 while running) and the
schedule alike. Success records `lastDatabaseBackupAt` and prunes to the newest
`databaseBackupKeep` of its own names; each success or failure writes a security audit
row (`DATABASE_BACKUP_CREATED`/`_FAILED`, fields: trigger, size or reason code). The
dumps are listed by name and size and never served. `helprr-init` gives an empty,
root-owned backup folder changed in the last five minutes (a host folder Docker has just
made) to the app's user.

The poll source `checkDatabaseBackup` starts the scheduled backup (daily or weekly, on
the first poll at or after `databaseBackupHour` in the app time zone, claimed in
`databaseBackupScheduledAt` so a window is tried once) without waiting for it. While a
schedule is on, it pushes admins (`databaseBackup`, `userIds` = active admins) when a
scheduled run fails, and when `lastDatabaseBackupAt` is older than
`databaseBackupAlertDays` plus six hours' grace, at most daily (`databaseBackupAlertedAt`). With the schedule
off it never pushes, so a `backup.sh`-only install is not reminded.

The admin-only `/api/admin/database-backup` serves all of this to **Settings -> Backup &
Restore** (amber when no backup is recorded or it is over seven days old;
`GET /api/settings` leaves out the backup time and schedule), and a recorded backup
ticks the setup checklist's backup step. Backups made another way are not seen. The
settings export is not a backup, does not carry the backup schedule, and does not tick
that step.

Persistent runtime data is bounded through the relevant subsystem:

- Notification retention follows `AppSettings.notificationHistoryRetentionDays`.
- Cleanup history and settled scheduled-alert occurrences use bounded history
  retention.
- Expired and idle sessions and old operation and security audit rows are pruned.
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
a fixed seven days from fetch and never caches Jellyfin artwork. Jellyfin artwork
is requested from Jellyfin as WebP (default quality 80) and served
`private, no-cache` with a strong ETag of the bytes, so the browser revalidates
each use and gets an empty 304 only after both authorization checks pass.

An upstream 404, 413 or 415 is remembered in Redis for ten minutes per cache key
and generation (`helprr:cache:image-negative:*`), and both routes send that
answer as `private, max-age=600`, so a broken image is not refetched upstream on
every render; a browser can therefore keep showing it for up to about twenty
minutes. Stale bytes are still served meanwhile, without a background refresh.
Outages, timeouts and rate limits are never remembered, and without Redis every
request goes upstream as before.

When adding a new history or audit table, define and test its retention behavior
instead of leaving it unbounded.

## Health, Readiness, and Diagnostics

`GET /api/health` is unauthenticated liveness only: a success means the Node
process can serve a request and says nothing about dependencies.

`GET /api/ready` performs bounded checks for PostgreSQL, Redis, and the exact set
of fully applied migration directories. It returns HTTP 200 only when all checks
are `ok`, otherwise 503. From the moment a SIGTERM/SIGINT drain begins it reports
`stopping` (503), so nothing reading readiness sends the draining instance new work. Responses expose coarse status only, never connection
details or secrets.

Admin diagnostics include an update notice and downloadable support bundle. The
bundle collects version/runtime metadata, coarse readiness, safe database counts,
service configuration presence, migration names, and recent logs. It redacts
known current secrets, URL credentials, sensitive fields, and likely historical
credential shapes. A redacted support bundle is still private operational data.

Settings imports are hostile input: validate schema, reject unsafe values, and
preserve secret-handling behavior before applying any imported configuration.

An import is checked before any database work: 4 MiB, 20,000 array entries and
50,000 object properties for the document, then per-section limits
(`src/lib/settings-import/limits.ts`) where the app itself caps the data
(dashboard layouts, notification rules), plus YouTube channel and playlist
follows (2,000 each, far more than the daily API quota can poll), which are
written row by row, so no export of a real install is refused. Each section lives in its own module under `src/lib/settings-import/`;
the large ones (watchlists, alerts, anime mappings) are validated and normalized
before the transaction opens and written with bulk statements. The whole import
is one transaction, so a failure in any section saves nothing, with an explicit
60-second timeout (`IMPORT_TRANSACTION_TIMEOUT_MS`). Its duration and per-section
counts are logged, never values. A document at the size limits commits in well
under a second into an empty database; the slowest one the limits allow (about
4,000 user accounts, still written one by one) takes about 9 seconds on local
PostgreSQL. `src/lib/__tests__/settings-import.integration.test.ts` measures
both against a disposable PostgreSQL (`SETTINGS_IMPORT_TEST_DATABASE_URL`, a
database named `helprr_import_test`) and checks that a failure in each section
rolls back the others.

After the import transaction commits, `src/lib/settings-import/follow-ups.ts`
brings the running server in line with it: loading app settings, purging the
image cache (`purgeOlderCacheGenerations`, which fails loudly and sweeps every
older generation, so a retry finishes what a failed run left; the Settings
toggle keeps its fail-soft purge), restarting polling and the cleanup schedulers, pruning orphan
strikes, resolving release alerts, clearing the dashboard layout cache and
repairing default instances. A step that fails does not fail the saved import.
It comes back in the response's `warnings` with fixed text (never an upstream
error, credential or header). The Backup page keeps them across the reload that
applies an import and shows them with a Retry button. Each step reads
what it needs from the database, so `POST /api/settings/import/follow-up` can
re-run it without the file. That retry keeps the import's boundary: a member may
retry only the resolution of their own alerts.

## Docker and Release Boundaries

The stable and development Compose files are standalone stacks. They use
different container names, networks, image-cache/database/Redis/log volumes, databases, credentials, and host
ports. Source and `edge` builds belong only in the development stack. Stable
application replacement must target only `helprr`; PostgreSQL and Redis remain
running unless a separately authorized recovery procedure requires otherwise.

GitHub CI runs `git diff --check` on the change, a production dependency audit,
settings-export validation, ESLint, Vitest, Prisma validation, released-snapshot
upgrade tests, and a production build. On a pull request it also validates both
Compose files, each with its own generated env file, builds the amd64 image,
starts it with the stable Compose file until `/api/health` and `/api/ready`
answer 200, and scans it. Every
workflow action is pinned to a commit SHA, and Dependabot proposes updates to
those pins against `development`. Docker publication
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

## Twitch and YouTube archivers

Both run on one shared engine. `src/lib/archive/` and `src/worker/archive/` hold what they
share, each row carries an `ArchivePlatform`, and a `PlatformAdapter` supplies what differs.
The section below describes the engine through Twitch. YouTube differs as follows.

- **Tools:** YouTube has its own yt-dlp (`ytdlpYoutube`), so updating it cannot move Twitch's
  tested version. `extractorFailures` and `toolsPausedAt` are per platform, and `claimJob`
  takes the platforms it may claim. A failed YouTube install or smoke test turns YouTube off
  and never stops Twitch. `main.ts` cannot be unit tested, because it starts on import.
- **Library:** Compose mounts `/dev/null` at `/media/youtube` when no folder is chosen, so
  nothing is created and nothing can be written. YouTube joins `PLATFORMS` only after
  `isMountedFolder` confirms a mounted directory.
- **API quota:** counted per Pacific day with conditional updates, so requests running
  together cannot lose a count or pass a limit. `search.list` has its own daily bucket.
- **Discovery:** one unit per channel for its uploads list, then `videos.list` only for new
  ids and streams that have not ended. A playlist spends one unit on its item count, and
  reads its items only when that moved. Titles come free with the list.
- **`FORMATS` jobs:** a small lane with one reserved slot, so a person is never kept waiting
  by long downloads. Only format ids, picture sizes, codecs and byte sizes are stored, never a
  format link, and the job row is removed when it finishes.
- **One format decision:** `pickDownload` in `src/lib/youtube/formats.ts` is used by the sheet
  on the stored list and by the worker on a fresh list, which then passes exact format ids to
  yt-dlp. So what the sheet shows is what is fetched, and no yt-dlp selector can disagree.
  Quality outranks codec. A format's quality is YouTube's own label, or the smallest standard
  frame it fits, never its height alone: 2:1 and portrait videos would be misnamed. The worker
  records its choice in `chosenFormat`, for the Queue and the video page.
- **Spare account:** stored `enc:v1`, write-only through its routes, and written to a mode 600
  file for one job only when a video needs it. With no working account an age-restricted job
  stops before YouTube is asked, because repeated failed logins could harm the account.

### Automatic cleanup

Twitch's cleanup only runs when a person presses Run. YouTube's `sweepWatchedVideos` runs
hourly, so its safety rules are strict. Change them only with care.

- Only the watched rule runs automatically, so an unwatched video can never clear itself.
- It reads as the stored viewer on the stored connection, and checks the connection's
  fingerprint, because editing a connection keeps its id. There is no fallback to another user.
- Any failed read stops the sweep. It does not use `loadPlayedDates`, which returns nothing on
  failure. Sessions are read last, and a video playing now is skipped.
- 20 files a sweep and 50 a day. Going over pauses cleanup and sends a push.
- The worker checks keep forever, cleanup on and the rule generation under the file lock, and
  claims the file there with `REMOVING_STAGE`. Removal stays outside the lock, so a slow disk
  cannot outlast it. `setKeepForever` takes the same lock, and refuses once a file is claimed.
- Accepted: the worker has no Jellyfin access, so playback starting in the moments after the
  session check is not seen. The video is already watched and can be downloaded again.

## Twitch archiver

Optional, and off until a Twitch connection is saved. Admin-only by default: the
`twitch.*` capabilities are not in `MEMBER_ALLOWED`.

- **App** (the normal image): UI, API, authorization, per-user state, Helix
  discovery in `pollTwitch`, the rules engine, enqueueing, notifications, and
  every Jellyfin call. It never reads or writes media files or runs an external
  program.
- **Worker** (`helprr-twitch-worker`, Compose profile `twitch` or `youtube`): the only process
  that runs yt-dlp, TwitchDownloaderCLI and ffmpeg, touches the library, or uses
  `/dev/dri`. It holds no Helix credentials, no Jellyfin access and no push keys.
- They talk only through PostgreSQL. There is no new HTTP surface and `src/proxy.ts`
  is unchanged. The app owns migrations; the worker waits for them and never runs one.

Invariants:

- Enqueueing goes through `enqueueDownload`: at most one active download per video,
  checked under an advisory lock, and `clientRequestId` makes a repeat harmless.
- The worker claims with `FOR UPDATE SKIP LOCKED` and a 60 s lease renewed every 20 s.
  A write back is conditional on still owning the lease, so a takeover wins. A
  shutdown requeues what was running.
- Child processes lead their own process group and are killed as a group, or
  ffmpeg outlives yt-dlp. Arguments are arrays with no shell; tokens are mode-600
  files, never argv; yt-dlp's JSON holds signed URLs and stays out of errors.
- A file is published with its sidecars first and the video last, from staging on
  the same disk. Jellyfin finds items by the tag `twitch-v<id>`, never by path, and
  paths are never sent to the browser.
- `autoDownloadEnabled` is off by default and is checked before the rule layers, so
  no rule, urgency or backfill can queue anything while it is off.
- A re-encode swaps under the same name, so Jellyfin keeps the item and its watched
  state, only after validation and only if at least 10% smaller. The original is
  kept for `keepOriginalDays`, and its deletion is audited.
- Retention revalidates each candidate at run time, and never deletes a keep-forever
  file or one with a job in progress. An unreachable Jellyfin means nothing is known
  to be watched, so the watched rule then deletes nothing.
- Three extractor failures in a row, across jobs, pause downloads and send a push: that
  pattern points at the tools rather than a video. The worker installs newer tools then,
  or when the owner asks, and never while a download is running.
- The worker creates library files group-writable and adds group write to older ones, so a
  Jellyfin sharing the worker's group can delete them. The worker then forgets a file that vanished, every two minutes, and
  sweeps its sidecars with an audit row. It acts only on a clear not-found, and only with
  the `.helprr-library` marker present, so an unmounted disk cannot look like a deletion.
- `pollTwitch` spends nothing on a streamer with no subscribers. Subscribing again takes
  a new silent baseline, so a gap cannot arrive as a flood of pushes.
- Polling and rules are per creator (and per playlist), not per follower: anyone still
  following keeps it polled and its rule downloading, and so does a followed YouTube playlist
  holding a channel's videos. So an unfollow answers whether anyone else still follows and,
  to a `*.manage` holder only, how many and whether a rule would still download
  (`src/lib/archive/followers.ts`, before title or length conditions). For a channel or
  streamer the page then offers **Turn off auto-download** through the normal policies
  route; for a playlist it links to the rules of up to three of its channels whose rules
  still download. Only `*.manage` holders get a creator's or playlist's follower count, and
  never names.
- A user's own Twitch sign-in (`TwitchUserLink`, device code flow) has one scope,
  `user:read:follows`, and importing follows only ever adds subscriptions.
- A video's category comes from the live stream or its chapters, because Helix has none,
  so older videos have no category.
- The Library (`/twitch/library`) reads `ArchiveMediaFile`, and `serializeFile` is the only
  shape that leaves the server, so a stored path never reaches the browser. `sizeBytes`
  is always the file as it is now; a re-encode keeps the size before it in
  `originalSizeBytes`. Deleting and restoring an original are worker jobs
  (`DELETE_ORIGINAL`, `RESTORE_ORIGINAL`) like any other file change: the app only
  queues them, under the same per-file advisory lock as `enqueueFileDelete`, and refuses
  while another job is on the file. A restore is one rename over the same name, so the
  video is never missing and Jellyfin keeps the item.
- A re-encode at `REENCODE_NOW_PRIORITY` or above skips the night window and the Jellyfin
  hold, because a person asked for it. Anything below still waits for both.
- `ArchiveDeletedFile` is the Library's own record of what was deleted. It is separate from
  `FileOperationAudit`, which holds paths and is pruned on its own schedule.
- Creators, videos, files, jobs and deletion history carry a `platform`. Ids, folder names,
  paths and request ids are unique per platform, and every Twitch route names `TWITCH`, so an
  id from another platform finds nothing. `platform-isolation.integration.test.ts` proves this
  on PostgreSQL, because mocked queries cannot.
- Each platform has its own library root, from `libraryFor(platform)`. Every file operation
  takes the root from the file's own platform, and the path helpers have no default root. The
  worker stops at start if the roots it uses overlap, including through a link, and never
  follows a link on the way from a root to a file.
- Shared rows, cards and hooks live in `src/components/creators`. They take the API path, links
  and permissions from `CreatorPlatformProvider`, which has no default, so a page outside a
  section fails instead of showing another platform's data.
- Twitch settings live in `ArchiveSettings`, not `AppSettings`, because `GET /api/settings`
  returns that row to any signed-in user. The browser token is `enc:v1` and no API
  returns it.
