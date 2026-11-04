#!/bin/sh

set -eu

usage() {
  cat <<'EOF'
Usage: setup-env.sh [--stable|--dev] [--admin-password]

Creates a new environment file with independently generated required secrets.
  --stable          Create .env from .env.example (default)
  --dev             Create .env.dev from .env.dev.example
  --admin-password  Also generate APP_PASSWORD, which creates the admin at the
                    first start. Without it, the first admin is created in the
                    browser. The development stack always gets one.

The command refuses to overwrite an existing target and never prints secrets.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

mode=stable
with_admin_password=no
for argument in "$@"; do
  case "$argument" in
    --stable) mode=stable ;;
    --dev) mode=dev ;;
    --admin-password) with_admin_password=yes ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done
[ "$mode" = stable ] || with_admin_password=yes

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
  tz_variable=HELPRR_DEV_TZ
  library_dir=$root_dir/twitch-library-dev
  app_port=3051
  port_variable=HELPRR_DEV_APP_PORT
  username_variable=HELPRR_DEV_ADMIN_USERNAME
  password_variable=HELPRR_DEV_APP_PASSWORD
else
  template=$root_dir/.env.example
  target=$root_dir/.env
  target_name=.env
  tz_variable=TZ
  library_dir=$root_dir/twitch-library
  app_port=3050
  port_variable=HELPRR_PORT
  username_variable=HELPRR_ADMIN_USERNAME
  password_variable=APP_PASSWORD
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

# This computer's IANA timezone, or Etc/UTC, and where it came from.
# HELPRR_SETUP_TZ overrides it (the installer's --tz uses this).
timezone=${HELPRR_SETUP_TZ:-}
timezone_source='HELPRR_SETUP_TZ'
if [ -z "$timezone" ]; then
  timezone=$(timedatectl show -p Timezone --value 2>/dev/null || true)
  timezone_source='this computer (timedatectl)'
fi
if [ -z "$timezone" ] && [ -r /etc/timezone ]; then
  timezone=$(head -n 1 /etc/timezone)
  timezone_source='this computer (/etc/timezone)'
fi
if [ -z "$timezone" ] && [ -L /etc/localtime ]; then
  timezone=$(readlink /etc/localtime 2>/dev/null | sed -n 's#.*/zoneinfo/##p' | sed -e 's#^posix/##' -e 's#^right/##')
  timezone_source='this computer (/etc/localtime)'
fi
case "$timezone" in
  ''|*[!A-Za-z0-9_+/-]*|/*|*/)
    timezone=Etc/UTC
    timezone_source='the default; this computer did not say'
    ;;
esac

# The worker writes the Twitch and YouTube libraries as this user, so the files
# belong to whoever set Helprr up. Run as root (or sudo), it keeps the default 1000.
if [ "$(id -u)" -eq 0 ]; then
  worker_uid=${SUDO_UID:-1000}
  worker_gid=${SUDO_GID:-1000}
  # Root running sudo is still root: the worker should not be.
  [ "$worker_uid" = 0 ] && worker_uid=1000 && worker_gid=1000
else
  worker_uid=$(id -u)
  worker_gid=$(id -g)
fi
case "$worker_uid$worker_gid" in
  ''|*[!0-9]*) worker_uid=1000 worker_gid=1000 ;;
esac
# The host group that owns /dev/dri/renderD128, for the GPU re-encode, when there is one.
render_gid=$(getent group render 2>/dev/null | cut -d: -f3 || true)
case "$render_gid" in *[!0-9]*) render_gid= ;; esac

# Hex is safe when embedded directly in Compose's PostgreSQL URL and dotenv files.
postgres_password=$(random_hex 32)
redis_password=$(random_hex 32)
admin_password=
[ "$with_admin_password" = no ] || admin_password=$(random_hex 32)
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
    -v jwt_secret="$jwt_secret" \
    -v timezone="$timezone" -v worker_uid="$worker_uid" -v worker_gid="$worker_gid" -v render_gid="$render_gid" '
      BEGIN { replacements = 0 }
      /^HELPRR_DEV_TZ=/ { print "HELPRR_DEV_TZ=" timezone; next }
      /^# TWITCH_PUID=/ { print "TWITCH_PUID=" worker_uid; next }
      /^# TWITCH_PGID=/ { print "TWITCH_PGID=" worker_gid; next }
      /^# TWITCH_RENDER_GID=/ && render_gid != "" { print "TWITCH_RENDER_GID=" render_gid; next }
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
    -v jwt_secret="$jwt_secret" \
    -v timezone="$timezone" -v worker_uid="$worker_uid" -v worker_gid="$worker_gid" -v render_gid="$render_gid" '
      BEGIN { replacements = 0 }
      /^TZ=/ { print "TZ=" timezone; next }
      /^# TWITCH_PUID=/ { print "TWITCH_PUID=" worker_uid; next }
      /^# TWITCH_PGID=/ { print "TWITCH_PGID=" worker_gid; next }
      /^# TWITCH_RENDER_GID=/ && render_gid != "" { print "TWITCH_RENDER_GID=" render_gid; next }
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

