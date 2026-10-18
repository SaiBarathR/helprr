# Server drills

Manual checks of install, restore, and upgrade, run on the Docker host before a
release or after a change to Compose, migrations, or the backup helper. Drills 1
and 2 run on a scratch Compose project beside the real installation. Drill 0 only
reads the real database, and Drill 3 is the normal update of the real
installation.

## Safety rules

- **Own names and port.** The scratch copy runs as project `helprr-fresh` with
  `fresh-` container names on host port `3059`. The stable stack uses `3050` and
  the isolated development stack `3051`; if `3059` is taken (`ss -ltn`), pick
  another free port.
- **Own image-cache volume.** The stable Compose file gives one volume a fixed
  name, `helprr-image-cache`, so a scratch copy started from it would share the
  real installation's image cache. Rename it in the copy before `up`, and never
  run `down -v` against a file that still names `helprr-image-cache`. The
  database, Redis, and log volumes are already per-project.
- **No network for real data.** A restored copy holds the real installation's
  service connections, cleaner rules, and push subscriptions, and its background
  jobs would act on them. Restore only into a copy whose network is
  `internal: true`, so it cannot reach Sonarr, qBittorrent, Jellyfin, AniList,
  or push services.

## Drill 0 — back up the real installation

From the real installation's directory:

```bash
./scripts/backup.sh
```

Pass: the helper prints `Created and validated PostgreSQL backup:` followed by
the dump's path under `backups/stable/`. Drill 2 restores that file.

## Drill 1 — fresh install from an empty database

Download the assets of the release under test, as in README → Quick start, and
pin its image:

```bash
mkdir -p /tmp/helprr-fresh/scripts && cd /tmp/helprr-fresh
HELPRR_RELEASE=vX.Y.Z
HELPRR_ASSET_BASE="https://github.com/SaiBarathR/helprr/releases/download/$HELPRR_RELEASE"
curl -fsSL -o docker-compose.yml "$HELPRR_ASSET_BASE/docker-compose.yml"
curl -fsSL -o .env.example "$HELPRR_ASSET_BASE/env.example"
curl -fsSL -o scripts/setup-env.sh "$HELPRR_ASSET_BASE/setup-env.sh"
curl -fsSL -o scripts/backup.sh "$HELPRR_ASSET_BASE/backup.sh"
curl -fsSL -o scripts/update.sh "$HELPRR_ASSET_BASE/update.sh"
chmod 700 scripts/setup-env.sh scripts/backup.sh scripts/update.sh
./scripts/setup-env.sh
sed -i "s/^#\? *HELPRR_VERSION=.*/HELPRR_VERSION=${HELPRR_RELEASE#v}/" .env
grep '^HELPRR_VERSION=' .env
```

Give the copy its own names, port, and image-cache volume, then check the
rendered file before starting anything:

```bash
sed -i -e 's/container_name: helprr/container_name: fresh-helprr/' \
  -e 's/"3050:3050"/"3059:3050"/' \
  -e 's/^\( *name:\) helprr-image-cache$/\1 helprr-fresh-image-cache/' \
  docker-compose.yml
docker compose -p helprr-fresh config | grep -E 'container_name|published|name: helprr'
```

Every container name must start with `fresh-`, the published port must be
`3059`, and the image-cache volume must be `helprr-fresh-image-cache`.

```bash
docker compose -p helprr-fresh pull
docker compose -p helprr-fresh up -d --wait
docker compose -p helprr-fresh ps
curl -fsS http://localhost:3059/api/health
curl -fsS http://localhost:3059/api/ready
```

Pass:

- `/api/health` returns `{"status":"ok"}`, and `/api/ready` returns `ready` with
  `database`, `redis`, and `migrations` all `ok`.
- Signing in at `http://localhost:3059` as `admin`, with the `APP_PASSWORD` that
  `setup-env.sh` wrote to `.env`, works.
- **Settings → Service status** shows the Git ref the image was built from,
  `vX.Y.Z` for a release image or `development` for `edge`, with the commit.

## Drill 2 — disaster-recovery restore

Reuse Drill 1's directory. Remove its data, then cut the copy off from every
network before it holds real data:

```bash
cd /tmp/helprr-fresh
docker compose -p helprr-fresh down -v
sed -i 's/^\( *driver: bridge\)$/\1\n    internal: true/' docker-compose.yml
docker compose -p helprr-fresh config | grep -q 'internal: true' && echo isolated || echo 'NOT isolated'
```

Do not go on unless it prints `isolated`: a copy on a normal network would run the
real installation's cleaner rules against its services.

In the copy's `.env`, set `HELPRR_ADMIN_USERNAME` to the real installation's
value; otherwise the restored bootstrap admin is renamed on boot. Keep
`HELPRR_VERSION` at the same or a newer version than the one that wrote the
dump. Then restore, as in README → Backup and restore:

```bash
docker compose -p helprr-fresh up -d --wait helprr-db
docker compose -p helprr-fresh exec -T helprr-db pg_restore -U postgres --clean --if-exists -d helprr < /path/to/helprr/backups/stable/helprr-pre-upgrade-YYYYMMDD-HHMMSS.dump &&
  docker compose -p helprr-fresh up -d --wait
docker compose -p helprr-fresh exec -T helprr wget -qO- http://127.0.0.1:3050/api/health
docker compose -p helprr-fresh exec -T helprr wget -qO- http://127.0.0.1:3050/api/ready
```

