---
title: Back up and restore
description: Back up Helprr, keep a copy elsewhere, restore it, or move it to a new machine.
---

Everything Helprr needs to recover lives in PostgreSQL, plus the `helprr-secrets`
volume when Helprr made its own session secret and push keys (no `JWT_SECRET` or VAPID
values in `.env`): without it, stored service sign-ins cannot be read and everyone must
sign in again. `backup.sh` saves both. Redis holds only
cache, rate-limit, and other short-lived state and never needs to be backed up. The
in-app settings export (**Settings → Backup & Restore**) is a *portable* subset —
connections, preferences, rules, watchlists — useful for moving settings
between installs, but it is **not** a disaster-recovery backup: it never
contains sessions, push subscriptions, or history, and it carries users'
password hashes only when both **Users & accounts** and **Include API keys /
tokens** are selected.

## Back up

Run it before every update and on a schedule:

```bash
./scripts/backup.sh
```

The no-clone quick start installs this helper under `scripts/` with mode `0700`.
If it is missing from an older installation, download `backup.sh` from the exact
target release as shown in [Update](/helprr/maintain/update/).
Stable backups default to `backups/stable/`. Use
`./scripts/backup.sh --output-dir /path/to/protected/storage` for a different local or
mounted destination. Use `./scripts/backup.sh --dev` only for the standalone
development stack; it explicitly selects `.env.dev`, `docker-compose.dev.yml`, and
`helprr-dev-db` and defaults to `backups/development/`. The helper never stops,
restarts, updates, or migrates containers and never overwrites an existing dump.

After a new dump passes validation, the helper keeps the newest 10 of its own dumps
in that directory and deletes older ones. Use `--keep N` to keep a different number,
or `--keep 0` to keep every dump. Only files it names
`helprr-pre-upgrade-<timestamp>.dump` (`helprr-dev-pre-upgrade-` with `--dev`) are
counted or removed; other files in the directory are left alone, and only dumps older
than the one just written are removed. When the Compose file has `helprr-init`, each dump
gets a `<same name>.secrets.tar` beside it (0600), pruned with it; restore the two together.

:::caution
Dumps contain your service API keys and users' password hashes. Treat backup
files as secrets: restrict permissions and encrypt them wherever they are
stored. Archive validation catches malformed or truncated output at creation time,
but it is not a restore test. Periodically restore into an isolated environment and
retain an off-host copy according to your own recovery needs.
:::

## Keep a copy off the host

A dump that exists only on the Docker host is lost
with the host. Either write it straight to storage that lives elsewhere, or copy it
there after it is written:

- **Mounted storage.** Mount a share or disk that belongs to another machine (for
  example over NFS, or an external drive) and point the helper at it. The helper
  creates the directory if needed, restricts it to `0700` and each dump to `0600`,
  and refuses a symlinked path, so use a mount that keeps Unix permissions:

  ```bash
  ./scripts/backup.sh --output-dir /mnt/offsite/helprr
  ```

