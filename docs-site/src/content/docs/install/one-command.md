---
title: One command
description: Install Helprr on a Linux machine with one command.
---

On a Linux machine with Docker Engine and the Compose plugin:

```bash
curl -fsSL https://github.com/SaiBarathR/helprr/releases/latest/download/install.sh | sh
```

It asks for a folder (`./helprr`), a port (3050) and a timezone (this computer's); without
a terminal (over SSH without `-t`, or from cloud-init) it asks nothing and uses those.
Then it:

1. downloads the release files and checks each against the release's `SHA256SUMS`,
2. creates `.env` with new secrets,
3. starts Helprr and waits until it is ready,
4. says where to open it and how to sign in. If the address it prints is not the one you
   reach the machine at (a VM, or a machine on several networks), use the machine's own
   address on your network, with the same port.

It never installs Docker and never overwrites an existing install.

## Read it first

To read the script before running it, and check it against the release's checksums:

```bash
base=https://github.com/SaiBarathR/helprr/releases/latest/download
curl -fsSLO "$base/install.sh" && curl -fsSLO "$base/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS
sh install.sh
```

The checksums catch a broken or mixed download. They come from the same release, so
they do not protect against a compromised release.

## Options

| Option | What it does |
| --- | --- |
| `--dir DIR` | Install folder (default `./helprr`) |
| `--port PORT` | Port to open Helprr on (default 3050) |
| `--tz ZONE` | IANA timezone, such as `Europe/Berlin` (default: this computer's) |
| `--version X.Y.Z` | A specific release (default: the latest) |
| `--no-start` | Set everything up, but do not start Helprr |
| `--admin-password` | Create the admin from a generated `APP_PASSWORD`, instead of in the browser |
| `--yes` | Ask nothing; use the defaults and the options given |

Options go after `sh -s --` when the script is piped:

```bash
curl -fsSL https://github.com/SaiBarathR/helprr/releases/latest/download/install.sh | sh -s -- --port 8080 --dir ~/apps/helprr
```

It prints the timezone it chose and where it found it; if that is wrong, change `TZ` in
`.env` later.

## Next

Open the address it printed and [create your admin](/helprr/first-run/).
