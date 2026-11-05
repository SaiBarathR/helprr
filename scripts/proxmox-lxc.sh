#!/usr/bin/env bash
# Installs Helprr on Proxmox VE in a container of its own, in one command, as root on
# the Proxmox host:
#   bash -c "$(curl -fsSL https://github.com/SaiBarathR/helprr/releases/latest/download/proxmox-lxc.sh)"
#
# It makes an unprivileged Debian 13 container named helprr (nesting on, for Docker),
# installs Docker in it, and runs Helprr's own installer there (install.sh, which checks
# every file against the release's SHA256SUMS). It changes nothing else on the host and
# stops if a container named helprr already exists.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: proxmox-lxc.sh [options]

  --ctid ID         Container ID (default: the next free one)
  --storage NAME    Storage for the container's disk (default: local-lvm, local-zfs,
                    or the first that holds containers)
  --bridge NAME     Network bridge (default: vmbr0; the container gets its address by DHCP)
  --disk GB         Disk size (default: 8)
  --cores N         CPU cores (default: 2)
  --memory MIB      Memory (default: 2048)
  --version X.Y.Z   A specific Helprr release (default: the latest)
  --asset-base URL  Where to download Helprr's release files from (for testing)
  --yes             Ask nothing
  -h, --help        Show this help
EOF
}

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

ctid='' storage='' bridge=vmbr0 disk=8 cores=2 memory=2048 version='' asset_base='' ask=yes
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ctid) ctid=${2:?--ctid needs an ID}; shift 2 ;;
    --storage) storage=${2:?--storage needs a name}; shift 2 ;;
    --bridge) bridge=${2:?--bridge needs a name}; shift 2 ;;
    --disk) disk=${2:?--disk needs a size}; shift 2 ;;
    --cores) cores=${2:?--cores needs a number}; shift 2 ;;
    --memory) memory=${2:?--memory needs a size}; shift 2 ;;
    --version) version=${2:?--version needs a version}; shift 2 ;;
    --asset-base) asset_base=${2:?--asset-base needs a URL}; shift 2 ;;
    --yes|-y) ask=no; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
for number in "$disk" "$cores" "$memory" ${ctid:+"$ctid"}; do
  case "$number" in ''|*[!0-9]*) fail "\"$number\" is not a number." ;; esac
done
case "$version" in *[!0-9A-Za-z.-]*) fail "\"$version\" is not a Helprr version, such as 1.13.0." ;; esac
case "$bridge$storage" in *[!0-9A-Za-z_.-]*) fail 'Storage and bridge names are letters, digits and _ . - only.' ;; esac

[ "$(id -u)" = 0 ] || fail 'Run this as root on the Proxmox VE host.'
for tool in pct pveam pvesm pvesh; do
  command -v "$tool" >/dev/null || fail "This is not a Proxmox VE host ($tool is missing). Run it in the host's shell."
done

# Never two: an existing container named helprr is left alone.
existing=$(pct list | awk 'NR > 1 && $NF == "helprr" { print $1 }' | head -n 1)
if [ -n "$existing" ]; then
  fail "Container $existing is already named helprr, so this stops here and changes nothing.
To update Helprr, update it inside that container (pct enter $existing, then see the update guide).
To install again from scratch, back it up, then remove it: pct stop $existing && pct destroy $existing"
fi

[ -n "$ctid" ] || ctid=$(pvesh get /cluster/nextid)
pct status "$ctid" >/dev/null 2>&1 && fail "Container ID $ctid is taken. Choose another with --ctid."

# Where the container's disk goes, and where its template is kept.
holds() { pvesm status --content "$1" 2>/dev/null | awk 'NR > 1 && $3 == "active" { print $1 }'; }
if [ -z "$storage" ]; then
  for candidate in local-lvm local-zfs; do
    holds rootdir | grep -qx "$candidate" && { storage=$candidate; break; }
  done
  [ -n "$storage" ] || storage=$(holds rootdir | head -n 1)
