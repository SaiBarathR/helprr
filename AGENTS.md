# Repository Guidelines

## Project Overview

Helprr is a self-hosted, mobile-first Next.js PWA for media discovery,
management, requests, torrents, cleanup, analytics, administration, and Web
Push. It integrates with Sonarr, Radarr, Lidarr, qBittorrent, Prowlarr,
Jellyfin, TMDB, AniList, and Seerr. iPhone PWA behavior is a primary target;
desktop is fully supported.

## Essential Commands

- `npm ci` — install exactly from `package-lock.json`.
- `npm run dev` — Turbopack development server on port `3050`.
- `npm run lint` — settings-export validation plus ESLint.
- `npm test` — Vitest suite.
- `npm run build` — standalone production build using webpack for Serwist.
- `npm run db:generate` — generate the Prisma client.
- `npm run db:migrate` — create/apply a migration using `.env.local`.
- `npm run db:deploy` — deploy committed migrations using `.env.local`.
- `npm run test:migrations` — upgrade released snapshots in the disposable
  PostgreSQL database named exactly `helprr_migration_test`.
- `./scripts/setup-env.sh [--dev]` — generate `.env` or `.env.dev` without
  overwriting an existing file or printing secrets.
- `./scripts/backup.sh --stable|--dev` — create and validate an online private
  PostgreSQL backup without restarting containers.

## Repository Map

- `src/app/(app)` — authenticated pages and layouts.
- `src/app/api` — service proxies and application API routes.
- `src/components` — reusable UI and feature components.
- `src/lib` — clients, auth, permissions, polling, cleanup, audit, cache,
  retention, logging, readiness, and shared logic.
- `src/instrumentation.ts` — startup validation and background-service boot.
- `src/middleware.ts` — session boundary, public routes, CSP, and headers.
- `prisma/schema.prisma`, `prisma/migrations`, `prisma/release-snapshots` —
  schema, append-only migration history, and released upgrade baselines.
- `public/` and `src/app/sw.ts` — PWA assets and service workers.
- `docs/` — tracked architecture, operations, compatibility, and user guides.
- `plans/` — intentionally gitignored local execution records.

## Architecture and Safety Boundaries

- API routes are the authoritative security boundary. Every mutating route must
  enforce authentication, role/capability, ownership, and target-instance rules;
  hidden UI controls are not authorization.
- Sonarr/Radarr/Lidarr are multi-instance. Preserve and validate `instanceId`
  from page state through the API route and selected service client.
- Permissions fail closed. Server auth reloads the current `Session` and `User`,
  so revocation, disablement, role changes, and capability changes apply on the
  next request.
- New/reset local passwords require 15 characters. Settings -> Users password
  changes revoke the target user's active sessions. The emergency
  `HELPRR_ADMIN_PASSWORD_RESET=true` bootstrap reset does not; revoke those
  sessions separately and remove the flag after one boot.
- Interactive queue/download cleanup requires a short-lived, single-use preview
  token bound to user, cleaner, config, scope, and candidates. Scheduled cleanup
  uses a separate trusted path. Revalidate upstream state before deletion and
  preserve truthful per-item outcomes.
- Destructive media, file, torrent, and queue operations use the unified
  operation audit. Audit writes are fail-soft but never replace authorization.
- `/api/health` is dependency-free liveness. `/api/ready` checks PostgreSQL,
  Redis, and exact migration state. Keep both unauthenticated and non-secret.
- Startup configuration validation must complete before polling, push, cleanup,
  or retention services start; errors must remain redacted.
- See `docs/architecture.md` for the detailed system design and invariants.

## Stable and Development Isolation

- Stable: `docker-compose.yml` + `.env`; containers `helprr`, `helprr-db`,
  `helprr-redis`; app port `3050`; stable-only network and volumes.
- Development: standalone `docker-compose.dev.yml` + `.env.dev`; containers
  `helprr-dev`, `helprr-dev-db`, `helprr-dev-redis`; app port `3051`; database
  `helprr_dev`; loopback PostgreSQL `5433` and Redis `6380`; `helprr-dev-*`
  network and volumes.
- Never layer the Compose files, share credentials/data volumes, point source or
  `edge` builds at stable data, or run a development migration against stable.
