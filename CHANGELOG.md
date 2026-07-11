# Changelog

All notable changes to Helprr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GPL-3.0 license, security policy, changelog, and GitHub issue templates in
  preparation for the first stable release.
- iOS Shortcuts guide (`docs/ios-shortcuts.md`) covering the `/protocol`
  deep-link surface and share-sheet integration.

- CI workflow (lint + build on pushes and pull requests) and a Docker publish
  workflow: multi-arch (amd64/arm64) images on GHCR — `edge` from the
  development branch, semver + `stable` channel tags from release tags.

### Changed

- `docker-compose.yml` now pulls the published `ghcr.io/saibarathr/helprr`
  image (`HELPRR_VERSION`, default `edge`) instead of building from source.
  Building from source moved to `docker-compose.dev.yml` and is currently still
  required for Web Push (build-time VAPID key).
- `allowedDevOrigins` in `next.config.ts` is now read from the optional
  `ALLOWED_DEV_ORIGINS` env var (comma-separated) instead of being hardcoded.

### Removed

- `npm run start` — unsupported with the standalone output the production
  image uses; deploy with Docker (`node server.js` inside the image).
