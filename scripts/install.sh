#!/bin/sh
# Installs Helprr with Docker Compose in one command:
#   curl -fsSL https://github.com/SaiBarathR/helprr/releases/latest/download/install.sh | sh
# Or download it, read it, then run it:  sh install.sh [options]
#
# It never installs Docker, never overwrites an existing install, checks every
# downloaded file against the release's SHA256SUMS, and prints no secret.

set -eu

usage() {
  cat <<'EOF'
Usage: install.sh [options]

  --dir DIR         Install folder (default: ./helprr)
  --port PORT       Port to open Helprr on (default: 3050)
  --tz ZONE         IANA timezone, such as Europe/Berlin (default: this computer's)
  --version X.Y.Z   A specific release (default: the latest)
  --asset-base URL  Where to download the release files from (for testing)
  --no-start        Set everything up, but do not start Helprr
  --admin-password  Create the admin from a generated APP_PASSWORD, instead of
                    in the browser on first open
  --yes             Ask nothing; use the defaults and the options given
  -h, --help        Show this help
EOF
}

# Everything else runs from main(), called on the last line, so the shell has read the
# whole script before running any of it. Under `curl ... | sh`, a shell that reads the
# pipe as it goes (bash as /bin/sh, on Fedora) would otherwise let a command that reads
# standard input swallow the rest of the script.
main() {
  say() { printf '%s\n' "$*"; }
  fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

  dir=./helprr
  port=3050
  tz=
  version=
  asset_base=
  start=yes
  admin_password=no
  ask=yes

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir) [ "$#" -ge 2 ] || fail '--dir needs a folder.'; dir=$2; shift 2 ;;
      --port) [ "$#" -ge 2 ] || fail '--port needs a number.'; port=$2; shift 2 ;;
      --tz) [ "$#" -ge 2 ] || fail '--tz needs a timezone.'; tz=$2; shift 2 ;;
      --version) [ "$#" -ge 2 ] || fail '--version needs a version.'; version=${2#v}; shift 2
        case "$version" in ''|*[!0-9A-Za-z.-]*) fail "\"$version\" is not a Helprr version, such as 1.12.1." ;; esac ;;
      --asset-base) [ "$#" -ge 2 ] || fail '--asset-base needs a URL.'; asset_base=$2; shift 2 ;;
      --no-start) start=no; shift ;;
      --admin-password) admin_password=yes; shift ;;
      --yes|-y) ask=no; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done

  # Under `curl ... | sh` standard input is this script, so questions read the terminal.
  # With no terminal (a pipeline in CI, say), the defaults are used.
  # A subshell: a failed redirect on the ':' built-in would end the whole script.
  if [ "$ask" = yes ] && ! { [ -r /dev/tty ] && ( : < /dev/tty ); } 2>/dev/null; then
    ask=no
  fi
  prompt() {
    # prompt "Question" default -> answer (the default when Enter is pressed)
    if [ "$ask" = yes ]; then
      printf '%s [%s]: ' "$1" "$2" > /dev/tty
      IFS= read -r answer < /dev/tty || answer=
      [ -n "$answer" ] || answer=$2
    else
      answer=$2
    fi
    printf '%s' "$answer"
  }

  say 'Helprr installer'
  say ''

  # 1. What this computer needs. Installing Docker is the operating system's job.
  if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fsSL -o "$2" "$1"; }
  elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -q -O "$2" "$1"; }
  else
    fail 'curl or wget is needed to download Helprr. Install one of them, then run this again.'
  fi
  command -v docker >/dev/null 2>&1 || fail 'Docker was not found. Install Docker Engine with the Compose plugin, or on a Mac Docker Desktop or OrbStack (https://docs.docker.com/get-started/get-docker/), then run this again.'
  docker_info=$(docker info 2>&1) || {
    case "$docker_info" in
      *'permission denied'*) fail "Docker is installed, but this user cannot use it. Run this with sudo, or add the user to the docker group (sudo usermod -aG docker \"\$USER\", then log in again)." ;;
      *) fail 'Docker is installed but not running. Start it (on a Mac, open Docker Desktop or OrbStack; on Linux, for example: sudo systemctl start docker), then run this again.' ;;
    esac
  }
  compose_version=$(docker compose version --short 2>/dev/null) || fail 'The Docker Compose plugin was not found. Install it (https://docs.docker.com/compose/install/), then run this again.'
  compose_version=${compose_version#v}
  compose_major=${compose_version%%.*}
  compose_minor=${compose_version#*.}
  compose_minor=${compose_minor%%.*}
  case "$compose_version" in
    *.*)
      case "$compose_major$compose_minor" in
        *[!0-9]*) ;;
        *)
          if [ "$compose_major" -lt 2 ] || { [ "$compose_major" -eq 2 ] && [ "$compose_minor" -lt 18 ]; }; then
            fail "Docker Compose $compose_version is too old; Helprr needs 2.18 or newer."
          fi
          ;;
      esac
      ;;
  esac
  command -v openssl >/dev/null 2>&1 || fail 'openssl is needed to make the passwords. Install it, then run this again.'
  if command -v sha256sum >/dev/null 2>&1; then
    checksum() { sha256sum "$1" | cut -d' ' -f1; }
  elif command -v shasum >/dev/null 2>&1; then
    checksum() { shasum -a 256 "$1" | cut -d' ' -f1; }
  else
    checksum() { openssl dgst -sha256 -r "$1" | cut -d' ' -f1; }
  fi

  # Whether something listens on this TCP port here: a Mac's netstat lists listeners
  # only with -an (its -l means something else), else ss, else busybox netstat.
  port_in_use() {
    if [ "$(uname -s 2>/dev/null)" = Darwin ]; then
      netstat -an -p tcp 2>/dev/null | awk -v p="$1" '$NF == "LISTEN" { n = split($4, a, "."); if (a[n] == p) found = 1 } END { exit !found }'
    elif command -v ss >/dev/null 2>&1; then
      [ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]
    elif command -v netstat >/dev/null 2>&1; then
      netstat -ltn 2>/dev/null | awk -v p="$1" '{ n = split($4, a, /[:.]/); if (a[n] == p) found = 1 } END { exit !found }'
    else
      return 1
    fi
  }

  # 2. Where and how.
  dir=$(prompt 'Install folder' "$dir")
  # read does not expand ~, so do it here.
  case "$dir" in
    '~') dir=$HOME ;;
    '~/'*) dir=$HOME/${dir#'~/'} ;;
  esac
  port=$(prompt 'Port to open Helprr on' "$port")
  case "$port" in
    ''|*[!0-9]*) fail "The port must be a number, not \"$port\"." ;;
    0) fail "The port must be between 1 and 65535." ;;
    0*) fail "Write the port without a leading zero, such as 3050." ;;
  esac
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || fail "The port must be between 1 and 65535."
  tz=$(prompt "Timezone (Enter for this computer's)" "$tz")
  if [ -n "$tz" ]; then
    case "$tz" in
      *[!A-Za-z0-9_+/-]*|/*|*/) fail "\"$tz\" is not a timezone name, such as Europe/Berlin." ;;
    esac
  fi

  if [ -e "$dir/.env" ] || [ -e "$dir/docker-compose.yml" ]; then
    fail "Helprr is already installed in $dir. To update it: cd \"$dir\" && ./scripts/update.sh. If an earlier run stopped before Helprr started, fix .env there and run: cd \"$dir\" && docker compose up -d (or remove the folder to start over)."
  fi
  if port_in_use "$port"; then
    fail "Port $port is already in use. Choose another with --port."
  fi

  case "$asset_base" in
    ''|https://*) ;;
    *) say "Note: $asset_base is not https, so the checksums it serves prove nothing; use it only for testing." ;;
  esac
  if [ -z "$asset_base" ]; then
    if [ -n "$version" ]; then
      asset_base="https://github.com/SaiBarathR/helprr/releases/download/v$version"
    else
      asset_base='https://github.com/SaiBarathR/helprr/releases/latest/download'
    fi
  fi

  # 3. The release files, checked before anything uses them.
  say "Downloading Helprr${version:+ $version}..."
  staging=$(mktemp -d) || fail 'Could not make a temporary folder.'
  trap 'rm -rf "$staging"' 0
  trap 'exit 130' HUP INT TERM
  assets='docker-compose.yml env.example setup-env.sh backup.sh update.sh'
  fetch "$asset_base/SHA256SUMS" "$staging/SHA256SUMS" || fail "Could not download the release checksums from $asset_base."
  for asset in $assets; do
    fetch "$asset_base/$asset" "$staging/$asset" || fail "Could not download $asset from $asset_base."
    expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$staging/SHA256SUMS")
    [ -n "$expected" ] || fail "$asset is not listed in the release checksums."
    [ "$(checksum "$staging/$asset")" = "$expected" ] || fail "$asset does not match the release checksum; nothing was installed."
  done

  mkdir -p -- "$dir/scripts" || fail "Could not create $dir."
  dir=$(CDPATH= cd -- "$dir" && pwd)
  cp "$staging/docker-compose.yml" "$dir/docker-compose.yml"
  cp "$staging/env.example" "$dir/.env.example"
  for script in setup-env.sh backup.sh update.sh; do
    cp "$staging/$script" "$dir/scripts/$script"
    chmod 700 "$dir/scripts/$script"
  done

  # 4. The .env file, with its own new secrets.
  say ''
  setup_flags=
  [ "$admin_password" = no ] || setup_flags=--admin-password
  # shellcheck disable=SC2086 # empty or one flag
  HELPRR_SETUP_TZ=$tz sh "$dir/scripts/setup-env.sh" $setup_flags < /dev/null > "$staging/setup.log" || {
    cat "$staging/setup.log"
    fail 'Creating .env failed.'
  }
  # setup-env.sh checks the default port; this checks the one chosen here.
  grep -E '^(Timezone|Note):|^      Fix it' "$staging/setup.log" | grep -v '^Note: port ' | sed 's/, from HELPRR_SETUP_TZ\./, as you chose./' || true
  [ "$port" = 3050 ] || printf 'HELPRR_PORT=%s\n' "$port" >> "$dir/.env"
  [ -z "$version" ] || printf 'HELPRR_VERSION=%s\n' "$version" >> "$dir/.env"

  sign_in() {
    username=$(sed -n 's/^HELPRR_ADMIN_USERNAME=//p' "$dir/.env" | head -n 1)
    address=$(hostname -I 2>/dev/null | awk '{ print $1 }') || address=
    # A Mac has no hostname -I: the address of the interface its default route uses.
    if [ -z "$address" ] && [ "$(uname -s 2>/dev/null)" = Darwin ]; then
      address=$(ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')" 2>/dev/null) || address=
    fi
    if grep -q '^APP_PASSWORD=.' "$dir/.env"; then
      say "  Open http://${address:-THIS-SERVER}:$port and sign in as \"${username:-admin}\"."
      say "  The password is APP_PASSWORD in $dir/.env. To show it on screen:"
      say "    grep '^APP_PASSWORD=' \"$dir/.env\""
    else
      case "$address" in
        ''|10.*|127.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*)
          say "  Open http://${address:-THIS-SERVER}:$port and create your admin account."
          say '  Do it now, before Helprr is reachable from the internet: whoever opens it first can.' ;;
        *)
          # A public address: the admin is created only at a local one (src/lib/local-hostname.ts).
          say "  This server's address ($address) is public, so create your admin on the server itself:"
          say "  from your computer, run  ssh -L $port:localhost:$port YOU@$address"
          say "  and open http://localhost:$port while it runs. Or see the HTTPS guide (APP_ORIGIN)."
          say "  Do it now: until an admin exists, anyone who can reach port $port can create one." ;;
      esac
    fi
    say '  For push notifications on a phone, Helprr needs an https:// address; see'
    say '  https://saibarathr.github.io/helprr/https/'
  }

  if [ "$start" = no ]; then
    say ''
    say "Helprr is set up in $dir but not started. When you are ready:"
    say "  cd \"$dir\" && docker compose up -d"
    sign_in
    exit 0
  fi

  # 5. Start, and wait until it answers.
  say ''
  say 'Starting Helprr (the first download takes a minute or two)...'
  if ! (cd "$dir" && docker compose pull --quiet && docker compose up -d) < /dev/null > "$staging/start.log" 2>&1; then
    cat "$staging/start.log"
    fail "Starting failed. If the port is taken, set HELPRR_PORT in $dir/.env. Then: cd \"$dir\" && docker compose up -d (logs: docker compose logs)"
  fi
  ready=no
  for _ in $(seq 1 90); do
    if (cd "$dir" && docker compose exec -T helprr wget -qO /dev/null http://127.0.0.1:3050/api/ready) < /dev/null > /dev/null 2>&1; then
      ready=yes
      break
    fi
    sleep 2
  done
  [ "$ready" = yes ] || fail "Helprr did not become ready within three minutes. See: cd \"$dir\" && docker compose logs helprr"

  say ''
  say 'Helprr is running.'
  sign_in
}

main "$@"
