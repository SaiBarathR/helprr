---
title: Step by step
description: Install Helprr by hand, choosing each setting yourself.
---

These steps do the same as [the installer](/helprr/install/one-command/), by hand.
Helprr ships as a prebuilt image for amd64 and arm64 on `ghcr.io/saibarathr/helprr`:
no clone, no build.

## 1. Download the files

Each release carries the five files needed to install, configure, update and back up
Helprr:

```bash
mkdir -p helprr/scripts && cd helprr
HELPRR_ASSET_BASE=https://github.com/SaiBarathR/helprr/releases/latest/download
curl -fsSL -o docker-compose.yml "$HELPRR_ASSET_BASE/docker-compose.yml"
curl -fsSL -o .env.example "$HELPRR_ASSET_BASE/env.example"
curl -fsSL -o scripts/setup-env.sh "$HELPRR_ASSET_BASE/setup-env.sh"
curl -fsSL -o scripts/backup.sh "$HELPRR_ASSET_BASE/backup.sh"
curl -fsSL -o scripts/update.sh "$HELPRR_ASSET_BASE/update.sh"
chmod 700 scripts/setup-env.sh scripts/backup.sh scripts/update.sh
```

For an exact release, use
`HELPRR_ASSET_BASE=https://github.com/SaiBarathR/helprr/releases/download/vX.Y.Z`
instead, then set `HELPRR_VERSION=X.Y.Z` in `.env` once it exists. Keep the Compose
file and the scripts from the same release.

## 2. Make `.env`

```bash
./scripts/setup-env.sh
```

It writes `.env` with new secrets (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
`JWT_SECRET`), mode `0600`. It never prints a secret, and never overwrites an existing
`.env`. It also:

- sets `TZ` to this computer's timezone (`Etc/UTC` when it cannot tell), and says where
  it found it;
- for the optional [Twitch](/helprr/twitch/) and [YouTube](/helprr/youtube/) archiving,
  sets `TWITCH_PUID`, `TWITCH_PGID` and, when the host has a `render` group,
  `TWITCH_RENDER_GID`, and makes the default `twitch-library` folder, owned by that
  user;
- warns when Docker Compose is missing or too old, or port 3050 is taken.

It leaves `APP_PASSWORD` empty, so you create the admin in the browser. For a scripted
install, run `./scripts/setup-env.sh --admin-password` instead: it also generates
`APP_PASSWORD`, which creates the admin at the first start, and prints the command that
shows it.

Push keys are made by Helprr on the first start. To use your own, see
[Phone and push](/helprr/phone-and-push/#use-your-own-push-keys). Every other setting is
in the [environment reference](/helprr/reference/environment/).

## 3. Start

```bash
docker compose pull
docker compose up -d
docker compose ps
```

`helprr-init` makes the secrets it needs, then exits; that is normal
(`docker compose ps -a` shows it as `Exited (0)`). Helprr is ready when `docker compose ps`
shows `helprr` as `(healthy)`: run it again until it does, which takes a minute or two.
The script's own "Next" step, `docker compose up -d`, does the same without pulling
first.

The Compose file uses the `stable` channel; pin a version with `HELPRR_VERSION` in
`.env`. For `edge` or builds from source, use the separate development stack in
[Contributing](/helprr/contributing/), never your real data. `docker compose logs -f
helprr` follows the start.

Open `http://YOUR_SERVER:3050` (or your `HELPRR_PORT`) and
[create your admin](/helprr/first-run/).

## Health checks

- `GET /api/health` answers when the Node process does. It needs no sign-in.
- `GET /api/ready` answers 200 only when PostgreSQL, Redis and the database migrations
  are ready, and 503 with each part's status otherwise (`stopping` while Helprr shuts
  down). It needs no sign-in, and names no secret.