`--wait` returns once the containers report healthy, and the app starts only if
the restore succeeded. An internal network publishes no port, so the probes run
inside the container, and signing in to the restored copy is not part of this
drill.

Pass: `/api/ready` reports `ready`, and the restored rows match the real
installation. Run the same query in both:

```bash
q='select (select count(*) from "User"), (select count(*) from "ServiceConnection"), (select count(*) from _prisma_migrations)'
cd /tmp/helprr-fresh
docker compose -p helprr-fresh exec -T helprr-db psql -U postgres -d helprr -tAc "$q"
cd /path/to/helprr   # the real installation
docker compose exec -T helprr-db psql -U postgres -d helprr -tAc "$q"
```

Clean up from the copy's directory. `down -v` is safe there only because the copy's
image-cache volume was renamed; afterwards `helprr-image-cache` must still be listed:

```bash
cd /tmp/helprr-fresh
docker compose -p helprr-fresh down -v
cd / && rm -rf /tmp/helprr-fresh
docker volume ls -q | grep -x helprr-image-cache
```

The scratch `.env` held generated secrets and is removed with the directory. The
dump stays where Drill 0 wrote it; it holds service API keys and password
hashes.

## Drill 3 — upgrade the real installation

After Drills 0–2 pass, update as in README → Updating, from the real
installation's directory, with `HELPRR_VERSION` set to the new release.
`update.sh` takes a validated backup first and replaces only the app container:

```bash
cd /path/to/helprr
./scripts/update.sh
```

By hand, after `./scripts/backup.sh`:

```bash
docker compose pull helprr
docker compose up -d --no-build --no-deps --wait helprr
docker compose ps helprr
curl -fsS http://localhost:3050/api/health
curl -fsS http://localhost:3050/api/ready
```

Pass:

- **Settings → Service status** shows the new version and every configured
  service as reachable.
- File imports and destructive media, torrent, and queue operations still
  record rows in **Settings → Operation audit**.
- Notifications still arrive on a subscribed device.

If the update fails, follow the rollback rule in
[the maintainer workflow](maintainer-development-release-workflow.md#rollback-rule):
with no new migration, set `HELPRR_VERSION` back to the previous exact version
and recreate the app container; after a migration the previous version cannot
use, restore Drill 0's dump as in README → Backup and restore → Restore over an
existing installation.

## Drill 4 — failed upgrade and rollback

Run on the scratch copy from Drill 1 (a fresh install of the previous release),
never on the real installation. It rehearses the rollback rule across a release
that adds migrations.

1. Make startup fail after the pull: in the copy's `.env`, set `HELPRR_VERSION`
   to the newer release and `JWT_SECRET` to something shorter than 32
   characters. Run `./scripts/update.sh`. Pass: it takes a validated backup,
   then stops with "Helprr restarted after the update" or "is unhealthy", and
   prints the dump's path. The newer release has already applied its
   migrations, because they run before the configuration check.
2. Roll back: restore the previous `.env`, then pin the previous version and
   restore that dump:

   ```bash
   cd /tmp/helprr-fresh
   dump=backups/stable/helprr-pre-upgrade-YYYYMMDD-HHMMSS.dump
   docker compose exec -T helprr-db pg_restore --list < "$dump" > /dev/null &&
     docker compose stop helprr &&
     docker compose exec -T helprr-db dropdb -U postgres --if-exists --force helprr &&
     docker compose exec -T helprr-db createdb -U postgres helprr &&
     docker compose exec -T helprr-db pg_restore -U postgres --exit-on-error -d helprr < "$dump" &&
     docker compose up -d --no-build --no-deps --wait helprr
   ```

   The dump is checked before anything is dropped. The database is recreated
   rather than restored with `--clean`, which would leave behind tables the
   newer release's migrations added.

   Pass: `/api/ready` is ready, the migration count is back to the previous
   release's, and data added before the backup is there.
3. Upgrade cleanly: set `HELPRR_VERSION` to the newer release and run
   `./scripts/update.sh` again. Pass: healthy and ready, with the newer
   release's migration count and the same data.

Clean up as at the end of Drill 2.

## Record

- **2026-10-18, v1.6.3.** Drills 0–2 run on the maintainer's host (Docker Engine
  29.9.1, Compose 5.6.0). The fresh install was ready, the bootstrap admin
  signed in, and the update check reported `v1.6.3`. A production backup
  restored into the internal copy, which reported `ready` with users, service
  connections, and migrations matching production; the copy could not resolve
  outside hosts. The real installation's `helprr-image-cache` volume was still
  present after the copy's `down -v`.
- **2026-10-18, Drill 4, 1.6.3 → `edge`.** On the scratch copy with a marker
  user: the failed upgrade stopped after 7 s with "Helprr restarted after the
  update", with `edge`'s two new migrations already applied (11). Pinning 1.6.3
  and restoring the dump brought back 9 migrations and the marker, and sign-in
  worked; a clean `update.sh` to `edge` then reached ready with 11 migrations and
  the marker intact. Repeated with the database recreated before the restore
  (`dropdb`, `createdb`, `pg_restore` without `--clean`): the restore exited 0 and
  the same results followed.
- **2026-10-18, arm64.** The published `1.6.3` linux/arm64 image, run under QEMU
  emulation on the amd64 host (`platform: linux/arm64` on the app only), booted
  against an empty database in 18 s: all 9 migrations applied, `/api/health` and
  `/api/ready` 200, the bootstrap admin signed in. Pulling another platform
  re-points the local tag, so pull `--platform linux/amd64` afterwards before
  the real installation is recreated.
