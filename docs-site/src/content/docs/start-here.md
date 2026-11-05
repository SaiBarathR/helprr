---
title: Start here
description: What you need before you install Helprr, and which way to install it.
---

Helprr runs in Docker on a computer at home, next to the apps it talks to. You open it
in a browser, or add it to your phone's home screen to get push notifications.

## What you need

- A computer that stays on, with Docker Engine and the Compose plugin: Docker Compose
  2.18 or newer (`docker compose version`; current releases are 5.x), on a Docker Engine
  release Docker still supports.
- At least one of Sonarr, Radarr, Lidarr, qBittorrent, Prowlarr, Jellyfin or Seerr.
  Helprr finds them on your network, or you type their address and API key.
- For push notifications on an iPhone: iOS 16.4 or later (Helprr supports the latest
  two major versions, today iOS 26 and 27), and Helprr reached over HTTPS.

Podman and rootless Docker are not tested. Podman before 5.3 rejects the Compose file's
`host-gateway` entry.

## Choose how to install

| You want | Use |
| --- | --- |
| To look around first, with fake apps and nothing to set up | [Try the demo](/helprr/install/demo/) |
| The quickest install on a Linux machine | [One command](/helprr/install/one-command/) |
| To paste a Compose file into Portainer or another web form | [Only the Compose file](/helprr/install/compose-only/) |
| To see and choose every step | [Step by step](/helprr/install/manual/) |

Each one ends the same way: open Helprr, [create your admin](/helprr/first-run/), and
[connect your apps](/helprr/connect/).

:::caution[Built with AI]
Helprr was built with AI-assisted development, mainly Codex, Claude/Opus and Gemini.
Its features are tested in daily use on a real setup, but it is a personal self-hosted
project. It is not affiliated with, endorsed by, or a replacement for any
service it connects to.
:::