- **Copy after writing.** Keep the default `backups/stable/` and copy new dumps to
  another machine. Encrypt first, so the copy is protected wherever it lands, for
  example with [age](https://github.com/FiloSottile/age) and a recipient key kept
  off the host:

  ```bash
  dump=backups/stable/helprr-pre-upgrade-YYYYMMDD-HHMMSS.dump
  age -r "$BACKUP_RECIPIENT" -o "$dump.age" "$dump" &&
    scp "$dump.age" backup-host:/srv/backups/helprr/
  ```

  Each encrypted copy keeps its dump's timestamped name, so a new one never
  replaces an older one, and it is copied only once encryption has succeeded.

The helper prunes only the directory it writes to, so prune copies made elsewhere
yourself. Before relying on an off-host copy, restore one into an isolated
environment as described above.

## Restore over an existing install

For example, to roll back after a bad change.
When rolling back an upgrade, first set `HELPRR_VERSION` in `.env` back to the
version that wrote the dump. Then check that the backup reads in full, before anything
changes:

```bash
dump=backups/stable/helprr-pre-upgrade-YYYYMMDD-HHMMSS.dump
docker compose exec -T helprr-db pg_restore --exit-on-error --file=/dev/null < "$dump" &&
  { [ ! -e "${dump%.dump}.secrets.tar" ] || tar -tf "${dump%.dump}.secrets.tar" >/dev/null; } &&
  echo "The backup reads in full"
```

If the `helprr-secrets` volume was lost or replaced and the dump has a `.secrets.tar`
beside it, put the secrets back first, with Helprr, the worker and Redis stopped (Redis
reads its password only as it starts), then refresh the copies (the `run` uses
`helprr-init`, which has the volume mounted and runs as root):

```bash
docker compose stop helprr helprr-twitch-worker helprr-redis &&
  docker compose run --rm --no-deps -T --entrypoint tar helprr-init -C /secrets -xf - < "${dump%.dump}.secrets.tar" &&
  docker compose run --rm --no-deps helprr-init &&
  docker compose up -d helprr-redis
```

If the volume was lost with no `.secrets.tar`, Helprr made its database password and
`.env` has no `POSTGRES_PASSWORD`, the database still expects the old password. Give it
the new one (sessions end and stored tokens must be entered again):

```bash
docker compose exec -T helprr-db psql -q -U postgres <<'SQL'
\set pw `cat /helprr-auth/postgres_password`
ALTER USER postgres PASSWORD :'pw';
SQL
```

Then restore the database. It is recreated before the restore:
`pg_restore --clean` drops only what is in the dump, so tables a newer release's
migrations added would stay behind and break the next upgrade. The whole dump
is read again and each step runs only if the one before it succeeded, so a
missing, damaged or truncated dump stops before anything is dropped. The last step
starts Helprr, then the worker if you use it:

```bash
docker compose exec -T helprr-db pg_restore --exit-on-error --file=/dev/null < "$dump" &&
  docker compose stop helprr helprr-twitch-worker &&
  docker compose exec -T helprr-db dropdb -U postgres --if-exists --force helprr &&
  docker compose exec -T helprr-db createdb -U postgres helprr &&
  docker compose exec -T helprr-db pg_restore -U postgres --exit-on-error -d helprr < "$dump" &&
  docker compose up -d --no-build --no-deps --wait helprr &&
  docker compose up -d --no-build
```

## Move to a new machine, or recover from a lost one

Restore onto a fresh host:

```bash
# 1. Set up the deployment files and .env as in the quick start. Reuse the old
#    install's JWT_SECRET (or sessions are invalidated and stored tokens are
#    unreadable), VAPID keys (or devices must re-subscribe), and
#    HELPRR_ADMIN_USERNAME if it was set — on boot the bootstrap admin is renamed
#    to it. Passwords are safe either way: APP_PASSWORD never overwrites an
#    existing password hash. If Helprr made those secrets itself, restore the
#    dump's .secrets.tar instead, and leave JWT_SECRET, VAPID_PUBLIC_KEY and
#    VAPID_PRIVATE_KEY empty in .env (setup-env.sh writes a new JWT_SECRET: empty
#    it), since a value in .env wins over the restored one:
docker compose run --rm --no-deps -T --entrypoint tar helprr-init -C /secrets -xf - < backups/stable/helprr-pre-upgrade-YYYYMMDD-HHMMSS.secrets.tar
docker compose run --rm --no-deps helprr-init
docker compose up -d --wait helprr-db
docker compose exec -T helprr-db pg_restore -U postgres --clean --if-exists -d helprr < backups/stable/helprr-pre-upgrade-YYYYMMDD-HHMMSS.dump
docker compose up -d
```

The restored database already contains the applied-migrations history, so the
app boots without re-running old migrations. Restore with the **same or newer**
Helprr version than the one that produced the dump.

The dump holds Helprr's database only. A database user you added yourself, such as one
a monitoring exporter signs in with, lives outside it: create it again on the new
install (`docker compose exec helprr-db psql -U postgres`).
