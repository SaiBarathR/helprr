# Helprr

Helprr is the dashboard I wanted for my own media server: one place to see what is downloading, what is available, what needs attention, and what I might want to watch next. It is a self-hosted, mobile-first Progressive Web App (PWA) that sits on top of the *arr stack, qBittorrent, Jellyfin, Prowlarr, and a few discovery/request services.

I built it because I wanted an iPhone-friendly way to manage my setup and receive proper push notifications, without paying for another subscription. I have used the iPhone PWA from the first day I created this repository, and I test every feature in the real setup before I call it done. Desktop is not an afterthought either—the larger layout is where the configurable dashboard, analytics, and admin tools are most useful.

> [!WARNING] This entire project was built with AI-assisted development—mainly Codex, Claude/Opus, and Gemini. I have tested the features I use and keep using the app every day, but this is still a personal self-hosted project. It is not affiliated with, endorsed by, or a replacement for any service it connects to.



## What to expect

Helprr is not trying to clone every setting from Sonarr, Radarr, Lidarr, qBittorrent, or Jellyfin. I have added the parts I actually need for day-to-day use and kept the rest in the original services. What you see in the app depends on which services you connect and what permissions the signed-in user has.

### Dashboard and personalization

- Separate mobile and desktop layouts, draggable widgets, and saved dashboard layouts.
- Widgets for the things I want at a glance: library counts, activity, calendar, active downloads, storage, service health, Prowlarr, Jellyfin, Seerr, cleanup, recommendations, insights, watchlists, library gaps, and shortcuts.
- Per-user layout customization, plus shared layouts for administrators.
- Theme, navigation order/visibility, carousel, refresh, timezone, and discovery-layout preferences.
- Global command palette/search (`⌘K` / `Ctrl+K`) when clicking through the sidebar is slower than just searching.



### Media, discovery, and requests

- Browse, search, filter, sort, add, monitor, tag, edit, and manage movies, TV series, music artists/albums, and files.
- TMDb discovery with the rails I use most, plus collections, people, credits, region/language controls, and filters.
- AniList anime and manga discovery, schedules, people/studio pages, library tracking, and Sonarr/Radarr mappings (including auto-mapping).
- Watchlists, scheduled reminders, calendar views, a random-watch picker, and library-gap views for when I do not know what to watch.
- Seerr request visibility and workflow when Seerr is part of the setup.



### Operations and server control

- Activity queue/history, wanted/missing/cutoff views, manual import, and queue actions.
- qBittorrent details/files, add/start/stop/delete actions, speed limits, alternative limits, and time-windowed bandwidth schedules.
- Rule-based queue, download, and seeding cleanup with dry runs, automation, strikes, and history.
- Prowlarr indexer status, testing, syncing, statistics, and history.
- Jellyfin library and playback views, active sessions/devices, watch-state actions, server tasks/control, and playback analytics.
- Insights pages for checking library growth, downloads, storage, media analysis, and viewing habits without digging through several separate apps.



### Alerts, users, and administration

- Installable PWA with Web Push, device preferences, inbox/history, test notifications, digest events, and per-event controls.
- Per-user accounts, admin/member roles, granular capability overrides, and active-session revocation.
- Multiple Sonarr, Radarr, and Lidarr instances; service health checks; custom HTTP headers for supported integrations behind an authenticating proxy.
- Backup/restore, file-operation audit records, log retention, and server-log inspection for the moments when something needs fixing.



## Integrations

All integrations are optional and configured in **Settings → Instances**. Features that depend on an integration stay unavailable until it is connected.


| Integration | What Helprr uses it for                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| Sonarr      | TV library, monitoring, queue/activity, discovery additions, file and episode actions |
| Radarr      | Movie library, monitoring, queue/activity, discovery additions, file actions          |
| Lidarr      | Music library, artist/album actions, monitoring, files                                |
| qBittorrent | Torrents, transfer state, file priorities, limits, cleanup, bandwidth schedules       |
| Prowlarr    | Indexers, history, tests, sync, and reliability stats                                 |
| Jellyfin    | Library/watch status, sessions/devices, playback analytics, server control            |
| TMDb        | Movie/TV discovery, metadata, collections, people, and artwork                        |
| AniList     | Anime/manga discovery, schedules, library tracking, and mappings                      |
| Seerr       | Requests and request workflow                                                         |




