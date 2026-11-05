---
title: Only the Compose file
description: Start Helprr from its Compose file alone, with no .env, for Portainer and other web forms.
---

Helprr starts with no `.env` at all, which suits Portainer stacks and other web forms
where you paste a Compose file:

```bash
mkdir helprr && cd helprr
curl -fsSLO https://github.com/SaiBarathR/helprr/releases/latest/download/docker-compose.yml
docker compose up -d
```

The `helprr-init` service makes the database, Redis and session passwords and the push
keys once, in the `helprr-secrets` volume, and you
[create the admin in the browser](/helprr/first-run/).

- The timezone is UTC and the port 3050 until you set `TZ` and `HELPRR_PORT`, in `.env`
  or the stack's environment.
- Back the `helprr-secrets` volume up with the database:
  [Back up and restore](/helprr/maintain/backup/) shows how.
- If you add a `.env` later, leave its passwords out: the database already uses the
  generated one.
- With the Twitch or YouTube worker, a library folder Docker has just created is given
  to the worker's user. If the worker says it cannot write to its folder, run
  `sudo chown 1000:1000 twitch-library` (or your YouTube folder; use your
  `TWITCH_PUID:TWITCH_PGID`).
