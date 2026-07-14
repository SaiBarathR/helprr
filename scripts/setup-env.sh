#!/bin/sh

set -eu

usage() {
  cat <<'EOF'
Usage: setup-env.sh [--stable|--dev]

Creates a new environment file with independently generated required secrets.
  --stable  Create .env from .env.example (default)
  --dev     Create .env.dev from .env.dev.example

The command refuses to overwrite an existing target and never prints secrets.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

mode=stable
case "${1:-}" in
  '') ;;
  --stable) ;;
  --dev) mode=dev ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

[ "$#" -le 1 ] || {
  usage >&2
  exit 2
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$script_dir/.env.example" ]; then
  root_dir=$script_dir
elif [ -f "$script_dir/../.env.example" ]; then
  root_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
else
  fail 'Could not find .env.example next to the script or in its parent directory.'
fi

if [ "$mode" = dev ]; then
  template=$root_dir/.env.dev.example
  target=$root_dir/.env.dev
  target_name=.env.dev
else
  template=$root_dir/.env.example
  target=$root_dir/.env
  target_name=.env
fi

[ -f "$template" ] || fail "Missing template: $(basename -- "$template")"
if [ -e "$target" ] || [ -L "$target" ]; then
  fail "$target_name already exists; it was not changed."
fi

command -v openssl >/dev/null 2>&1 || fail 'openssl is required to generate secrets.'

random_hex() {
  value=$(openssl rand -hex "$1" 2>/dev/null) || fail 'openssl could not generate a secret.'
  case "$value" in
    ''|*[!0-9a-f]*) fail 'openssl returned an invalid secret.' ;;
  esac
  [ "${#value}" -eq $((2 * $1)) ] || fail 'openssl returned an invalid secret length.'
  printf '%s' "$value"
}

# Hex is safe when embedded directly in Compose's PostgreSQL URL and dotenv files.
postgres_password=$(random_hex 32)
redis_password=$(random_hex 32)
admin_password=$(random_hex 32)
jwt_secret=$(random_hex 32)

umask 077
temporary=$(mktemp "$root_dir/.helprr-env.XXXXXX") || fail 'Could not create a temporary file.'
cleanup() {
  rm -f "$temporary"
}
trap cleanup 0 HUP INT TERM

if [ "$mode" = dev ]; then
  if ! awk \
    -v postgres_password="$postgres_password" \
    -v redis_password="$redis_password" \
    -v admin_password="$admin_password" \
    -v jwt_secret="$jwt_secret" '
      BEGIN { replacements = 0 }
      /^HELPRR_DEV_POSTGRES_PASSWORD=/ { print "HELPRR_DEV_POSTGRES_PASSWORD=" postgres_password; replacements++; next }
      /^HELPRR_DEV_REDIS_PASSWORD=/ { print "HELPRR_DEV_REDIS_PASSWORD=" redis_password; replacements++; next }
      /^HELPRR_DEV_APP_PASSWORD=/ { print "HELPRR_DEV_APP_PASSWORD=" admin_password; replacements++; next }
      /^HELPRR_DEV_JWT_SECRET=/ { print "HELPRR_DEV_JWT_SECRET=" jwt_secret; replacements++; next }
      { print }
      END { if (replacements != 4) exit 42 }
    ' "$template" > "$temporary"; then
    fail 'Could not render .env.dev from its template.'
  fi
else
  if ! awk \
    -v postgres_password="$postgres_password" \
    -v redis_password="$redis_password" \
    -v admin_password="$admin_password" \
    -v jwt_secret="$jwt_secret" '
      BEGIN { replacements = 0 }
      /^POSTGRES_PASSWORD=/ { print "POSTGRES_PASSWORD=" postgres_password; replacements++; next }
      /^REDIS_PASSWORD=/ { print "REDIS_PASSWORD=" redis_password; replacements++; next }
      /^APP_PASSWORD=/ { print "APP_PASSWORD=" admin_password; replacements++; next }
      /^JWT_SECRET=/ { print "JWT_SECRET=" jwt_secret; replacements++; next }
      { print }
      END { if (replacements != 4) exit 42 }
    ' "$template" > "$temporary"; then
    fail 'Could not render .env from its template.'
  fi
fi

chmod 600 "$temporary" || fail 'Could not restrict environment-file permissions.'

# A hard link publishes the completed file atomically and fails if the target
# appeared after the earlier existence check. The temporary file is on the same
# filesystem, so no copy window or overwrite mode is needed.
if ! ln "$temporary" "$target" 2>/dev/null; then
  fail "$target_name already exists or could not be created; it was not changed."
fi

rm -f "$temporary"
trap - 0 HUP INT TERM

printf 'Created %s with permissions 0600.\n' "$target_name"
printf 'Required secrets were written only to that file and were not printed.\n'
printf 'Review the timezone, bootstrap username, and optional VAPID settings before starting Helprr.\n'