# Docker creates a missing bind-mount folder as root, which the worker cannot
# write to, so make the default library folder now, owned by the worker's user.
if [ ! -e "$library_dir" ]; then
  # 775 despite the private umask above: Jellyfin reads this folder too.
  if mkdir -m 775 "$library_dir" 2>/dev/null; then
    [ "$(id -u)" -eq 0 ] && chown "$worker_uid:$worker_gid" "$library_dir" 2>/dev/null
  fi
fi
library_owner=$(ls -nd "$library_dir" 2>/dev/null | awk '{ print $3 ":" $4 }')

printf 'Created %s with permissions 0600.\n' "$target_name"
printf 'Required secrets were written only to that file and were not printed.\n'
printf 'Timezone: %s, from %s. If that is wrong, change %s in %s.\n' "$timezone" "$timezone_source" "$tz_variable" "$target_name"
if [ "$library_owner" != "$worker_uid:$worker_gid" ]; then
  printf 'Note: %s is not owned by %s:%s, so the Twitch/YouTube worker cannot write to it.\n' "$library_dir" "$worker_uid" "$worker_gid"
  printf '      Fix it with:  sudo mkdir -p %s && sudo chown %s:%s %s\n' "$library_dir" "$worker_uid" "$worker_gid" "$library_dir"
fi

# Problems that would stop the first start, said now rather than by Compose.
if ! command -v docker >/dev/null 2>&1; then
  printf 'Note: Docker was not found. Install Docker Engine with the Compose plugin before starting Helprr.\n'
elif compose_version=$(docker compose version --short 2>/dev/null); then
  compose_version=${compose_version#v}
  compose_major=${compose_version%%.*}
  compose_minor=${compose_version#*.}
  compose_minor=${compose_minor%%.*}
  case "$compose_version" in *.*) ;; *) compose_major= ;; esac
  case "$compose_major$compose_minor" in
    ''|*[!0-9]*) ;;
    *)
      if [ "$compose_major" -lt 2 ] || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 18 ]; }; then
        printf 'Note: Docker Compose %s is too old; Helprr needs 2.18 or newer.\n' "$compose_version"
      fi
      ;;
  esac
else
  printf 'Note: "docker compose" did not run. Install the Docker Compose plugin (2.18 or newer).\n'
fi
# An earlier start without .env keeps its passwords in helprr-secrets; new ones here
# would not match the database it made.
if [ "$mode" = stable ] && command -v docker >/dev/null 2>&1 && docker volume inspect helprr-secrets >/dev/null 2>&1; then
  printf 'Note: Helprr has run on this computer before (the helprr-secrets volume exists). If it ran\n'
  printf '      without .env, its database expects the passwords in that volume: delete the\n'
  printf '      POSTGRES_PASSWORD, REDIS_PASSWORD and JWT_SECRET lines from %s before starting.\n' "$target_name"
fi
if command -v ss >/dev/null 2>&1 && [ -n "$(ss -Hltn "sport = :$app_port" 2>/dev/null)" ]; then
  printf 'Note: port %s is already in use. Set %s in %s before starting.\n' "$app_port" "$port_variable" "$target_name"
fi

# The commands below work from anywhere, and under sudo the files belong to root.
as_owner=
[ -n "${SUDO_UID:-}" ] && as_owner='sudo '
printf '\nNext:\n'
printf '  cd %s\n' "$root_dir"
if [ "$mode" = dev ]; then
  printf '  1. Start it:  docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build\n'
else
  printf '  1. Start Helprr:  docker compose up -d\n'
fi
admin_username=$(sed -n "s/^$username_variable=//p" "$target" | head -n 1)
if [ -n "$admin_password" ]; then
  printf '  2. Open http://THIS-SERVER:%s and sign in as "%s".\n' "$app_port" "${admin_username:-admin}"
  printf "     The password is %s in %s. To show it on screen:  %sgrep '^%s=' %s\n" "$password_variable" "$target_name" "$as_owner" "$password_variable" "$target_name"
else
  printf '  2. Open http://THIS-SERVER:%s and create your admin account.\n' "$app_port"
  printf '     Do it before Helprr is reachable from the internet: whoever opens it first can.\n'
fi
if [ "$mode" = dev ]; then
  printf '  Push notifications need the three VAPID values in %s; see the README.\n' "$target_name"
else
  printf '  Helprr makes its push notification keys on the first start; to use your own, see the README.\n'
fi
