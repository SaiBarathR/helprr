#!/bin/sh
# helprr-init: makes the secrets that .env does not set, once, on the helprr-secrets
# volume, and gives each reader its own copy. Runs as root from the Helprr image and
# exits; it never prints a secret.
#
#   /secrets/<name>          root-only master (0600), written once, never replaced:
#                            jwt_secret, jwt_secret.created_at, vapid_keys ("public private"),
#                            postgres_password, redis_password
#   /secrets/app/<name>      root:<app group> 0640, read by docker-entrypoint.sh
#   /secrets/worker/<name>   root:<worker group> 0640, read by the Twitch/YouTube worker
#   /auth/db/postgres_password, /auth/redis/redis_password
#                            root-only (0600) copies on Postgres's and Redis's own volumes,
#                            so those containers (root at start) never see the others
#
# Readers own nothing in the volume: every folder and file belongs to root, so a
# reader cannot plant a link that this root process would follow. Copies are staged in
# a root-only folder and moved in, and rename replaces a link instead of following it.
# A value set in the environment always wins: nothing is generated or copied for it,
# and a stale copy from earlier is removed so it can never shadow the real one.
set -eu

S=${HELPRR_SECRETS_DIR:-/secrets}
DB_AUTH=${HELPRR_DB_AUTH_DIR:-/auth/db}
REDIS_AUTH=${HELPRR_REDIS_AUTH_DIR:-/auth/redis}
fail() { echo "init-secrets: $*" >&2; exit 1; }

# The app runs as the image's nextjs user; read its group from the image itself.
APP_GID=${HELPRR_APP_GID:-$(id -g nextjs 2>/dev/null || echo 65533)}
WORKER_GID=${TWITCH_PGID:-1000}
case "$APP_GID" in ''|*[!0-9]*) fail "the app's group id is not a number: $APP_GID" ;; esac
case "${TWITCH_PUID:-1000}$WORKER_GID" in
  *[!0-9]*) fail 'TWITCH_PUID and TWITCH_PGID must be numbers (user and group ids), not names.' ;;
esac
# The worker must never read the app's copies, such as the push private key.
[ "$WORKER_GID" != "$APP_GID" ] || fail "TWITCH_PGID ($WORKER_GID) must differ from the app's group; pick another group for the worker."

umask 077
[ -d "$S" ] || fail "$S is not mounted"
as_root=no
[ "$(id -u)" -eq 0 ] && as_root=yes

# set_owner PATH GROUP: root and the reader's group, where it can be set (tests run as a user).
set_owner() {
  [ "$as_root" = no ] || chown "0:$2" "$1"
}

# Replace a reader folder that is not a plain root-owned folder (a link, or one a
# reader owned under an earlier layout) with a fresh one.
reader_dir() {
  dir=$S/$1
  if [ -L "$dir" ] || { [ -e "$dir" ] && [ "$as_root" = yes ] && [ "$(stat -c %u "$dir")" != 0 ]; }; then
    rm -rf "$dir"
  fi
  mkdir -p "$dir"
  set_owner "$dir" "$2"
  chmod 750 "$dir"
}

[ "$as_root" = no ] || chown 0:0 "$S"
chmod 711 "$S"
# Staging left by a run that was killed (older than ten minutes; a live run is shorter).
find "$S" -maxdepth 1 -name '.staging.*' -type d -mmin +10 -exec rm -rf {} + 2>/dev/null || true
# This run's own root-only staging folder, so two runs at once never share one.
STAGE=$(mktemp -d "$S/.staging.XXXXXX")
trap 'rm -rf "$STAGE"' 0
trap 'exit 1' INT TERM HUP
# Masters stay root-only 0600, even after a restore that lost their modes.
for master in jwt_secret jwt_secret.created_at vapid_keys postgres_password redis_password; do
  [ -f "$S/$master" ] && [ ! -L "$S/$master" ] || continue
  [ "$as_root" = no ] || chown 0:0 "$S/$master"
  chmod 600 "$S/$master"
done
reader_dir app "$APP_GID"
reader_dir worker "$WORKER_GID"

new_secret() {
  value=$(node -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('hex'))") \
    || fail 'could not generate a secret'
  [ "${#value}" -ge 64 ] || fail 'generated a secret that is too short'
  printf '%s' "$value"
}

# publish NAME VALUE: create the master only when it does not exist. ln fails when the
# name is taken, so two runs at once can never both write it.
publish() {
  tmp=$(mktemp "$STAGE/$1.XXXXXX")
  printf '%s' "$2" > "$tmp" || fail "could not write $1"
  chmod 600 "$tmp"
  if ln "$tmp" "$S/$1" 2>/dev/null; then created=yes; else created=no; fi
  rm -f "$tmp"
  [ "$created" = yes ] || [ -e "$S/$1" ] || fail "could not create $1 (does the volume support hard links?)"
  [ "$created" = yes ]
}

# place TMP DEST: move a staged copy into place. A folder or link at DEST (only root
# could have made one) is removed first, so the copy can never land inside it.
place() {
  if [ -d "$2" ] || [ -L "$2" ]; then rm -rf "$2"; fi
  mv -f "$1" "$2"
}

# copy_to READER NAME GROUP: refresh one reader's copy from the master.
copy_to() {
  { [ -f "$S/$2" ] && [ ! -L "$S/$2" ]; } || fail "the master $2 is missing or not a file"
  tmp=$(mktemp "$STAGE/$1-$2.XXXXXX")
  cat "$S/$2" > "$tmp"
  set_owner "$tmp" "$3"
  chmod 640 "$tmp"
  place "$tmp" "$S/$1/$2"
}

