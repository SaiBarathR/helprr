---
title: HTTPS
description: Put Helprr behind HTTPS, for push notifications and for use away from home.
---

Helprr serves plain HTTP on port 3050. Browsers allow push notifications only over HTTPS
(or on `localhost`), and installing Helprr on a phone works best over it, so put Helprr
behind something that serves HTTPS for it.

## Choose one

| You want | Use | Who can reach Helprr |
| --- | --- | --- |
| The simplest, private, nothing to open on your router | [Tailscale Serve](#tailscale-serve) | Only devices on your tailnet |
| Your own domain, with nothing to open on your router | [Cloudflare Tunnel](#cloudflare-tunnel) | Anyone with the address |
| Your own domain, with Caddy on the same machine | [Caddy](#caddy) | Anyone who can reach the machine |
| Your own domain, with a web screen to set it up | [Nginx Proxy Manager](#nginx-proxy-manager) | Anyone who can reach the machine |

Each recipe uses Helprr's default port, 3050; use yours if you changed it. After changing
`.env`, restart Helprr: `docker compose up -d --no-build --no-deps helprr`.

## What Helprr needs from it

- **`APP_ORIGIN`** set to the HTTPS address, such as `https://helprr.example.com`, when
  you create the first admin through the proxy, or connect an AniList account. It is a
  scheme, host and optional port, with no path.
- **`TRUST_FORWARDED_PROTO=true`** only behind a proxy that replaces the
  `X-Forwarded-For` and `X-Forwarded-Proto` headers a visitor sends. Helprr then marks
  its sign-in cookie secure and limits sign-in attempts by each visitor's real address.
  Behind a proxy that passes a visitor's headers on, a visitor could choose the address
  Helprr sees, so leave it off there: Helprr still works, and still limits sign-in
  attempts per username. Each recipe below says which kind it is.
- **The proxy as the only way in from the internet.** At home, behind your router, only
  devices on your network reach Helprr's port directly, which is fine for most homes. On
  a machine with a public IP address (a VPS), whichever proxy you use, make the port
  answer only that machine: otherwise anyone can go around the proxy (and any sign-in it
  asks for) to plain HTTP on the port, and, with `TRUST_FORWARDED_PROTO` on, send
  forged headers too. Docker's published ports go around firewalls such as ufw, so do it
  in `.env`: change the `HELPRR_PORT` line (the installer adds one at the end if you
  chose a port; the last one wins), or add one, to `127.0.0.1:` followed by your port,
  such as `HELPRR_PORT=127.0.0.1:3050`. Then the first admin is created at the proxy's
  address (with `APP_ORIGIN` set).

  A proxy or app that runs in Docker itself (Nginx Proxy Manager, `cloudflared` in a
  container, Sonarr, Radarr) cannot reach the host's `127.0.0.1`. Add Helprr's Docker
  network to its Compose file, and point it at `http://helprr:3050`. Compose names the
  network after Helprr's folder: `helprr_helprr-net` for a folder called `helprr`
  (`docker network ls` shows it). Use your service's name, and keep its existing networks
  in the list (`default` if it lists none), so it keeps its own:

  ```yaml
  services:
    nginx-proxy-manager:   # your service's name
      networks: [default, helprr]
  networks:
    helprr:
      name: helprr_helprr-net
      external: true
  ```

  Declared this way, the connection lasts when that container is updated or recreated.
  Start Helprr first: while Helprr is removed (`docker compose down` in its folder), that
  stack will not start until you take these lines out again. The container then shares a
  network with Helprr's database and Redis, which keep their own passwords.

  A container with `network_mode: host` counts as on the machine itself: it reaches
  `http://127.0.0.1:3050` as it is, so do not add the network to it (Compose refuses
  both together).

  Sonarr and Radarr fetch `.torrent` files through the proxy's address (`APP_ORIGIN`),
  at `http://helprr:3050` when on Helprr's network, or at `http://127.0.0.1:3050` when
  installed on the machine itself (set `ARR_CALLBACK_ORIGIN` to it); otherwise use
  magnet links.
- **`ARR_CALLBACK_ORIGIN`**, if you add torrents to Sonarr or Radarr by `.torrent` file:
  they fetch the file from Helprr, at `APP_ORIGIN` unless this is set, and they often
  cannot reach a `*.ts.net` or public address. Set it to Helprr's address on your
  network, such as `http://192.168.1.10:3050`, or, with the port on `127.0.0.1`, an
  address from the bullet above. Magnet links need neither.
- **Compression**: nothing to set. Helprr gzips its pages and its data
  (`application/json`) itself, and a proxy passes that on. A proxy that compresses on its
  own should list `application/json` among its types too, for any answer it asks Helprr
  for uncompressed.

## Tailscale Serve

Tailscale puts your devices on a private network (a tailnet), and Serve gives Helprr an
HTTPS address on it, such as `https://helprr-box.example-tailnet.ts.net`, with a real
certificate. Only your devices can open it.

1. Install Tailscale on Helprr's machine and on your phone, and sign both in to the same
   tailnet.
2. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS
   Certificates**.
3. On Helprr's machine:

   ```bash
   sudo tailscale serve --bg http://127.0.0.1:3050
   ```

   `tailscale serve status` shows the address. Open it on your phone, with Tailscale
   connected.
4. In `.env`, set `TRUST_FORWARDED_PROTO=true` (Serve replaces the forwarded headers),
   and `APP_ORIGIN` to the address if you still have to create the admin, or connect
   AniList. Restart Helprr.

To stop serving: `sudo tailscale serve --https=443 off` (or `sudo tailscale serve reset`,
which removes everything Serve was serving).

*Tested 2026-11-05 with Tailscale 1.104.5: Helprr behind Serve, a sent `X-Forwarded-For`
replaced.*

## Cloudflare Tunnel

`cloudflared` on Helprr's machine connects out to Cloudflare, and Cloudflare serves
Helprr at a name on your domain, with its certificate. Nothing opens on your router, but
the address is public: anyone who finds it reaches Helprr's sign-in page.

You need a domain whose DNS is on Cloudflare.

1. In the Cloudflare dashboard, open **Networking → Tunnels**, select **Create a tunnel**,
   name it, and run the installation command it shows on Helprr's machine.
2. In the tunnel, open **Routes → Add route → Published application**: enter a subdomain
   (such as `helprr`), choose your domain, and set **Service URL** to
   `http://localhost:3050`.

   If you run `cloudflared` with a config file instead, the same thing is one ingress
   rule:

   ```yaml
   ingress:
     - hostname: helprr.example.com
       service: http://localhost:3050
     - service: http_status:404
   ```

3. In `.env`, set `APP_ORIGIN=https://helprr.example.com`, and leave
   `TRUST_FORWARDED_PROTO` off: Cloudflare keeps the `X-Forwarded-For` a visitor sends.
   Restart Helprr.

To keep strangers away from the sign-in page, put
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) in
front of the address, so Cloudflare asks for its own sign-in first. Watching video in
Helprr streams it through Cloudflare; check that your Cloudflare plan's terms allow that.

*Tested 2026-11-05 with cloudflared 2026.10.7 and a config-file tunnel: Helprr serves
through it daily, and a sent `X-Forwarded-For` arrives first in the header. The dashboard
steps follow Cloudflare's documentation of that date and were not part of the test.*

## Caddy

Caddy gets and renews a certificate for your domain by itself. Point the domain's DNS at
your public IP address, and forward ports 80 and 443 on your router to Helprr's machine.

1. [Install Caddy](https://caddyserver.com/docs/install) on Helprr's machine.
2. Put this in its Caddyfile (usually `/etc/caddy/Caddyfile`), with your domain:

   ```caddy
   helprr.example.com {
     reverse_proxy localhost:3050
   }
   ```

3. `sudo systemctl reload caddy`.
4. In `.env`, set `APP_ORIGIN=https://helprr.example.com` and
   `TRUST_FORWARDED_PROTO=true` (Caddy replaces the forwarded headers). Restart Helprr.

For a name only your home network knows, Caddy can make its own certificate
(`tls internal`), but every phone must then install and trust Caddy's root certificate
by hand. [Tailscale Serve](#tailscale-serve) is simpler for that.

*Tested 2026-11-05 with Caddy 2.11.8 in a virtual machine, with Caddy's own certificate:
sign-in sets a secure cookie, and a sent `X-Forwarded-For` is replaced. The public
certificate step needs a real domain and was not part of the test.*

## Nginx Proxy Manager

Nginx Proxy Manager sets up proxies and Let's Encrypt certificates from a web page. Point
your domain's DNS at your public IP address, and forward ports 80 and 443 on your router
to its machine.

1. In Nginx Proxy Manager, open **Hosts → Proxy Hosts → Add Proxy Host**:
   - **Domain Names**: `helprr.example.com`
   - **Scheme**: `http`; **Forward Hostname / IP**: Helprr's machine's IP address (or
     `helprr`, if Nginx Proxy Manager is connected to Helprr's Docker network, as above);
     **Forward Port**: `3050`
2. On the **SSL** tab, request a new Let's Encrypt certificate and turn on **Force SSL**.
3. In `.env`, set `APP_ORIGIN=https://helprr.example.com`, and leave
   `TRUST_FORWARDED_PROTO` off: Nginx Proxy Manager passes on the forwarded headers a
   visitor sends. Restart Helprr.

*Tested 2026-11-05 with Nginx Proxy Manager 2.16.0 in a virtual machine, over plain HTTP
from a private address: Helprr answers through the proxy host, and a sent
`X-Forwarded-For` and `X-Forwarded-Proto` are passed on. The Let's Encrypt step needs a
real domain and was not part of the test.*

## Sign in once, at the proxy

A proxy that asks for its own sign-in (Authelia, Authentik) can also sign you in to
Helprr, so you sign in once. The proxy names the signed-in user in a header, and sends a
secret in a second header that proves the request came through it. Helprr signs in the
existing, active Helprr account with exactly that username, including upper and lower
case, as at its own sign-in. It never creates an account: add each person in
**Settings → Users** first, with the same username they have at the proxy. A disabled
account, or one whose invite is not accepted yet, is refused. Use plain-ASCII usernames:
headers carry other characters unreliably, so such a name never matches.

Two things are required, or anyone can sign in as anyone:

- **The proxy must strip any client-sent copy of both headers.** It must set the user
  header only from its own sign-in, and replace (not add to) the secret header. Each
  example below does.
- **Helprr's port must not be reachable except through the proxy.** Put the proxy on
  the same machine or Docker network, and the port on `127.0.0.1` (see
  [What Helprr needs from it](#what-helprr-needs-from-it)). The secret travels in plain
  HTTP between the proxy and Helprr.

Make the proxy ask for its sign-in on every Helprr address: a rule that lets some paths
through without it (Authelia's `bypass`, for example) sends those requests with no user,
and Helprr then treats a session made this way as signed out.

Then, in `.env`, with a secret from `openssl rand -hex 32`:

```sh
HELPRR_TRUSTED_AUTH_HEADER=Remote-User
HELPRR_TRUSTED_AUTH_SECRET=paste-the-generated-value
# Optional; this is the default:
# HELPRR_TRUSTED_AUTH_SECRET_HEADER=X-Helprr-Proxy-Secret
```

Restart Helprr. The log says `Trusted-header sign-in is on`, or why it is off. Opening
Helprr through the proxy then goes straight in; Helprr's own sign-in page is still there
for anyone who reaches it some other way.

- **Two-step sign-in is skipped** for this sign-in: the proxy's own sign-in is the second
  factor, so turn on two-step sign-in at the proxy.
- **Signing out at the proxy signs you out of Helprr** on your next tap, and so does
  someone else signing in to the proxy on the same browser: a session made this way lasts
  only while the proxy still names the same user. Signing out of Helprr alone does not
  sign you out of the proxy, so Helprr's sign-in page signs you straight back in.
- Sign-ins show in **Settings → Operation audit → Security** as *through the sign-in
  proxy*. A request with a wrong secret is recorded and counts toward the sign-in limits,
  like a wrong password: about 30 in 15 minutes pause every sign-in, password ones too.
  When you change the secret, change it in the proxy and in `.env` together.

The examples use Authelia's `Remote-User` header; Authentik's proxy outpost sends
`X-authentik-username`. Replace `the-secret` with your `HELPRR_TRUSTED_AUTH_SECRET`.

**Caddy** with Authelia. Caddy normally runs directives in its own order, which would
remove the header after `forward_auth` sets it; inside `route` they run as written, so a
copy a visitor sent is dropped first, then Authelia's answer is copied in, and
`header_up` replaces any sent secret:

```caddy
helprr.example.com {
  route {
    request_header -Remote-User
    request_header -X-Helprr-Proxy-Secret
    forward_auth authelia:9091 {
      uri /api/authz/forward-auth
      copy_headers Remote-User
    }
    reverse_proxy localhost:3050 {
      header_up X-Helprr-Proxy-Secret "the-secret"
    }
  }
}
```

**Traefik** with Authelia, in a dynamic configuration file (`forwardAuth` removes a sent
`Remote-User` and sets Authelia's; `customRequestHeaders` replaces a sent secret):

```yaml
http:
  middlewares:
    authelia:
      forwardAuth:
        address: http://authelia:9091/api/authz/forward-auth
        authResponseHeaders:
          - Remote-User
    helprr-proxy-secret:
      headers:
        customRequestHeaders:
          X-Helprr-Proxy-Secret: "the-secret"
  routers:
    helprr:
      rule: Host(`helprr.example.com`)
      middlewares: [authelia, helprr-proxy-secret]
      service: helprr
  services:
    helprr:
      loadBalancer:
        servers:
          - url: http://helprr:3050
```

**nginx** with Authelia, using the `auth_request` locations from
[Authelia's nginx guide](https://www.authelia.com/integration/proxies/nginx/).
`proxy_set_header` replaces a header a visitor sent under the same name. A location with
its own `proxy_set_header` lines stops inheriting the server's, so the forwarded headers
are set here too (`X-Forwarded-For` replaced, not appended, as `TRUST_FORWARDED_PROTO`
needs):

```nginx
location / {
  auth_request /internal/authelia/authz;
  auth_request_set $user $upstream_http_remote_user;
  proxy_set_header Remote-User $user;
  proxy_set_header X-Helprr-Proxy-Secret "the-secret";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://127.0.0.1:3050;
}
```

Cloudflare Access sends no username header Helprr can trust on its own, so it is not one
of the proxies this works with yet.

*Not yet tested with a real proxy: the examples follow each proxy's documentation as of
2026-11-07, and Helprr's side is covered by its automated tests.*

## Keep it private

Anyone who can reach Helprr's address can try to sign in. Tailscale keeps it to your own
devices. With a public address, a proxy that asks for its own sign-in first (Cloudflare
Access, Authelia) keeps strangers away from Helprr's; use long passwords either way, turn
on [two-step sign-in](/helprr/people/#two-step-sign-in) for admins, and keep Helprr and
its apps up to date.
