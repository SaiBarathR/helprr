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

### Changed

- `allowedDevOrigins` in `next.config.ts` is now read from the optional
  `ALLOWED_DEV_ORIGINS` env var (comma-separated) instead of being hardcoded.