## Current interface

These are the hand-picked captures from my current setup. They are not mockups—the gallery shows the actual desktop and iPhone PWA experience I use for monitoring, discovery, planning, administration, and cleanup.

### Desktop

<p align="center">
  <img src="docs/screenshots/desktop-dashboard.jpg" alt="Helprr desktop dashboard with media, download, cleanup, service-health, Jellyfin, and scheduled-task widgets" width="49%" />
  <img src="docs/screenshots/desktop-discover.jpg" alt="Helprr desktop Discover page with search, trending rails, and movie status" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-movie-details.jpg" alt="Helprr desktop movie detail page with metadata, cast, crew, and Radarr actions" width="49%" />
  <img src="docs/screenshots/desktop-command-palette.jpg" alt="Helprr desktop global command palette with library and remote discovery search scopes" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-tmdb-search.jpg" alt="Helprr desktop TMDb search results from the command palette" width="49%" />
  <img src="docs/screenshots/desktop-anime.jpg" alt="Helprr desktop Anime page with a featured title, watch progress, and planning rails" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-anime-schedule.jpg" alt="Helprr desktop Anime schedule with upcoming episodes and reminder controls" width="49%" />
  <img src="docs/screenshots/desktop-calendar-agenda.jpg" alt="Helprr desktop Calendar agenda showing scheduled episode and media releases" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-calendar-month.jpg" alt="Helprr desktop month calendar with release details and notification actions" width="49%" />
  <img src="docs/screenshots/desktop-settings.jpg" alt="Helprr desktop settings hub with instance, user, preference, service, storage, and backup controls" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-cleanup.jpg" alt="Helprr desktop cleanup dashboard with automated queue and download cleanup controls" width="49%" />
</p>












### iPhone PWA

<p align="center">
  <img src="docs/screenshots/mobile-dashboard.jpg" alt="Helprr iPhone dashboard with library, downloads, indexers, cleanup, and streaming widgets" width="31%" />
  <img src="docs/screenshots/mobile-anime-search.jpg" alt="Helprr iPhone AniList search results" width="31%" />
  <img src="docs/screenshots/mobile-discover.jpg" alt="Helprr iPhone Discover page with trending movies and theater releases" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-movie-details.jpg" alt="Helprr iPhone movie detail page with metadata and Radarr action" width="31%" />
  <img src="docs/screenshots/mobile-anime.jpg" alt="Helprr iPhone Anime page with featured content and watch rails" width="31%" />
  <img src="docs/screenshots/mobile-anime-schedule.jpg" alt="Helprr iPhone Anime schedule with upcoming releases and reminders" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-random-watch.jpg" alt="Helprr iPhone random watch suggestion with movie details and open action" width="31%" />
  <img src="docs/screenshots/mobile-insights-analysis.jpg" alt="Helprr iPhone Insights technical media analysis" width="31%" />
  <img src="docs/screenshots/mobile-settings.jpg" alt="Helprr iPhone settings hub with instance, user, notification, storage, logging, and download controls" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-notification-history.jpg" alt="Helprr iPhone notification history with daily summaries and health warnings" width="31%" />
  <img src="docs/screenshots/mobile-cleanup.jpg" alt="Helprr iPhone cleanup dashboard with automated and manual cleanup controls" width="31%" />
  <img src="docs/screenshots/mobile-calendar-week.jpg" alt="Helprr iPhone Calendar week view with upcoming releases" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-calendar-month.jpg" alt="Helprr iPhone Calendar month view with release counts and daily agenda" width="31%" />
</p>










### Video demos

I recorded two short walkthroughs from the real app so you can get a better feel for it before setting anything up.

#### Desktop walkthrough

This covers the dashboard, Calendar, Discover, notifications, and the settings/admin side of the app.

https://github.com/user-attachments/assets/2969a145-719e-453a-a1e1-112cd0dd60c0

