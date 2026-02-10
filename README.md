# Helprr

Helprr is a self-hosted web dashboard (PWA) that connects to **Sonarr**, **Radarr**, and **qBittorrent**.
It polls those services on an interval and can send **Web Push** notifications for common events (downloads starting/completing/failing, health warnings, upcoming releases, etc.).

## Features

- Password-protected UI (single shared app password)
- Connect/configure Sonarr, Radarr, qBittorrent from Settings
- Dashboard + Activity feed + Calendar views
- Notifications inbox + per-device notification preferences
- PWA service worker (Serwist in production; lightweight push-only worker in development)

## Tech stack

- Next.js (App Router) on port **3050**
- Prisma + PostgreSQL
- Web Push (`web-push`) with VAPID keys

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or Docker)

## Environment variables

Copy `.env.example` to `.env.local` (for local dev), or set these in your deployment environment:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma |
| `APP_PASSWORD` | yes | Password used on the `/login` screen |
| `JWT_SECRET` | recommended | Signs the auth cookie (set this in production) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | Public VAPID key (enables push notifications; must be available at build time for Docker builds) |
| `VAPID_PRIVATE_KEY` | optional | Private VAPID key (server-side) |
| `VAPID_SUBJECT` | optional | VAPID subject, e.g. `mailto:you@example.com` |

If VAPID vars are not set, Helprr will still run, but **push notifications are disabled**.

## Local development

1) Install dependencies

```bash
npm ci
```

2) Start PostgreSQL (example using docker-compose)

```bash
docker compose up -d helprr-db
```

3) Configure `.env.local`

Example (adjust credentials/host to match your Postgres setup):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/helprr

APP_PASSWORD=change-me
JWT_SECRET=change-me-too

# Optional: enable push notifications
VAPID_SUBJECT=mailto:you@example.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

4) Initialize the database schema

```bash
npm run db:generate
npm run db:push
```

5) Run the dev server

```bash
npm run dev
```

Open http://localhost:3050

## Docker

The repository includes a `docker-compose.yml` with a Postgres container and the Helprr app.

1) Set environment variables (recommended via a local `.env` file that is not committed)

- `POSTGRES_PASSWORD` (optional override; defaults to `postgres`)
- `DATABASE_URL` (optional override; defaults to the internal compose URL)
- `APP_PASSWORD`
- `JWT_SECRET`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (build-time)
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

2) Build and run

```bash
docker compose up --build
```

Notes:

- The image build expects `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to be available as a build arg.
- The container entrypoint runs `npx prisma db push --skip-generate` before starting Next.js.

## Generating VAPID keys (for push notifications)

You can generate a VAPID keypair with:

```bash
npx web-push generate-vapid-keys
```

Use the **public** key as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the **private** key as `VAPID_PRIVATE_KEY`.

## Connecting Sonarr / Radarr / qBittorrent

In the app, go to **Settings** and set:

- Sonarr: base URL + API key
- Radarr: base URL + API key
- qBittorrent: base URL + password (stored as the connection `apiKey`) + optional username (defaults to `admin`)

Helprr’s polling service will skip any service that is not configured.

## Scripts

```bash
npm run dev
npm run build
npm run start

npm run db:generate
npm run db:push
npm run db:migrate

npm run lint
```

## Security notes

- Set strong values for `APP_PASSWORD` and `JWT_SECRET` in production.