# own_copy DIR NAME: a root-only copy for a service that reads it as root when it starts
# (Postgres, Redis), on that service's own volume. Staged in the same folder, so the
# move is a rename.
own_copy() {
  { [ -f "$S/$2" ] && [ ! -L "$S/$2" ]; } || fail "the master $2 is missing or not a file"
  [ -d "$1" ] || fail "$1 is not mounted"
  [ "$as_root" = no ] || chown 0:0 "$1"
  chmod 700 "$1"
  find "$1" -maxdepth 1 -name '.new.*' -mmin +10 -exec rm -f {} + 2>/dev/null || true
  tmp=$(mktemp "$1/.new.XXXXXX")
  cat "$S/$2" > "$tmp"
  chmod 600 "$tmp"
  place "$tmp" "$1/$2"
}

# ensure NAME WHAT: make a random master once.
ensure() {
  [ ! -e "$S/$1" ] || return 0
  value=$(new_secret 32)
  if publish "$1" "$value"; then echo "init-secrets: created the $2"; fi
}

# JWT_SECRET signs sessions and encrypts stored tokens, for the app and the worker.
if [ -n "${JWT_SECRET:-}" ]; then
  rm -f "$S/app/jwt_secret" "$S/worker/jwt_secret" "$S/app/jwt_secret.created_at"
else
  if [ ! -e "$S/jwt_secret" ]; then
    secret=$(new_secret 48)
    if publish jwt_secret "$secret"; then
      # When it was made: the app warns if users are older than the secret (a lost volume).
      rm -f "$S/jwt_secret.created_at"
      publish jwt_secret.created_at "$(date +%s)" || true
      echo 'init-secrets: created the session secret'
    fi
  fi
  copy_to app jwt_secret "$APP_GID"
  copy_to worker jwt_secret "$WORKER_GID"
  [ ! -s "$S/jwt_secret.created_at" ] || copy_to app jwt_secret.created_at "$APP_GID"
fi

# Web Push keys, for the app only. All or nothing: a key set in the environment is
# never paired with a generated one. Both keys live in one master, published with one
# ln, so a half pair can never exist, even with several runs at once.
if [ -n "${VAPID_PUBLIC_KEY:-}${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}${VAPID_PRIVATE_KEY:-}" ]; then
  rm -f "$S/app/vapid_public" "$S/app/vapid_private"
else
  if [ ! -e "$S/vapid_keys" ]; then
    keys=$(cd "${HELPRR_APP_DIR:-/app}" && node -e "const k=require('web-push').generateVAPIDKeys();process.stdout.write(k.publicKey+' '+k.privateKey)") \
      || fail 'could not generate the push keys'
    case "$keys" in *?' '?*) ;; *) fail 'generated push keys look wrong' ;; esac
    if publish vapid_keys "$keys"; then
      echo 'init-secrets: created the push notification keys'
    fi
  fi
  { [ -f "$S/vapid_keys" ] && [ ! -L "$S/vapid_keys" ]; } || fail 'the push keys master is missing or not a file'
  keys=$(cat "$S/vapid_keys")
  for part in public private; do
    tmp=$(mktemp "$STAGE/app-vapid_$part.XXXXXX")
    if [ "$part" = public ]; then printf '%s' "${keys% *}" > "$tmp"; else printf '%s' "${keys#* }" > "$tmp"; fi
    set_owner "$tmp" "$APP_GID"
    chmod 640 "$tmp"
    place "$tmp" "$S/app/vapid_$part"
  done
fi

# The database and Redis passwords. Set in .env (every install before this one): used
# as they are, and stale copies are removed. Without the service's own volume, the
# Compose file is older than this and .env provides the password: nothing is made.
# Otherwise made once; Postgres reads its password only when it creates the database.
if [ -n "${POSTGRES_PASSWORD:-}" ] || [ ! -d "$DB_AUTH" ]; then
  rm -f "$S/app/postgres_password" "$S/worker/postgres_password" "$DB_AUTH/postgres_password"
else
  ensure postgres_password 'database password'
  own_copy "$DB_AUTH" postgres_password
  copy_to app postgres_password "$APP_GID"
  copy_to worker postgres_password "$WORKER_GID"
fi
if [ -n "${REDIS_PASSWORD:-}" ] || [ ! -d "$REDIS_AUTH" ]; then
  rm -f "$S/app/redis_password" "$REDIS_AUTH/redis_password"
else
  ensure redis_password 'Redis password'
  own_copy "$REDIS_AUTH" redis_password
  copy_to app redis_password "$APP_GID"
fi

# The folder for in-app database backups (Settings -> Backup & Restore), when it is
# mounted here too. Docker makes a host folder as root, which the app cannot write to,
# so an empty one that root owns goes to the app's user. Any other folder is left
# alone (the app then says it cannot write there), and nothing here ever fails.
BACKUPS=${HELPRR_BACKUP_DIR:-/app/backups}
if [ "$as_root" = yes ] && [ -d "$BACKUPS" ] && [ ! -L "$BACKUPS" ] \
  && [ "$(stat -c %u "$BACKUPS")" = 0 ] && [ -z "$(ls -A "$BACKUPS")" ]; then
  APP_UID=$(id -u nextjs 2>/dev/null || echo 1001)
  if chown "$APP_UID:$APP_GID" "$BACKUPS" && chmod 700 "$BACKUPS"; then
    echo "init-secrets: the backup folder now belongs to the app"
  else
    echo "init-secrets: could not give the backup folder to the app (a network share?); in-app backups need it writable by $APP_UID" >&2
  fi
fi