#### iPhone PWA walkthrough

This shows the installable mobile experience, day-to-day browsing, and the push-notification flow.

https://github.com/user-attachments/assets/7fa980fd-0dc6-48a8-91c1-cd35453571fd

## Quick start with Docker (recommended)

Docker Compose starts Helprr, PostgreSQL 16, and password-protected Redis 7. It creates named volumes for database, Redis, and log data; waits for database/Redis health; runs pending Prisma migrations before Helprr starts; and exposes Helprr on port **3050**.

### 1. Download the deployment files

No clone, no build — Helprr ships as a prebuilt multi-arch image
(amd64/arm64) on `ghcr.io/saibarathr/helprr`. You only need two files:

```bash
mkdir helprr && cd helprr
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/SaiBarathR/helprr/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/SaiBarathR/helprr/main/.env.example
```

### 2. Configure

Generate a JWT secret, then edit `.env`:

```bash
openssl rand -base64 48
```

Before the first start, set at least:

```dotenv
POSTGRES_PASSWORD=use-a-long-unique-password
REDIS_PASSWORD=use-a-different-long-unique-password
APP_PASSWORD=choose-the-first-admin-password
JWT_SECRET=paste-the-32-or-more-character-value-generated-above
TZ=Etc/UTC
```

`APP_PASSWORD` creates the bootstrap administrator on first boot. Its username is `admin` by default, or the value of `HELPRR_ADMIN_USERNAME`. Changing `APP_PASSWORD` later does **not** change an existing user's password.

For push notifications, also set the Web Push keys — they are runtime
configuration, no rebuild needed (generate a pair with
`npx web-push generate-vapid-keys`):

```dotenv
VAPID_SUBJECT=mailto:you@example.com
VAPID_PUBLIC_KEY=generated-public-key
VAPID_PRIVATE_KEY=generated-private-key
```

### 3. Start

The compose file uses the `edge` channel (latest development build) until the
first stable release; pin a specific version with `HELPRR_VERSION` in `.env`.

```bash
docker compose pull
docker compose up -d
docker compose ps
```

To build from source instead (developer flow — requires cloning this repo):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Open `http://YOUR_SERVER:3050`, sign in with the bootstrap account, then connect services in **Settings → Instances**.

Use `docker compose logs -f helprr` to follow startup. The application health endpoint is `GET /api/health`.

### Production notes

- Docker itself does not provide TLS. Put Helprr behind an HTTPS reverse proxy before relying on PWA installation or Web Push from a non-localhost address.
- Set `TRUST_FORWARDED_PROTO=true` only when that proxy strips and sets forwarded headers itself. This enables correct secure-cookie and client-IP decisions.
- Set `APP_ORIGIN=https://helprr.example.com` when enabling AniList OAuth in production. It must be a valid HTTPS origin.
- If the PostgreSQL password contains URL-reserved characters (`@`, `:`, `/`, `?`, `#`, …), set `DATABASE_URL` explicitly with the password percent-encoded.
- The VAPID keys are runtime configuration: after adding or rotating them, `docker compose up -d` is enough — no rebuild. Already-subscribed devices re-subscribe automatically on their next endpoint rotation, or manually from **Settings → Notifications**.



## Local development

Use Node.js **24** to match the Docker image, plus Docker Compose for the local PostgreSQL and Redis services.

1. Create Compose configuration and start only the data services. Compose reads the project-level `.env`, not `.env.local`.
  ```bash
   cp .env.example .env
   # Set POSTGRES_PASSWORD and REDIS_PASSWORD in .env first
   docker compose up -d helprr-db helprr-redis
  ```
2. Create `.env.local` for the Node process. Use host addresses—not Compose service names—and URL-encode the PostgreSQL password if needed.
  ```dotenv
   DATABASE_URL=postgresql://postgres:YOUR_ENCODED_POSTGRES_PASSWORD@localhost:5432/helprr
   REDIS_URL=redis://localhost:6379
   REDIS_PASSWORD=YOUR_REDIS_PASSWORD
   APP_PASSWORD=YOUR_BOOTSTRAP_ADMIN_PASSWORD
   JWT_SECRET=YOUR_32_OR_MORE_CHARACTER_SECRET
   TZ=Etc/UTC
  ```