- Source stack: `docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build`.
- Published edge: set `HELPRR_DEV_IMAGE=ghcr.io/saibarathr/helprr:edge`, then
  use the same env/Compose scope with `pull helprr-dev` and
  `up -d --no-build --no-deps helprr-dev`.
- Never use an unscoped `docker compose down -v`. Stable data or deployment
  mutations require explicit action-time permission from the project owner.

## Implementation Conventions

- TypeScript is strict; keep API/shared contracts explicit and use `@/*` aliases.
- Follow file-local style and avoid unrelated refactors or formatting churn.
- Prefer existing service clients/helpers and native upstream contracts.
- Use PascalCase components, `useX` hooks, camelCase helpers, and kebab-case
  route segments.
- Prisma 6 with PostgreSQL is intentional. **Never upgrade to Prisma 7.**
- Every schema change uses Prisma Migrate and commits its generated migration.
  Never substitute `prisma db push` or edit a released migration.
- Preserve unrelated working-tree changes; never discard them with destructive
  Git commands.

## Testing Requirements

- Add focused `*.test.ts` / `*.test.tsx` coverage near the feature or under
  `src/**/__tests__`.
- Minimum code-change gate: `npm run lint`, `npm test`, `npm run build`, and
  `git diff --check`.
- Add `npx prisma validate` and `npm run test:migrations` for schema/release work.
- Validate both Compose files for Docker/runtime changes. Manually exercise the
  affected API/UI flow and relevant admin, restricted-member, ownership,
  partial-failure, and PWA/browser cases.
- CI must be green before merging. Docker publication builds native amd64/arm64
  images and blocks fixable high/critical Trivy findings.

## Git and Release Workflow

- `main` is stable/default. `development` is integration; successful pushes
  publish `ghcr.io/saibarathr/helprr:edge`.
- Normal work uses a focused branch and PR into `development`.
- Tagged releases build an exact version image and draft release assets. The
  qualified digest is backed up and smoke-tested before manual promotion moves
  minor, major, and `stable` aliases.
- Follow `docs/maintainer-development-release-workflow.md` for exact commands,
  qualification, rollback, promotion, and public asset verification.
- Never commit, push, create/merge a PR, tag, publish, promote, or deploy unless
  the project owner explicitly requests that exact action.

## General preferences
- If asked to do too much work at once, stop and state that clearly.
- If computer use is helpful for completing or verifying work, shell out to gpt-5.6 with Codex for it

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (cursor composer 2.5 in auto mode is near-free for me due to a deal), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model        | cost | intelligence | taste |
| -----        | ---- | ------------ | ----- |
| gpt-5.6      | 4    | 8            | 6     |
| sonnet-5     | 5    | 5            | 7     |
| opus-4.8     | 4    | 7            | 8     |
| fable-5      | 2    | 9            | 9     |
| composer-2.5 | 9    | 5            | 7     |
| grok-4.5     | 7    | 6            | 7     |

How to apply:
- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): gpt-5.6 – it's effectively free.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7.
- Reviews of plans/implementations: fable-5 or opus-4.8 or gpt-5.6, optionally composer-2.5 as an extra independent perspective.
- Never use Haiku.
- Mechanics: gpt-5.6 is only reachable through the Codex CLI – `codex exec` / `codex review` (my `~/.codex/config.toml` defaults to gpt-5.6). Use the codex-implementation, codex-review, and codex-computer-use skills; for work they don't cover (investigation, data analysis), run `codex exec -s read-only` directly with a self-contained prompt.
- Claude models (sonnet-5, opus-4.8, fable-5) run via the Agent/Workflow model parameter.
- Cursor workflows: Can be executed via the Cursor CLI using `cursor-agent --model composer-2.5 "your prompt here"` for composer-2.5 or `cursor-agent --model grok-4.5 "your prompt here"` for grok-4.5.

## Documentation Map

- `docs/architecture.md` — system architecture and non-obvious invariants.
- `docs/maintainer-development-release-workflow.md` — development and release runbook.
- `docs/upstream-compatibility.md` — qualified upstream versions/contracts.
- `docs/ios-shortcuts.md` — iOS Shortcut integration.
- `README.md` — user-facing features, installation, update, backup, and restore.
