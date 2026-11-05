---
title: Proxmox VE
description: Install Helprr on Proxmox VE in a container of its own, with one command on the host.
---

One command on your Proxmox VE host makes a container for Helprr, installs Docker in it,
and installs Helprr there with [the one-command installer](/helprr/install/one-command/).

*Tested 2026-11-05 with Proxmox VE 9.2 (LVM-thin storage): install, first run, a restart
of the host, running it again, an update, Helprr's own backup, and a Proxmox backup and
restore of the container.*

## Install

In the host's shell, as root (in the web interface: select the node, then **Shell**):

```bash
bash -c "$(curl -fsSL https://github.com/SaiBarathR/helprr/releases/latest/download/proxmox-lxc.sh)"
```

It says what it will make and asks before it starts. Then, in two or three minutes, it:

1. downloads Proxmox's Debian 13 container template, if you do not have it yet,
2. creates the container: named `helprr`, unprivileged, with nesting on (Docker needs
   it), 2 cores, 2 GiB of memory, an 8 GB disk, its address by DHCP on `vmbr0`, the
   host's timezone, and started when the host starts,
3. installs Docker in it, from Docker's own install script,
4. installs Helprr in `/opt/helprr` inside it, checking every file against the release's
   checksums,
5. prints Helprr's address. Open it and [create your admin](/helprr/first-run/).

It changes nothing else on the host. If a container named `helprr` already exists, it
stops before changing anything.

Its options, after the command (`bash -c "$(curl ...)" -- --disk 16`, or on a downloaded
copy):

| Option | Default |
| --- | --- |
| `--ctid ID` | The next free ID |
| `--storage NAME` | `local-lvm`, else `local-zfs`, else the first storage that holds containers |
| `--bridge NAME` | `vmbr0` |
| `--disk GB` | `8` |
| `--cores N` | `2` |
| `--memory MIB` | `2048` |
| `--version X.Y.Z` | The latest release |
| `--yes` | Ask nothing |

## Read it first

To read the script before running it, and check it against the release's checksums:

```bash
base=https://github.com/SaiBarathR/helprr/releases/latest/download
curl -fsSLO "$base/proxmox-lxc.sh" && curl -fsSLO "$base/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS
less proxmox-lxc.sh
bash proxmox-lxc.sh
```

## Inside the container

Helprr runs there as on any Linux machine with Docker. From the host's shell, `pct enter`
followed by the container's ID gives you a shell in it; Helprr is in `/opt/helprr`.

- **Update**: `cd /opt/helprr && ./scripts/update.sh`, which backs up first. See
  [Update](/helprr/maintain/update/).
- **Back up**: `cd /opt/helprr && ./scripts/backup.sh`, which writes the database and
  Helprr's passwords and keys to `/opt/helprr/backups`. See
  [Back up and restore](/helprr/maintain/backup/).
- **Settings**: in `/opt/helprr/.env`, as the [environment reference](/helprr/reference/environment/)
  describes; then `docker compose up -d`.

Proxmox's own backups of the container hold everything too: select the container, then
**Backup → Backup now**, or a scheduled job under **Datacenter → Backup** (the command is
`vzdump` followed by the ID). Restoring one over the container (with the container
stopped) brings Helprr back as it was.

Then [connect your apps](/helprr/connect/), and for push notifications on your phone, see
[Phone and push](/helprr/phone-and-push/) and [HTTPS](/helprr/https/).

## Remove

To remove Helprr and everything it kept, back up anything you want first, then on the
host: `pct stop` and `pct destroy`, each followed by the container's ID.