3. Install dependencies, initialize Prisma, and run the app.
  ```bash
   npm ci
   npm run db:generate
   npm run db:deploy
   npm run dev
  ```

Open [http://localhost:3050](http://localhost:3050). Use `npm run db:migrate` only when you are authoring a new Prisma migration; it is not the normal first-run command.

## Environment reference

Copy `.env.example` as a starting point. Never commit `.env`, `.env.local`, API keys, passwords, VAPID private keys, or backups containing credentials.

### Required for a usable installation


| Variable            | Docker Compose / local                           | Purpose and guidance                                                                                                                                                         |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Required by Compose; not used by a Node-only app | Password for the bundled PostgreSQL container. It is used to form Compose's default `DATABASE_URL`.                                                                          |
| `DATABASE_URL`      | Required by the app                              | PostgreSQL Prisma connection string. In Compose it is optional if the bundled default is suitable; explicitly set it for an external database or a percent-encoded password. |
| `REDIS_URL`         | Required by the app                              | Redis connection URL. Use `redis://helprr-redis:6379` inside Compose and `redis://localhost:6379` for a host-run Node process.                                               |
| `REDIS_PASSWORD`    | Required by the app and Compose                  | Redis AUTH password. Compose starts Redis with this password.                                                                                                                |
| `APP_PASSWORD`      | Needed to create/recover the bootstrap admin     | Seeds the bootstrap admin only. It is never used as the normal live login password after that account has a stored hash.                                                     |
| `JWT_SECRET`        | Required by the app                              | Session-signing secret; must be at least 32 characters. Generate with `openssl rand -base64 48`.                                                                             |




### Accounts, deployment, and optional feature gates


| Variable                      | Default                                     | When to use it                                                                                                                                                 |
| ----------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HELPRR_ADMIN_USERNAME`       | `admin`                                     | Changes the bootstrap admin's username.                                                                                                                        |
| `HELPRR_ADMIN_PASSWORD_RESET` | off                                         | Set to `true` for one restart to reset the bootstrap admin from `APP_PASSWORD`; remove it immediately after recovery. It does not revoke existing sessions.    |
| `TZ`                          | `UTC` when invalid or absent                | IANA timezone used for application date/time behavior, for example `Asia/Kolkata`.                                                                             |
| `LOG_DIR`                     | app `logs` directory; `/app/logs` in Docker | Location for server logs. Compose persists its default through the `helprr-logs` volume.                                                                       |
| `APP_ORIGIN`                  | none                                        | Required for AniList OAuth in production. Use the public HTTPS origin, such as `https://helprr.example.com`.                                                   |
| `TRUST_FORWARDED_PROTO`       | off                                         | Set to `true` only behind a trusted proxy that sanitizes `X-Forwarded-*`; enables secure cookies and forwarded client-IP rate limiting.                        |
| `HELPRR_CUSTOM_HEADERS`       | off                                         | Set to `true` to expose per-connection custom HTTP headers for supported services behind an authenticating proxy (for example, Authelia or Cloudflare Access). |
| `EXTRA_ALLOWED_IMAGE_HOSTS`   | none                                        | Comma-separated trusted external image hosts to permit through the image proxy. Do not add private/internal hosts.                                             |




### Web Push (all three values are needed)


| Variable                       | Purpose                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `VAPID_SUBJECT`                | Contact URI supplied to push providers, for example `mailto:you@example.com`.                 |
| `VAPID_PUBLIC_KEY`             | Public VAPID key served to browsers at runtime (the old `NEXT_PUBLIC_VAPID_PUBLIC_KEY` name is still accepted). |
| `VAPID_PRIVATE_KEY`            | Server-only VAPID private key. Keep it secret.                                                |


Generate a pair with:

```bash
npx web-push generate-vapid-keys
```

Without a complete VAPID set, Helprr still runs but push notification subscription/delivery is unavailable.

### Cache and image tuning

All values below are optional positive integers; invalid or non-positive values fall back to the defaults.


| Variable                          | Default                   | Scenario                                                                                                    |
| --------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `IMAGE_CACHE_DIR`                 | `/tmp/helprr-image-cache` | Directory for server-side cached image bytes. Choose a writable, persistent path only if you provision one. |
| `IMAGE_CACHE_TTL_SECONDS`         | `604800` (7 days)         | How long a successful image is considered fresh.                                                            |
| `IMAGE_CACHE_STALE_SECONDS`       | `2592000` (30 days)       | How long a stale cached image may be served when its upstream fails.                                        |
| `IMAGE_UPSTREAM_FETCH_TIMEOUT_MS` | `5000`                    | Timeout for fetching an upstream image.                                                                     |
| `TMDB_CACHE_DEFAULT_TTL_SECONDS`  | `600` (10 minutes)        | Default TTL for TMDb data without a more specific category.                                                 |
| `TMDB_CACHE_DISCOVER_TTL_SECONDS` | `600` (10 minutes)        | TTL for TMDb discovery responses.                                                                           |
| `TMDB_CACHE_DETAILS_TTL_SECONDS`  | `86400` (1 day)           | TTL for TMDb title/detail responses.                                                                        |
| `TMDB_CACHE_STATIC_TTL_SECONDS`   | `604800` (7 days)         | TTL for TMDb static/reference data.                                                                         |
| `TMDB_CACHE_STALE_SECONDS`        | `2592000` (30 days)       | Stale-if-error window for TMDb cache data.                                                                  |
| `CACHE_LOCK_TTL_MS`               | `10000`                   | Cache-fill lock duration; change only when diagnosing unusually slow or long-running upstream requests.     |


The bundled Compose file now passes these advanced values through when they are set in `.env`. The default image-cache directory is inside the app container, so it is ephemeral if that container is recreated unless you add your own persistent mount.

## First-run checklist

1. Sign in with the bootstrap administrator.
2. Open **Settings → Instances** and connect the services you actually use. Test each connection before relying on it.
3. In **Settings → Users**, create member accounts and grant only the capabilities they need.
4. Configure preferences, dashboard layout, notifications, and optional cleanup/bandwidth rules.
5. For push: serve the app over HTTPS, configure VAPID values, open Helprr on the target device, install it as a PWA if desired, and allow notifications.
6. Export a backup from **Settings → Backup & Restore** after the initial configuration and keep it secure.



## Database migrations and upgrades

Prisma migrations are the database source of truth.

- For normal deployment and first setup, use `npm run db:deploy`; the Docker entrypoint runs the same `prisma migrate deploy` command automatically before starting Next.js.
- When changing `prisma/schema.prisma` during development, run `npm run db:migrate` and commit the generated migration directory.
- A database created by an older `prisma db push` workflow with no migration history must be baselined once before Docker can start it:
  ```bash
  docker compose run --rm helprr npx prisma migrate resolve --applied 0001_init
  docker compose up -d
  ```



## Useful commands

```bash
# App
npm run dev
npm run build
npm run lint

# Prisma
npm run db:generate
npm run db:deploy
npm run db:migrate

# Docker (published image)
docker compose pull
docker compose up -d
docker compose logs -f helprr
docker compose down

# Docker (build from source)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```



## Security notes

- Use unique, long secrets and a private network or HTTPS reverse proxy. Do not expose Helprr directly to the public internet without understanding the security implications.
- Passwords are stored as per-user scrypt hashes. `APP_PASSWORD` seeds/resets only the bootstrap admin; it is not a universal login password.
- Resetting the bootstrap password does not invalidate active sessions. Revoke sessions from **Settings → Sessions** when access needs to be removed.
- Service credentials and custom headers are sensitive. Restrict administrator accounts and protect backups/log exports.
- Verify AI-generated changes before deploying them. Keep your service containers and this project up to date, and test upgrades against a backup.
- Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).



## License

Helprr is free software, licensed under the [GNU General Public License v3.0](LICENSE).
Release history lives in [CHANGELOG.md](CHANGELOG.md).
