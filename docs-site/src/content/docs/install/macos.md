---
title: Mac
description: Install Helprr on a Mac with OrbStack or Docker Desktop, using the same commands as on Linux.
---

Helprr runs on a Mac in Docker, with [the one-command installer](/helprr/install/one-command/)
or [the step-by-step install](/helprr/install/manual/). Its scripts (`install.sh`,
`backup.sh`, `update.sh`) work with the Mac's own shell and tools, in Terminal.

*Tested 2026-11-06 on an Apple silicon Mac with macOS 27.2 and OrbStack 2.2.4: the
one-command install, first run, a backup, an update, a restore over the install, and
[Only the Compose file](/helprr/install/compose-only/). Docker Desktop for Mac and the
Twitch and YouTube worker were not tested on a Mac.*

## 1. Docker

Install [OrbStack](https://orbstack.dev/) or
[Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/), and open it
once. Either gives you the `docker` command Helprr needs. Turn on its setting to start
when you log in (OrbStack: **Start at login** in its settings; Docker Desktop:
**Settings → General → Start Docker Desktop when you sign in to your computer**), or
Helprr does not come back after the Mac restarts.

Helprr runs only while the Mac is awake and Docker is running. For a Mac that serves
Helprr to your phone all day, stop it from sleeping while it is plugged in (in
**System Settings**).

## 2. Install

In Terminal:

```bash
curl -fsSL https://github.com/SaiBarathR/helprr/releases/latest/download/install.sh | sh
```

It works as on Linux: see [One command](/helprr/install/one-command/) for its options
and what it does. While the Mac's AirPlay Receiver is on (it is by default), it uses
ports 5000 and 7000, so do not choose either with `--port`.

## 3. Open Helprr

On the Mac, open `http://localhost:3050` and [create your admin](/helprr/first-run/).
On your phone, use the Mac's address on your network. The installer prints it; it is
also under **System Settings → Wi-Fi → Details** (or **Network**, for a cable), or:

```bash
ipconfig getifaddr en0
```

(`en0` is usually Wi-Fi, or the first network port; try `en1` if it prints nothing.)

For push notifications Helprr needs an `https://` address; see
[Phone and push](/helprr/phone-and-push/) and [HTTPS](/helprr/https/).

## Update, back up, restore

As on Linux: [Update](/helprr/maintain/update/) and
[Back up and restore](/helprr/maintain/backup/), from the folder Helprr is in.