fi
holds rootdir | grep -qx "$storage" || fail "Storage \"$storage\" cannot hold containers. Choose one with --storage (pvesm status --content rootdir lists them)."
template_storage=$(holds vztmpl | head -n 1)
[ -n "$template_storage" ] || fail 'No storage holds container templates. Enable "Container template" on one (Datacenter → Storage).'
ip link show "$bridge" >/dev/null 2>&1 || fail "There is no network bridge \"$bridge\". Choose one with --bridge."

say "This creates container $ctid, named helprr: Debian 13, unprivileged, nesting on (for Docker),"
say "$cores cores, $memory MiB memory, a ${disk} GB disk on $storage, on $bridge by DHCP, started at boot."
if [ "$ask" = yes ] && { [ -r /dev/tty ] && ( : < /dev/tty ); } 2>/dev/null; then
  printf 'Go ahead? [Y/n] ' > /dev/tty
  IFS= read -r answer < /dev/tty || answer=
  case "$answer" in ''|[Yy]*) ;; *) say 'Stopped; nothing was changed.'; exit 0 ;; esac
fi

say 'Getting the Debian 13 template...'
pveam update >/dev/null || fail 'Could not update the template list (pveam update). Is the host online?'
template=$(pveam available --section system | awk '{ print $2 }' | grep -E '^debian-13-standard_.*_amd64\.tar\.zst$' | sort -V | tail -n 1)
[ -n "$template" ] || fail 'Proxmox lists no Debian 13 template (pveam available --section system).'
pveam list "$template_storage" | grep -q "/$template" || pveam download "$template_storage" "$template" >/dev/null

say "Creating container $ctid..."
pct create "$ctid" "$template_storage:vztmpl/$template" \
  --hostname helprr --tags helprr --ostype debian --unprivileged 1 --features nesting=1,keyctl=1 \
  --cores "$cores" --memory "$memory" --swap 512 --rootfs "$storage:$disk" \
  --net0 "name=eth0,bridge=$bridge,ip=dhcp" --timezone host --onboot 1 >/dev/null
pct start "$ctid"

# Commands in the container run with a locale it has (a host's LANG may name one it lacks).
in_ct() { pct exec "$ctid" -- env LC_ALL=C.UTF-8 LANG=C.UTF-8 "$@"; }

# From here a failure leaves the container for you to look at or remove.
trap 'printf "Error: the install stopped. Container %s is left as it is: look inside with pct enter %s, or remove it with pct stop %s && pct destroy %s\n" "$ctid" "$ctid" "$ctid" "$ctid" >&2' ERR

say 'Waiting for the container to get online...'
for _ in $(seq 1 60); do
  in_ct getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done
in_ct getent hosts deb.debian.org >/dev/null 2>&1 || { trap - ERR; fail "Container $ctid got no network on $bridge (DHCP). Remove it with pct stop $ctid && pct destroy $ctid, and check the bridge."; }

say 'Installing Docker in the container (its log: /root/docker-install.log in the container)...'
in_ct bash -c 'export DEBIAN_FRONTEND=noninteractive
  { apt-get update -qq && apt-get install -y -qq curl ca-certificates &&
    curl -fsSL https://get.docker.com | sh; } > /root/docker-install.log 2>&1' ||
  { in_ct tail -n 20 /root/docker-install.log; false; }

say 'Installing Helprr in the container...'
if [ -n "$asset_base" ]; then base=$asset_base
elif [ -n "$version" ]; then base=https://github.com/SaiBarathR/helprr/releases/download/v${version#v}
else base=https://github.com/SaiBarathR/helprr/releases/latest/download
fi
args=(--yes --dir /opt/helprr)
[ -z "$version" ] || args+=(--version "$version")
[ -z "$asset_base" ] || args+=(--asset-base "$asset_base")
# shellcheck disable=SC2016 # $0 and $@ belong to the container's shell.
in_ct bash -c 'cd /root && curl -fsSL "$0/install.sh" | sh -s -- "$@"' "$base" "${args[@]}"
trap - ERR

address=$(in_ct hostname -I | awk '{ print $1 }')
say ''
say "Helprr is running in container $ctid. Open http://$address:3050 and create your admin."
say "Its files are in /opt/helprr inside the container (pct enter $ctid)."
