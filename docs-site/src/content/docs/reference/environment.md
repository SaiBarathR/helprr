---
title: Environment variables
description: Every setting Helprr reads from .env.
---

Copy `.env.example` as a starting point. Never commit `.env`, `.env.local`, API keys, passwords, VAPID private keys, or backups containing credentials.

At startup, Helprr validates the required PostgreSQL, Redis, and session-signing
configuration before any polling or cleanup work begins. Missing, malformed, or
shipped example/change-me credentials stop startup with one redacted error that
names the affected variables without printing their values. `APP_PASSWORD` is
also checked when supplied, but remains optional after the bootstrap admin has a
stored password unless `HELPRR_ADMIN_PASSWORD_RESET=true`.

## Required for a usable installation

| Variable            | Docker Compose / local                           | Purpose and guidance                                                                                                                                                         |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Compose; made by `helprr-init` when empty; not used by a Node-only app | Password for the bundled PostgreSQL container, used to form the default `DATABASE_URL`. PostgreSQL reads it only when it creates the database, so never change or remove it afterwards. |
| `DATABASE_URL`      | Required by the app                              | PostgreSQL Prisma connection string. In Compose it is optional if the bundled default is suitable; explicitly set it for an external database or a percent-encoded password. |
| `REDIS_URL`         | Required by the app                              | Redis connection URL. Use `redis://helprr-redis:6379` inside Compose and `redis://localhost:6380` for a host-run Node process on the isolated development stack.             |
| `REDIS_PASSWORD`    | Required by the app; made by `helprr-init` when empty | Redis AUTH password. Compose starts Redis with this password.                                                                                                                |
| `APP_PASSWORD`      | Optional                                         | Seeds the bootstrap admin only. Without it, the first admin is created in the browser at `/setup`. It is never used as the normal live login password after that account has a stored hash. |
| `JWT_SECRET`        | Required by the app; made by `helprr-init` when empty | Session-signing secret that also encrypts stored service tokens; must be at least 32 characters. With the bundled Compose file, leaving it empty makes `helprr-init` generate one once, in the `helprr-secrets` volume. Generate your own with `openssl rand -base64 48`. |

## Accounts, deployment, and optional feature gates

| Variable                      | Default                                     | When to use it                                                                                                                                                 |
| ----------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HELPRR_ADMIN_USERNAME`       | `admin`                                     | Changes the bootstrap admin's username.                                                                                                                        |
| `HELPRR_ADMIN_PASSWORD_RESET` | off                                         | Set to `true` for one restart to reset the bootstrap admin from `APP_PASSWORD`; remove it immediately after recovery. It also signs the admin out everywhere and turns off their two-step sign-in. |
| `TZ`                          | `UTC` when invalid or absent                | IANA timezone used for application date/time behavior, for example `Asia/Kolkata`.                                                                             |
| `LOG_DIR`                     | app `logs` directory; `/app/logs` in Docker | Location for server logs. Compose persists its default through the `helprr-logs` volume.                                                                       |
| `BACKUP_DIR`                  | `/app/backups`                              | Where [backups made in Helprr](/helprr/maintain/backup/#back-up-from-helprr) are written. Compose mounts the `helprr-backups` volume there. In Docker it must be a mount, or Helprr makes no backup. |
| `APP_ORIGIN`                  | none                                        | Required for AniList OAuth in production. Use the public HTTPS origin, such as `https://helprr.example.com`.                                                   |
| `ARR_CALLBACK_ORIGIN`         | `APP_ORIGIN`                                | Where Sonarr and Radarr can reach Helprr when Add Torrent sends them a `.torrent` file: they fetch it once, from a link that works for two minutes. Plain `http` on your network is fine, such as `http://helprr.lan:3050` (with your `HELPRR_PORT`). Magnet links need neither. |
| `TRUST_FORWARDED_PROTO`       | off                                         | Set to `true` only behind a trusted proxy that replaces the `X-Forwarded-*` headers a visitor sends; enables secure cookies and forwarded client-IP rate limiting. Tailscale Serve and Caddy do; Cloudflare Tunnel and Nginx Proxy Manager do not (see [HTTPS](/helprr/https/)).                        |
| `TRUSTED_PROXY_HOPS`          | 1                                           | With `TRUST_FORWARDED_PROTO`: how many proxies in a row add to `X-Forwarded-For` in front of Helprr. Helprr takes the visitor's address that many entries from the end, so an address a visitor sends is never used. Set `2` for two in a row, such as Cloudflare Tunnel then Nginx Proxy Manager. |
| `HELPRR_CUSTOM_HEADERS`       | off                                         | Set to `true` to expose per-connection custom HTTP headers for supported services behind an authenticating proxy (for example, Authelia or Cloudflare Access). A `Host` header is not accepted. |
| `EXTRA_ALLOWED_IMAGE_HOSTS`   | none                                        | Comma-separated trusted external image hosts to permit through the image proxy. Do not add private/internal hosts.                                             |

## Web Push (all three values are needed)

| Variable                       | Purpose                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `VAPID_SUBJECT`                | Contact URI supplied to push providers, for example `mailto:you@example.com`.                 |
| `VAPID_PUBLIC_KEY`             | Public VAPID key served to browsers at runtime (the old `NEXT_PUBLIC_VAPID_PUBLIC_KEY` name is still accepted). |
| `VAPID_PRIVATE_KEY`            | Server-only VAPID private key. Keep it secret.                                                |

Generate a pair with:

```bash
npx web-push generate-vapid-keys
```

With the bundled Compose file and no VAPID values in `.env`, `helprr-init` generates the keys once, and the subject defaults to `APP_ORIGIN` or the project's page. Set all three to use your own. Without any keys (an older Compose file), Helprr still runs but push notifications are not delivered.

## Cache and image tuning

See [Cache and images](/helprr/reference/cache/).
