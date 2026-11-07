---
title: Update
description: Update Helprr to a new release, safely.
---

Tagged releases contain `docker-compose.yml`, `env.example`, `setup-env.sh`,
`backup.sh`, and `update.sh`. This lets an installation created without Git update
without cloning the repository. To install an exact `vX.Y.Z` release from the
existing Helprr directory, replace the non-secret deployment files and helper scripts,
review the new `.env.example` against the existing `.env`, select the matching exact
image version in `.env` (without the leading `v`), then run the update helper:

```bash
mkdir -p scripts
HELPRR_RELEASE=vX.Y.Z
HELPRR_ASSET_BASE="https://github.com/SaiBarathR/helprr/releases/download/$HELPRR_RELEASE"
curl -fsSL -o docker-compose.yml "$HELPRR_ASSET_BASE/docker-compose.yml"
curl -fsSL -o .env.example "$HELPRR_ASSET_BASE/env.example"
curl -fsSL -o scripts/setup-env.sh "$HELPRR_ASSET_BASE/setup-env.sh"
curl -fsSL -o scripts/backup.sh "$HELPRR_ASSET_BASE/backup.sh"
curl -fsSL -o scripts/update.sh "$HELPRR_ASSET_BASE/update.sh"
chmod 700 scripts/setup-env.sh scripts/backup.sh scripts/update.sh
# Set HELPRR_VERSION=X.Y.Z in .env after reviewing the release notes.
./scripts/update.sh
```

`update.sh` first runs `backup.sh` and stops if the backup or its validation fails,
so nothing is pulled or restarted without a validated backup. It then pulls the image
and replaces only the Helprr app container, waits up to five minutes for it to report
healthy, and checks `/api/ready` from inside the container. The dump path it prints is
the restore point if you need to roll back. `--keep N` is passed to `backup.sh`.

Releases with backups made in Helprr add a `helprr-backups` volume to
`docker-compose.yml`; downloading the release's file as above adds it. With an older
file Helprr works as before, and **Settings → Backup & Restore** says **Backup folder not
mounted** ([Back up from Helprr](/helprr/maintain/backup/#back-up-from-helprr) has the
lines to add).

The same steps by hand:

```bash
./scripts/backup.sh
docker compose pull helprr
docker compose up -d --no-build --no-deps helprr
docker compose ps helprr
curl -fsS http://localhost:3050/api/health
curl -fsS http://localhost:3050/api/ready
```

The backup helper keeps Helprr online while `pg_dump` takes a consistent snapshot,
verifies that `pg_restore` can read the completed custom-format archive, and
atomically writes it under `backups/stable/` with private permissions. If backup
creation or validation fails, the update commands must not be run.

Pending database migrations run automatically before the app starts. The
container drains background work gracefully on replacement, waiting up to 30
seconds for in-flight polling and cleanup, so updating while downloads or
cleanup are active is normally safe; a cleanup cycle still running after 30
seconds is interrupted. The scoped `--no-deps helprr` command leaves PostgreSQL
and Redis running during the update.

When a release's notes say it moved the Redis image, pull and restart Redis once
after the update. Redis holds only caches, rate limits and short-lived playback
state, so the restart only drops those:

```bash
docker compose pull helprr-redis
docker compose up -d --no-deps helprr-redis
```

Keep the newer Redis if you roll Helprr back; older releases work with it. An
older Redis cannot read files a newer one has written, so to move Redis itself
back, set the `helprr-redis` image in `docker-compose.yml` to the previous tag
(for example `redis:7-alpine`), then stop Helprr and Redis, delete only the Redis
volume (its caches rebuild), and start both again:

```bash
docker compose stop helprr helprr-redis
docker compose rm -f helprr-redis
docker volume rm "$(docker volume ls -q | grep 'helprr-redis-data$')"
docker compose up -d
```

To stay on an exact version instead of a channel, set `HELPRR_VERSION` in
`.env` (for example `HELPRR_VERSION=1.0.0`) and re-run `./scripts/update.sh` (or the
two Docker commands) to move between versions. Downgrading across releases is not supported once a
newer version has applied its migrations — restore the matching backup instead.

## Update notices and support bundles

Admins see a notice on **Settings** and **Settings → Service status** when a newer
stable Helprr release is available. The server checks Helprr's public GitHub latest-
release endpoint every six hours and on an admin visit, and caches the result for six
hours; admins also get one [notification](/helprr/notifications/#admin-events) per new
release. It sends no
installation data and never pulls an image, changes a tag, restarts a container, or
applies an update. Back up and follow the normal update procedure after reviewing the
linked release notes. To stop the check, turn off **Check for updates** in
**Settings → Service status**: Helprr then never asks GitHub, and shows no notice.

After an update, everyone sees a **What's new** card once, the first time they open
Helprr, with the notes for each release since the version they last saw. Closing it
hides it on every device. A new account, and builds that are not a release (such as
`edge`), skip it. Accounts that existed before the first release after 1.14.0 count as
having seen 1.14.0, so they get the notes from that release on. The notes come from the changelog inside the image, not from GitHub.
**Settings → About → What's new** shows the running release's notes at any time.

**Settings → Service status → Support bundle** downloads bounded JSON diagnostics:
the running version/commit, readiness, migration names, aggregate database counts,
non-secret runtime settings, configured service types/presence flags, and up to 250
recent log entries. The bundle never includes service URLs, API/OAuth tokens, custom-
header values, password hashes, database/Redis credentials, user records, or media and
request rows. Known current credentials, sensitive structured fields, embedded URL or
Basic-auth credentials, and long token-shaped historical values are redacted again at
download time. If Helprr cannot load the service-credential inventory, it omits logs
instead of weakening redaction.

The remaining service labels, aggregate counts, versions, and redacted log messages can
still describe your installation. Review the JSON and treat it as private diagnostic
data before sharing it.

## An old database with no migration history

A database created by an older `prisma db push` workflow, with no migration history, must be baselined once before Docker can start it:

```bash
docker compose run --rm helprr ./node_modules/.bin/prisma migrate resolve --applied 0001_init
docker compose up -d
```
