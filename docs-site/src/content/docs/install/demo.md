---
title: Try the demo
description: Run Helprr with fake apps and invented shows, films and music, beside anything else.
---

The demo runs Helprr with fake Sonarr, Radarr, Lidarr, qBittorrent, Prowlarr, Jellyfin
and Seerr, full of invented shows, films and music. Nothing in it is real, there is
nothing to set up, and it has its own names, port and data, so it runs beside a real
install without touching it.

```bash
mkdir helprr-demo && cd helprr-demo
curl -fsSLO https://raw.githubusercontent.com/SaiBarathR/helprr/main/docker-compose.demo.yml
docker compose -f docker-compose.demo.yml up -d
```

Open <http://localhost:3060> and sign in as `demo` with the password
`helprr-demo-password`. The sign-in page shows it too.

- Nothing can be changed in the fake apps: anything that would write says the demo is
  read-only.
- TMDB is not connected, so Discover and the For You page ask for it. The Anime pages
  work when the computer has internet.
- Every page says **Demo: fake data. It resets when removed.**

## Remove it

```bash
docker compose -f docker-compose.demo.yml down       # removes the demo and its data
docker compose -f docker-compose.demo.yml down -v    # also removes its generated passwords
```

:::danger[This computer only]
The demo account is public. The demo answers on this computer only (`127.0.0.1`): never
expose its port or put it behind a proxy.
:::

To use another port, set `HELPRR_DEMO_PORT`; to pick the image, `HELPRR_DEMO_VERSION`
(it needs a release that has the demo).
