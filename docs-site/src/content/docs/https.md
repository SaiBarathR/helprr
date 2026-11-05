---
title: HTTPS
description: Put Helprr behind HTTPS, for push notifications and for use away from home.
---

Helprr serves plain HTTP on port 3050. Browsers allow push notifications only over HTTPS
(or on `localhost`), and installing Helprr on a phone works best over it, so put Helprr
behind something that serves HTTPS for it.

## What Helprr needs from it

- **Forward to Helprr's port** (3050, or your `HELPRR_PORT`).
- **`TRUST_FORWARDED_PROTO=true`** in `.env`, so Helprr sets secure cookies and sees
  each visitor's real address for rate limits. Set it only when the proxy itself sets
  the `X-Forwarded-*` headers and removes any a visitor sent.
- **`APP_ORIGIN`** set to the HTTPS address, such as `https://helprr.example.com`, when
  you create the first admin through the proxy, or connect an AniList account. It is a scheme,
  host and optional port, with no path.

Restart Helprr after changing `.env`: `docker compose up -d --no-build --no-deps helprr`.

## Keep it private

Do not put Helprr on the open internet without understanding what that means: anyone
who finds the address can try to sign in. A private network such as Tailscale, or a
proxy that asks for its own sign-in first, keeps it to the people you choose.
