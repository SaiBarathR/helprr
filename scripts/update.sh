#!/bin/sh

set -eu

usage() {
  cat <<'EOF'
Usage: update.sh [--keep N]

Backs up the stable database with backup.sh, then pulls and restarts only the
Helprr app container and waits until it is healthy and ready. PostgreSQL and
Redis keep running. Nothing is pulled or restarted if the backup fails. With
the twitch profile on, the Twitch worker follows once the app is ready.
  --keep N  Passed to backup.sh: keep the newest N backups (default 10; 0 keeps
            every backup)

Set HELPRR_VERSION in .env first to move to an exact version; otherwise the
image's current channel (stable by default) is pulled.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

keep=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep)
      shift
      [ "$#" -gt 0 ] || fail '--keep requires a number.'
      keep=$1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$script_dir/docker-compose.yml" ]; then
  root_dir=$script_dir
elif [ -f "$script_dir/../docker-compose.yml" ]; then
  root_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
else
  fail 'Could not find docker-compose.yml next to the script or in its parent directory.'
fi
[ -f "$script_dir/backup.sh" ] || fail 'backup.sh must be next to update.sh.'

set -- --stable
if [ -n "$keep" ]; then
  set -- "$@" --keep "$keep"
fi
sh "$script_dir/backup.sh" "$@" || fail 'The backup failed; nothing was pulled or restarted.'

# Plain `docker compose` in the Helprr directory, as in the README, so .env,
# COMPOSE_FILE and docker-compose.override.yml apply just as they do by hand.
cd "$root_dir" || fail 'Could not enter the Helprr directory.'
docker compose pull helprr || fail 'Pulling the Helprr image failed; the running container was not changed.'
docker compose up -d --no-build --no-deps helprr || fail 'Starting the new Helprr container failed. See: docker compose logs helprr'

# Pending migrations run before the server starts, so allow well past the
# Compose health check's 60-second start period. Docker marks a container
# unhealthy after about 150 s even while a long migration is still running, so
# only a restart (startup failed) or the timeout ends the wait.
container=$(docker compose ps -q helprr) || fail 'Could not find the Helprr container.'
[ -n "$container" ] || fail 'Could not find the Helprr container.'
restarts=$(docker inspect -f '{{.RestartCount}}' "$container") || fail 'Could not read the Helprr container state.'
waited=0
while :; do
  state=$(docker inspect -f '{{.RestartCount}} {{.State.Health.Status}}' "$container") || fail 'Could not read the Helprr container health.'
  [ "${state%% *}" = "$restarts" ] || fail 'Helprr restarted after the update. See: docker compose logs helprr'
  [ "${state#* }" != healthy ] || break
  [ "$waited" -lt 300 ] || fail "Helprr did not become healthy within 5 minutes (last health: ${state#* }). See: docker compose logs helprr"
  sleep 5
  waited=$((waited + 5))
done

ready=$(docker compose exec -T helprr wget -qO- http://127.0.0.1:3050/api/ready) ||
  fail 'Helprr is healthy but /api/ready did not report ready. See: docker compose logs helprr'
printf 'Helprr is healthy and ready: %s\n' "$ready"

# Only with COMPOSE_PROFILES=twitch. It starts after the app, which owns the
# migrations it waits for; a job it was running is requeued, not lost.
if docker compose config --services | grep -qx helprr-twitch-worker; then
  docker compose pull helprr-twitch-worker || fail 'Pulling the Twitch worker failed; the app is updated and the old worker is still running.'
  docker compose up -d --no-build --no-deps helprr-twitch-worker || fail 'Starting the new Twitch worker failed. See: docker compose logs helprr-twitch-worker'
  printf 'Twitch worker updated.\n'
fi

printf 'To roll back, see README -> Backup and restore; the backup above is the restore point.\n'
