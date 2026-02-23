# Helprr

Entire site was built using Claude code with Opus and Gemini. Using it daily, I haven’t found any issues in functionality so far, but I’ll update the README if I come across any bugs that I’m unable to fix. The UI is mobile-first, as I needed an Iphone app to control radarr, sonarr and qbittorrent with push notifications. I have only added features which I wanted to use myself to use from mobile, not all the options and features present in arr stack and qbittorrent is added.

Helprr is a self-hosted web dashboard (PWA) that connects to **Sonarr**, **Radarr**, and **qBittorrent**.
It polls those services on an interval and can send **Web Push** notifications for common events (downloads starting/completing/failing, health warnings, upcoming releases, etc.).

<details>
<summary>📱 App Screenshots</summary>
<div style="display:flex; overflow-x:auto; gap:10px;">
<img src="https://github.com/user-attachments/assets/4a0a2686-cd36-4772-9e4b-f1ca7e0b0ca1"  width="200"/>
<img src="https://github.com/user-attachments/assets/9ec671c7-1b9c-4592-afba-c2425e28144f" width="200"/>
<img src="https://github.com/user-attachments/assets/36f9f800-87c1-4e37-8b44-fc3642338629" width="200"/>
  <img width="200"  alt="image" src="https://github.com/user-attachments/assets/f6d7ebc2-76c9-4b8e-85e4-74e7080b87cb" />
  <img width="200" alt="image" src="https://github.com/user-attachments/assets/0678d9cc-9384-4858-8925-a69b85cbd006" />
<img width="200"  alt="image" src="https://github.com/user-attachments/assets/f72210f5-f5d4-4846-8098-fa04c7a84fd0" />
<img src="https://github.com/user-attachments/assets/921c6184-afb6-453b-9896-83cf67551fb6" width="200"/>
<img src="https://github.com/user-attachments/assets/778f2e34-efb0-4119-b9b9-a14b3b5e4bcc"  width="200"/>
<img width="200"  alt="image" src="https://github.com/user-attachments/assets/333fcc8d-4ace-46d4-a17d-e299fc9cfc42" />
<img width="200" alt="image" src="https://github.com/user-attachments/assets/1c938422-9ca6-4d76-a145-bcab9ee93384" />
<img src="https://github.com/user-attachments/assets/4a89a06d-8fdf-4001-b4d1-a58effc73922" width="200"/>
<img width="200" alt="image" src="https://github.com/user-attachments/assets/df8a3500-f6ad-417d-b32b-bee9df630d0b" />

</div>
</details>

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
- Redis 7+ (or Docker)

## Environment variables

Copy `.env.example` to `.env.local` (for local dev), or set these in your deployment environment:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma |
| `REDIS_URL` | yes | Redis connection string used for login rate limiting |
| `APP_PASSWORD` | yes | Password used on the `/login` screen |
| `JWT_SECRET` | recommended | Signs the auth cookie (set this in production) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | optional | Public VAPID key (enables push notifications; must be available at build time for Docker builds) |
| `VAPID_PRIVATE_KEY` | optional | Private VAPID key (server-side) |
| `VAPID_SUBJECT` | optional | VAPID subject, e.g. `mailto:you@example.com` |
| `TZ` | optional | Timezone for displaying dates/times (defaults to UTC) |

If VAPID vars are not set, Helprr will still run, but **push notifications are disabled**.

## Local development

1) Install dependencies

```bash
npm ci
```

2) Start PostgreSQL and Redis (example using docker-compose)

```bash
docker compose up -d helprr-db helprr-redis
```

3) Configure `.env.local`

Example (adjust credentials/host to match your Postgres setup):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/helprr
REDIS_URL=redis://localhost:6379

APP_PASSWORD=change-me
JWT_SECRET=change-me-too
TZ=Asia/Kolkata

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
- `REDIS_URL` (optional override; defaults to `redis://helprr-redis:6379`)
- `APP_PASSWORD`
- `TZ` (optional override; defaults to `UTC`)
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
