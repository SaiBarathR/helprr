#!/bin/sh
# helprr-init: makes the secrets that .env does not set, once, on the helprr-secrets
# volume, and gives each reader its own copy. Runs as root from the Helprr image and
# exits; it never prints a secret.
#
#   /secrets/<name>          root-only master, written once and never regenerated
#   /secrets/app/<name>      copy for the app (uid 1001), read by docker-entrypoint.sh
#   /secrets/worker/<name>   copy for the Twitch/YouTube worker (TWITCH_PUID:TWITCH_PGID)
#
# A value set in the environment always wins: nothing is generated or copied for it,
# and a stale copy from earlier is removed so it can never shadow the real one.
set -eu

S=${HELPRR_SECRETS_DIR:-/secrets}
APP_UID=1001
WORKER_UID=${TWITCH_PUID:-1000}
WORKER_GID=${TWITCH_PGID:-1000}
case "$WORKER_UID$WORKER_GID" in ''|*[!0-9]*) WORKER_UID=1000 WORKER_GID=1000 ;; esac

umask 077
[ -d "$S" ] || { echo "init-secrets: $S is not mounted" >&2; exit 1; }
mkdir -p "$S/app" "$S/worker"
# The root holds only the masters (0600) and the two reader folders, so readers may pass through.
chmod 711 "$S"
as_root=no
[ "$(id -u)" -eq 0 ] && as_root=yes
if [ "$as_root" = yes ]; then
  chown "$APP_UID:$APP_UID" "$S/app"
  chown "$WORKER_UID:$WORKER_GID" "$S/worker"
fi
chmod 700 "$S/app" "$S/worker"

hex() { node -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('hex'))"; }

# write_once NAME VALUE: create the master only when it does not exist yet.
write_once() {
  [ -s "$S/$1" ] && return 1
  tmp=$(mktemp "$S/.$1.XXXXXX")
  printf '%s' "$2" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$S/$1"
  return 0
}

# copy_to READER NAME: refresh one reader's copy from the master.
copy_to() {
  reader=$1 name=$2
  cp "$S/$name" "$S/$reader/.$name.new"
  chmod 600 "$S/$reader/.$name.new"
  if [ "$as_root" = yes ]; then
    if [ "$reader" = app ]; then chown "$APP_UID:$APP_UID" "$S/$reader/.$name.new"; else chown "$WORKER_UID:$WORKER_GID" "$S/$reader/.$name.new"; fi
  fi
  mv "$S/$reader/.$name.new" "$S/$reader/$name"
}

# JWT_SECRET signs sessions and encrypts stored tokens, for the app and the worker.
if [ -n "${JWT_SECRET:-}" ]; then
  rm -f "$S/app/jwt_secret" "$S/worker/jwt_secret" "$S/app/jwt_secret.created_at"
else
  if write_once jwt_secret "$(hex 48)"; then
    # When it was made: the app warns if users are older than the secret (a lost volume).
    rm -f "$S/jwt_secret.created_at"
    write_once jwt_secret.created_at "$(date +%s)" || true
    echo 'init-secrets: created the session secret'
  fi
  copy_to app jwt_secret
  copy_to worker jwt_secret
  [ ! -s "$S/jwt_secret.created_at" ] || copy_to app jwt_secret.created_at
fi

# Web Push keys, for the app only. All or nothing: a key set in the environment is
# never paired with a generated one.
if [ -n "${VAPID_PUBLIC_KEY:-}${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}${VAPID_PRIVATE_KEY:-}" ]; then
  rm -f "$S/app/vapid_public" "$S/app/vapid_private"
else
  if [ ! -s "$S/vapid_public" ] || [ ! -s "$S/vapid_private" ]; then
    keys=$(cd "${HELPRR_APP_DIR:-/app}" && node -e "const k=require('web-push').generateVAPIDKeys();process.stdout.write(k.publicKey+' '+k.privateKey)")
    rm -f "$S/vapid_public" "$S/vapid_private"
    write_once vapid_private "${keys#* }"
    write_once vapid_public "${keys% *}"
    echo 'init-secrets: created the push notification keys'
  fi
  copy_to app vapid_public
  copy_to app vapid_private
fi
