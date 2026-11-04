#!/bin/sh
set -e

# Secrets made by helprr-init (docker/init-secrets.sh) on the helprr-secrets volume,
# used only for what the environment does not set. Without that volume (an older
# Compose file), nothing here applies and the environment must provide them.
SECRETS=${HELPRR_SECRETS_DIR:-/app/secrets}/app
if [ -z "${JWT_SECRET:-}" ] && [ -r "$SECRETS/jwt_secret" ]; then
  JWT_SECRET=$(cat "$SECRETS/jwt_secret")
  export JWT_SECRET
  export HELPRR_JWT_SECRET_SOURCE=generated
  # When it was made, so the app can warn if users are older than the secret.
  if [ -r "$SECRETS/jwt_secret.created_at" ]; then
    HELPRR_JWT_SECRET_CREATED_AT=$(cat "$SECRETS/jwt_secret.created_at")
    export HELPRR_JWT_SECRET_CREATED_AT
  fi
fi
if [ -z "${VAPID_PUBLIC_KEY:-}${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}${VAPID_PRIVATE_KEY:-}" ] \
  && [ -r "$SECRETS/vapid_public" ] && [ -r "$SECRETS/vapid_private" ]; then
  VAPID_PUBLIC_KEY=$(cat "$SECRETS/vapid_public")
  VAPID_PRIVATE_KEY=$(cat "$SECRETS/vapid_private")
  export VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
  export HELPRR_VAPID_SOURCE=generated
fi
# The database URL: an explicit DATABASE_URL, else one built from POSTGRES_PASSWORD,
# else from the password helprr-init made (no .env at all). The bundled Compose file
# names the database helprr-db. A password with URL characters (@ : / ? #) needs an
# explicit, percent-encoded DATABASE_URL; generated ones are hex.
if [ -z "${DATABASE_URL:-}" ]; then
  db_password=${POSTGRES_PASSWORD:-}
  if [ -z "$db_password" ] && [ -r "$SECRETS/postgres_password" ]; then
    db_password=$(cat "$SECRETS/postgres_password")
  fi
  if [ -z "$db_password" ]; then
    echo 'Helprr: no database password. Set POSTGRES_PASSWORD (or DATABASE_URL) in .env, or start Helprr with its docker-compose.yml, which makes one.' >&2
    exit 1
  fi
  DATABASE_URL="postgresql://postgres:$db_password@helprr-db:5432/helprr"
  export DATABASE_URL
  unset db_password
fi
unset POSTGRES_PASSWORD
if [ -z "${REDIS_PASSWORD:-}" ] && [ -r "$SECRETS/redis_password" ]; then
  REDIS_PASSWORD=$(cat "$SECRETS/redis_password")
  export REDIS_PASSWORD
fi

# A contact for the push services: the public address when it is https and not
# localhost (web-push refuses anything but https: and mailto:, and Apple refuses
# localhost), else the project's page.
if [ -z "${VAPID_SUBJECT:-}" ] && [ -n "${VAPID_PUBLIC_KEY:-}${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}" ]; then
  case "${APP_ORIGIN:-}" in
    https://localhost*|https://127.*|https://\[::1\]*) VAPID_SUBJECT=https://github.com/SaiBarathR/helprr ;;
    https://?*) VAPID_SUBJECT=$APP_ORIGIN ;;
    *) VAPID_SUBJECT=https://github.com/SaiBarathR/helprr ;;
  esac
  export VAPID_SUBJECT
fi

# Apply pending migrations before starting. Fails loudly (and blocks boot) if a
# migration cannot be applied. Databases created before the migration-based
# workflow must be baselined once:
#   ./node_modules/.bin/prisma migrate resolve --applied 0001_init
./node_modules/.bin/prisma migrate deploy

# exec replaces this shell so node runs as PID 1 and receives SIGTERM directly
# (a plain `sh -c "... && node"` keeps sh as PID 1, which does not forward
# signals — Docker would SIGKILL after the grace period on every update).
# The graceful drain itself lives in src/lib/shutdown.ts.
exec node server.js
