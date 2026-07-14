# Changelog

All notable changes to Helprr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-07-14

### Added

- An isolated development Docker stack with dedicated containers, database, Redis,
  volumes, network, secrets, and port `3051`, so `edge` and source builds can run
  beside stable without sharing production data.
- A separate unauthenticated `/api/ready` endpoint for bounded PostgreSQL, Redis, and
  exact migration-history readiness checks; `/api/health` remains liveness-only.
- Safe `scripts/setup-env.sh` and `scripts/backup.sh` helpers. The setup helper creates
  private, independent secrets without overwriting existing env files; the backup
  helper creates and validates private PostgreSQL custom-format snapshots without
  stopping containers.
- Admin update notices and downloadable, bounded support bundles with credential and
  token redaction.
- A maintained upstream compatibility baseline covering every supported service type
  and the exact versions exercised during release qualification.
- A complete no-clone release package: tagged releases now include Compose, the env
  template, setup helper, and backup helper from the exact tagged commit.

### Security

- Manual cleanup execution now requires a short-lived, single-use preview token bound
  to the authenticated user, cleanup type, configuration, and candidate snapshot.
  Queue/download candidates are revalidated immediately before deletion, and partial
  results are reconciled truthfully in cleanup history.
- Destructive media, album, torrent, and queue operations now share an operation-audit
  model that records actor, target, data/file disposition, and success or failure while
  preserving ownership validation for file-level actions.
- Startup rejects missing, malformed, placeholder, or shipped example credentials
  before polling, cleanup, logging timers, or other background services begin, with
  redacted variable-only errors.
- New local passwords require at least 15 Unicode characters across bootstrap, user
  creation, and resets. Password resets revoke the target user's active sessions, and
  role/capability changes take effect on the next request.
- Settings imports now have bounded hostile-input handling and stricter password-hash,
  prototype-shaped-key, member/global-scope, and auth-before-read coverage.
- Every mutating API handler is covered by a source-derived authorization-policy
  matrix, including dynamic, ownership-aware, self/session, admin, and public routes.
- Native amd64 and arm64 images are scanned with pinned Trivy before either digest can
  reach a release manifest. Fixable high/critical OS or library findings and EOL base
  images block publication; npm, npx, and Corepack are removed from the runtime image.

### Changed

- Expired sessions, operation audits, cleanup and settled-alert history, notification
  history, and orphaned image-cache generations now have bounded retention. Image
  cleanup fails closed when Redis state cannot be safely reconciled.
- CI now reconstructs the `1.0.0` database snapshot, seeds representative data, applies
  all current Prisma 6 migrations, and verifies preservation and the resulting schema.
- Stable and development Compose usage is documented as two standalone stacks; the
  development file must never be layered over the stable stack.
- No-clone install and update instructions use one latest or exact tagged asset set and
  take a validated backup before replacing deployment files or pulling an image.

### Fixed

- ARM64 Trivy scans now receive the native build-matrix platform instead of defaulting
  to amd64 when scanning an ARM64-only digest.
- Cleanup UI and history now preserve per-item partial failures instead of presenting a
  destructive run as wholly successful when upstream state changed or an item failed.

## [1.0.0] - 2026-07-13

### Added

- Lidarr album deletion (with an optional delete-files-from-disk checkbox) and
  per-track file deletion from the album page; track file deletion goes through
  the ownership-validated, audited endpoint.
- The installed version and commit are shown in Settings → Status.
- Test suite (`npm test`, vitest) covering capability resolution, file-ownership
  guards, cleanup queue pagination, and VAPID key resolution — runs in CI ahead
  of every image build.
- Version tags now draft a GitHub release with `docker-compose.yml` and
  `.env.example` attached, so installs can fetch the files matching their
  exact version.
- README operations guide: updating, backup (`pg_dump`) and restore
  (including fresh-host disaster recovery), uninstalling (with a
  `down -v` data-loss warning), and a plain-language list of every feature
  that can delete media files.
- GPL-3.0 license, security policy, changelog, and GitHub issue templates.
- iOS Shortcuts guide (`docs/ios-shortcuts.md`) covering the `/protocol`
  deep-link surface and share-sheet integration.
- CI workflow (lint + build on pushes and pull requests) and a Docker publish
  workflow: multi-arch (amd64/arm64) images on GHCR — `edge` from the
  development branch, semver + `stable` channel tags from release tags.

### Security

- Single episode/track file deletion now goes through the bulk routes, which
  validate that every file id belongs to the stated series/artist and write a
  file audit record; the unguarded `/api/sonarr/episodefile/[id]` and
  `/api/lidarr/trackfile/[id]` routes are removed. Lidarr file deletes are now
  audited (visible in Settings → File audit).
- Creating Sonarr/Radarr/Lidarr tags now requires the matching `*.editTags`
  capability; previously view-only users could create upstream tags.
- The cleanup queue cleaner now paginates past 1,000 items and skips an
  instance entirely (with a logged error) if its queue cannot be fetched
  completely — a truncated view silently exempted the tail from rules and
  strike handling.

### Fixed

- `.env.example` no longer sets `DATABASE_URL`/`REDIS_URL`: saved as `.env` for
  the Docker quick start, the old `localhost` values overrode compose's
  container wiring and made the app crash-loop with "Can't reach database
  server". Both are now commented out with Docker/local-dev guidance.
  (Caught by the fresh-install drill.)
- Interactive search, release grabs, download-client overrides, Add-page
  lookups, AniList mapping actions, and the Activity refresh now target the
  selected Sonarr/Radarr/Lidarr instance instead of always using the default.
- Graceful shutdown: the container previously ran node behind `sh -c`, so
  SIGTERM never reached the app and every update hard-killed it after
  Docker's grace period. The entrypoint now execs node as PID 1, and a
  shutdown coordinator stops polling/cleanup timers, drains in-flight cycles
  (bounded at 30s), flushes logs, and disconnects Prisma/Redis before exit.
  Compose sets `stop_grace_period: 45s`.

### Changed

- The VAPID public key is now runtime configuration served via an
  authenticated `GET /api/push/public-key` (canonical env name
  `VAPID_PUBLIC_KEY`; the old `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is still
  accepted). Web Push now works with the prebuilt image, and rotating keys no
  longer requires a rebuild.
- `docker-compose.yml` now pulls the published `ghcr.io/saibarathr/helprr`
  image (`HELPRR_VERSION`, default `stable`) instead of building from source.
  Building from source moved to `docker-compose.dev.yml`.
- `allowedDevOrigins` in `next.config.ts` is now read from the optional
  `ALLOWED_DEV_ORIGINS` env var (comma-separated) instead of being hardcoded.

### Removed

- `npm run start` — unsupported with the standalone output the production
  image uses; deploy with Docker (`node server.js` inside the image).
