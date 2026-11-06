#!/bin/sh

set -eu

usage() {
  cat <<'EOF'
Usage: backup.sh [--stable|--dev] [--output-dir DIRECTORY] [--keep N]

Creates and validates a private PostgreSQL custom-format backup without stopping
or restarting Helprr.
  --stable                Back up the stable database (default)
  --dev                   Back up the isolated development database
  --output-dir DIRECTORY  Store the backup in DIRECTORY instead of the default
  --keep N                After a new backup is validated, keep the newest N of
                          this helper's backups in that directory and delete
                          older ones (default 10; 0 keeps every backup)

Default directories:
  stable: ./backups/stable
  dev:    ./backups/development

Backup files contain secrets. The directory is restricted to 0700 and each dump
to 0600. When the Compose file has helprr-init, the generated secrets are saved
beside each dump as <name>.secrets.tar (0600); restore both together. Existing files are never overwritten. Pruning removes only files this
helper names helprr-pre-upgrade-<timestamp>.dump (helprr-dev-pre-upgrade- with
--dev); other files in the directory are left alone.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

mode=stable
output_dir=
keep=10

while [ "$#" -gt 0 ]; do
  case "$1" in
    --stable)
      mode=stable
      ;;
    --dev)
      mode=dev
      ;;
    --output-dir)
      shift
      [ "$#" -gt 0 ] || fail '--output-dir requires a directory.'
      output_dir=$1
      ;;
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

case $keep in
  ''|*[!0-9]*|0?*) fail '--keep must be a whole number such as 10, or 0 to keep every backup.' ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$script_dir/docker-compose.yml" ]; then
  root_dir=$script_dir
elif [ -f "$script_dir/../docker-compose.yml" ]; then
  root_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
else
  fail 'Could not find docker-compose.yml next to the script or in its parent directory.'
fi

if [ "$mode" = dev ]; then
  compose_file=$root_dir/docker-compose.dev.yml
  env_file=$root_dir/.env.dev
  db_service=helprr-dev-db
  backup_prefix=helprr-dev-pre-upgrade
  default_output_dir=$root_dir/backups/development
else
  compose_file=$root_dir/docker-compose.yml
  env_file=$root_dir/.env
  db_service=helprr-db
  backup_prefix=helprr-pre-upgrade
  default_output_dir=$root_dir/backups/stable
fi

[ -f "$compose_file" ] || fail "Missing Compose file: $(basename -- "$compose_file")"
# The stable install may have no .env at all (helprr-init made its passwords).
[ "$mode" != dev ] || [ -f "$env_file" ] || fail "Missing environment file: $(basename -- "$env_file")"
command -v docker >/dev/null 2>&1 || fail 'Docker is required to create a backup.'

if [ -z "$output_dir" ]; then
  output_dir=$default_output_dir
fi

if [ -L "$output_dir" ]; then
  fail 'The backup directory must not be a symbolic link.'
fi
if [ ! -e "$output_dir" ]; then
  mkdir -p -- "$output_dir" || fail 'Could not create the backup directory.'
fi
if [ -L "$output_dir" ]; then
  fail 'The backup directory must not be a symbolic link.'
fi
[ -d "$output_dir" ] || fail 'The backup output path is not a directory.'
chmod 700 "$output_dir" || fail 'Could not restrict backup-directory permissions.'

timestamp=$(date -u +%Y%m%d-%H%M%S) || fail 'Could not create a backup timestamp.'
backup_file=$output_dir/$backup_prefix-$timestamp.dump
if [ -e "$backup_file" ] || [ -L "$backup_file" ]; then
  fail "Backup already exists: $(basename -- "$backup_file")"
fi

umask 077
temporary=$(mktemp "$output_dir/.helprr-backup.XXXXXX") || fail 'Could not create a temporary backup file.'
cleanup() {
  rm -f "$temporary"
}
trap cleanup 0 HUP INT TERM

compose() {
  if [ "$mode" = dev ]; then
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  else
    # Plain `docker compose` in the Helprr directory, as in the README and
    # update.sh, so .env, COMPOSE_FILE and docker-compose.override.yml select
    # the same deployment that an update would replace.
    (cd "$root_dir" && docker compose "$@")
  fi
}

# pg_dump takes a transactionally consistent snapshot while Helprr remains online.
# Credentials stay inside the existing PostgreSQL container and are never placed on
# the host command line or printed by this script.
if ! compose exec -T "$db_service" sh -ceu '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec pg_dump \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --lock-wait-timeout=10s
' > "$temporary"; then
  fail 'PostgreSQL backup failed; no backup file was published.'
fi

[ -s "$temporary" ] || fail 'PostgreSQL returned an empty backup; no backup file was published.'

