# Changelog

All notable changes to Helprr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Lidarr album deletion (with an optional delete-files-from-disk checkbox) and
  per-track file deletion from the album page; track file deletion goes through
  the ownership-validated, audited endpoint.
- The installed version and commit are shown in Settings → Status.
- Test suite (`npm test`, vitest) covering capability resolution, file-ownership
  guards, cleanup queue pagination, and VAPID key resolution — runs in CI ahead
  of every image build.
- GPL-3.0 license, security policy, changelog, and GitHub issue templates in
  preparation for the first stable release.
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
  image (`HELPRR_VERSION`, default `edge`) instead of building from source.
  Building from source moved to `docker-compose.dev.yml`.
- `allowedDevOrigins` in `next.config.ts` is now read from the optional
  `ALLOWED_DEV_ORIGINS` env var (comma-separated) instead of being hardcoded.

### Removed

- `npm run start` — unsupported with the standalone output the production
  image uses; deploy with Docker (`node server.js` inside the image).
