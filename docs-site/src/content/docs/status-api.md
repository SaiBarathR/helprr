---
title: Status API and tokens
description: Read what Helprr is downloading from iOS Shortcuts, Homepage and other dashboards with a personal API token.
---

Helprr has a small, read-only status API for Siri and iOS Shortcuts, dashboards
like Homepage or Homarr, Home Assistant REST sensors and home-screen widget apps
such as Scriptable. It can only read; it cannot add, remove or change anything.

## Make a token

1. Open **Settings → Sessions → API tokens** and tap **New API token**.
2. Give it a name you will recognise later, like *iPhone Shortcuts*.
3. Tick what it may read. You can only tick what you can see in Helprr yourself.
4. Choose when it expires (30 days, 90 days, a year, or never).
5. Tap **Make token** and copy it. It starts with `hlp_`. Helprr keeps only a
   fingerprint of it, so it is shown **once**: if you lose it, make a new one and
   turn the old one off.

Send it with every request in this header:

```
Authorization: Bearer hlp_…
```

## What it can read

| Ticked in Settings | Section | What you get |
| --- | --- | --- |
| Download queue | `queue`, and `/api/v1/queue` | How many items are in the Sonarr, Radarr and Lidarr queue, and the items |
| Downloading count and speeds | `downloads` | Torrents downloading in qBittorrent, and the download and upload speed |
| Free space on Radarr / Sonarr / Lidarr disks | `storage` | Free and total space on the disks of the apps you ticked |
| Next releases | `upcoming` | The next three episodes, movies or albums |
| Active Jellyfin streams | `streams` | How many people are watching right now |
| Unread alerts | `alerts` | Your unread notifications |

A token never reads more than its owner can see. If an admin later takes away
something you could see, the token stops returning it straight away, and
Settings marks it as *not used now*. If it is given back, the token returns it
again.

### `GET /api/v1/summary`

```json
{
  "version": 1,
  "generatedAt": "2026-11-07T10:00:00.000Z",
  "downloads": { "downloading": 2, "downloadSpeed": 5242880, "uploadSpeed": 131072 },
  "queue": { "total": 3 },
  "storage": {
    "freeBytes": 1200000000000,
    "totalBytes": 4000000000000,
    "disks": [{ "path": "/data", "label": null, "freeBytes": 1200000000000, "totalBytes": 4000000000000 }]
  },
  "upcoming": [
    { "type": "episode", "title": "Some Show", "subtitle": "S02E05 - Title", "date": "2026-11-08T01:00:00Z" }
  ],
  "streams": { "active": 1 },
  "alerts": { "unread": 4 }
}
```

- A section the token may not read is left out.
- A section it may read is `null` when Helprr could not read it: that app is not
  set up in Helprr, or it did not answer (for `queue`, when any Sonarr, Radarr or
  Lidarr did not). With none of Sonarr, Radarr and Lidarr set up, `queue` is 0
  and `upcoming` is empty.
- Speeds are bytes per second; sizes are bytes; dates are ISO 8601.
- The answer is at most about 10 seconds old.

### `GET /api/v1/queue`

Needs **Download queue**. The first 100 items of the combined queue, soonest to
finish first:

```json
{
  "version": 1,
  "generatedAt": "2026-11-07T10:00:00.000Z",
  "total": 1,
  "partial": false,
  "items": [
    {
      "source": "sonarr",
      "instance": "Sonarr",
      "title": "Some Show",
      "episode": "S02E05",
      "status": "downloading",
      "progress": 42,
      "sizeBytes": 1500000000,
      "sizeLeftBytes": 870000000,
      "timeLeft": "00:12:30",
      "estimatedCompletion": "2026-11-07T10:12:30Z"
    }
  ]
}
```

`source` is `sonarr`, `radarr` or `lidarr`; `episode` is null for movies and
music; `progress` is 0 to 100. `partial` is `true` when a Sonarr, Radarr or
Lidarr did not answer, so its downloads are missing from the list and the total.

### Errors

| Status | Means |
| --- | --- |
| `401` | No token, a mistyped one, or one that expired, was turned off, or whose owner can no longer sign in |
| `403` | The token is fine but may not read this (or its owner no longer can) |
| `429` | Too many requests; wait the number of seconds in `Retry-After` |
| `500`, `502` | Helprr could not put the answer together; try again shortly |
| `503` | Helprr cannot check the token right now; try again shortly |