# This catches truncated or malformed archives. It does not replace periodic restore
# drills, which remain necessary to validate the full recovery procedure.
if ! compose exec -T "$db_service" pg_restore --list < "$temporary" >/dev/null; then
  fail 'PostgreSQL could not validate the backup archive; no backup file was published.'
fi

chmod 600 "$temporary" || fail 'Could not restrict backup-file permissions.'

# Publish atomically without overwriting a file that appeared after the earlier check.
if ! ln "$temporary" "$backup_file" 2>/dev/null; then
  fail 'The final backup path already exists or could not be created; it was not overwritten.'
fi

rm -f "$temporary"
trap - 0 HUP INT TERM

printf 'Created and validated PostgreSQL backup: %s\n' "$backup_file"

# The secrets helprr-init made (when .env does not set them) live on the
# helprr-secrets volume. Without them stored tokens cannot be read and every
# session ends, so they are saved beside the dump, read through helprr-init,
# which runs as root and has the volume mounted.
secrets_file=${backup_file%.dump}.secrets.tar
if compose config --services 2>/dev/null | grep -qx helprr-init; then
  secrets_temporary=$(mktemp "$output_dir/.helprr-secrets.XXXXXX") || fail 'Could not create a temporary secrets file.'
  if ! compose run --rm --no-deps -T --entrypoint tar helprr-init -C /secrets -cf - . > "$secrets_temporary" 2>/dev/null \
    || ! tar -tf "$secrets_temporary" > /dev/null 2>&1; then
    rm -f "$secrets_temporary"
    fail "The database backup is in $backup_file, but the generated secrets could not be saved."
  fi
  chmod 600 "$secrets_temporary"
  if ! ln "$secrets_temporary" "$secrets_file" 2>/dev/null; then
    rm -f "$secrets_temporary"
    fail 'The secrets backup path already exists; it was not overwritten.'
  fi
  rm -f "$secrets_temporary"
  printf 'Saved the generated secrets: %s\n' "$secrets_file"
fi

# Record the time of this backup so Settings → Backup & Restore can show it. Best
# effort: a database whose Helprr release predates the column (update.sh backs up
# before it pulls the new release) or that has no settings row yet is left as it is,
# and the backup above is complete either way. Credentials stay in the container.
if recorded=$(compose exec -T "$db_service" sh -ceu '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="UPDATE \"AppSettings\" SET \"lastDatabaseBackupAt\" = now() AT TIME ZONE '\''UTC'\'' WHERE \"id\" = '\''singleton'\'' RETURNING 1"
' 2>/dev/null) && [ "$recorded" = 1 ]; then
  printf 'Recorded the backup time in Helprr (Settings → Backup & Restore).\n'
else
  printf 'Note: Helprr could not record the backup time; Settings shows it after a backup made once Helprr is updated and running.\n' >&2
fi

# Prune only this helper's own dumps, oldest first: the timestamped names sort in
# creation order. Only dumps older than this run's timestamp are removed, so two
# runs at once never delete each other's newer dump (even if this run's own file
# is already gone), and the new one always stays.
if [ "$keep" -gt 0 ]; then
  own_stamp=${timestamp%-*}${timestamp#*-}
  # One listing for counting and pruning, so the two passes agree.
  set --
  for file in "$output_dir/$backup_prefix"-*.dump; do
    case ${file##*/} in
      "$backup_prefix"-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump) ;;
      *) continue ;;
    esac
    [ -f "$file" ] && [ ! -L "$file" ] && set -- "$@" "$file"
  done
  excess=$(($# - keep))
  removed=0
  for file in "$@"; do
    [ "$excess" -gt 0 ] || break
    stamp=${file##*/}
    stamp=${stamp#"$backup_prefix"-}
    stamp=${stamp%.dump}
    [ "${stamp%-*}${stamp#*-}" -lt "$own_stamp" ] || break
    # Counted, but another run has removed it since: one fewer to remove.
    if [ ! -e "$file" ]; then
      excess=$((excess - 1))
      continue
    fi
    if rm -f -- "$file"; then
      rm -f -- "${file%.dump}.secrets.tar"
      removed=$((removed + 1))
      printf 'Removed older backup: %s\n' "$file"
    else
      printf 'Warning: could not remove older backup: %s\n' "$file" >&2
    fi
    excess=$((excess - 1))
  done
  [ "$removed" -eq 0 ] || printf 'Kept the newest %s backups in this directory.\n' "$keep"
fi

printf 'Backup permissions are 0600; directory permissions are 0700.\n'
printf 'No containers were stopped, restarted, updated, or migrated.\n'
printf 'Keep the backup encrypted or otherwise protected, and periodically test restores.\n'