These two paths are the only ones a token opens, and only with `GET`. Sent to
any other address in Helprr, a token is refused.

## iOS Shortcuts: "What's downloading?"

This shortcut asks Helprr for the queue and reads it out, so you can ask Siri
*"What's downloading?"*. Make a token with **Download queue** ticked first.

1. In **Shortcuts**, tap **+** and name the shortcut **What's downloading**.
2. Add **Get Contents of URL**. Set the URL to
   `https://helprr.example.com/api/v1/queue` (your Helprr address). Tap **Show
   More**, leave **Method** on **GET**, and under **Headers** add a header with
   key `Authorization` and value `Bearer hlp_…` (your token).
3. Add **Get Dictionary Value**: get **Value** for `items` in **Contents of URL**.
4. Add **Repeat with Each** item in **Dictionary Value**. Inside it:
   1. Add **Get Dictionary Value**: **Value** for `title` in **Repeat Item**.
   2. Add **Get Dictionary Value**: **Value** for `progress` in **Repeat Item**.
   3. Add **Text**: *(title value)*, *(progress value)* percent.
5. After **End Repeat**, add **Combine Text**: combine **Repeat Results** with
   **New Lines**.
6. Add **If**: **Combined Text** **has any value**. Inside it add **Show Result**
   with **Combined Text**; under **Otherwise** add **Show Result** with the text
   *Nothing is downloading*.

Run it once from the Shortcuts app and allow it to connect to your Helprr address.
Then say *"Hey Siri, what's downloading"*. To show it on the Home Screen, add the
Shortcuts widget. For a quick total instead, use `/api/v1/summary` and read
`queue` → `total`.

## Homepage

[Homepage](https://gethomepage.dev/)'s **customapi** widget can show the summary
on your dashboard. Make a token with **Downloading count and speeds**,
**Download queue** and **Unread alerts** ticked, then add this to
`services.yaml`:

```yaml
- Media:
    - Helprr:
        href: https://helprr.example.com
        description: Downloads
        widget:
          type: customapi
          url: https://helprr.example.com/api/v1/summary
          refreshInterval: 30000
          headers:
            Authorization: Bearer hlp_…
          mappings:
            - field:
                downloads: downloading
              label: Downloading
              format: number
            - field:
                downloads: downloadSpeed
              label: Speed
              format: bytes
              suffix: /s
            - field:
                queue: total
              label: Queue
              format: number
            - field:
                alerts: unread
              label: Alerts
              format: number
```

Homepage fetches the address from its own server, so the URL must be one that
the Homepage container can reach. You can also keep the token in a Homepage
environment variable (`{{HOMEPAGE_VAR_HELPRR_TOKEN}}`) instead of in the file.

## Keep tokens safe

- **A token is a password for what it reads.** Anyone who has it can read those
  things until it expires or you turn it off. Do not paste it into a URL, a chat
  or a screenshot. Shortcuts you share include the token in their headers.
- **Use HTTPS** when a token travels outside your home network. Over plain
  `http://` anyone on the network path can read it.
- **One token per device or app**, with only what it needs ticked, and an expiry.
  Then turning one off affects only that one.
- **Turn off** a token you no longer use in **Settings → Sessions → API tokens**.
  It is refused from its next request.
- **Changing your password ends every token you have**, and so does an admin
  resetting your password, disabling your account or changing its Jellyfin link.
  **Revoke all other sessions** ends them too. Make new ones afterwards.
  Turning off two-step sign-in does not end tokens: turn them off here too.
- **A session from proxy sign-in can't make tokens**: a token works straight against
  Helprr, around the proxy. Sign in with your Helprr password to make one.
- Admins can see in **Settings → Operation audit → Security** when a token was made
  or turned off, and the first time one was used from a new network. Helprr can
  tell networks apart only behind a [reverse proxy it trusts](/helprr/https/);
  without one, it records only a token's first use.
- Helprr never writes a token to its logs. A reverse proxy in front of Helprr may
  log request headers if it is set up to; most do not by default.
