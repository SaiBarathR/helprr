---
title: Notifications
description: Get Helprr's notifications through ntfy, Gotify, Apprise, a webhook or email, as well as push.
---

Push needs the installed app on iPhone and a subscribed browser everywhere else (see
[Phone and push](/helprr/phone-and-push/)). **Settings → Notifications → Other
channels** sends the same notifications somewhere else as well: the ntfy or Gotify
app, any service Apprise reaches, Home Assistant or another automation, or an email
inbox. It also keeps alerts coming when push on a phone goes quiet.

Each person adds their own channels and picks which events go to each one, from the
events they already receive. Channels follow that person's quiet hours, and grouped
bursts arrive as one message, the same as push. Service down and restored, health
warnings and security alerts still come through during quiet hours. Quiet hours, the
calendar feed and other times worked out for you follow **Your time zone** in
**Settings → Preferences** (by default the same as the server's).

**Send test** sends a test message to one channel and says how it went. When a channel
keeps failing, Helprr waits longer between tries (5 minutes, doubling up to 6 hours)
until it works again, and shows the last error under the channel. Editing the
channel's settings starts it afresh.

Secrets (topics, tokens, passwords, webhook addresses) are stored encrypted and are
never shown again after you save: leave a secret field empty to keep it. Changing a
channel's server address needs its secrets entered again. An admin sees only their own
channels, plus a count of everyone's.

Admins' channels can send to addresses on your network or the internet. Everyone
else's can send to internet addresses only, not to the local network (so a member's
ntfy channel can use `ntfy.sh` but not a server at home). No channel ever sends to
link-local or cloud metadata addresses (such as `169.254.169.254`), and Helprr does not
follow a redirect to another host.

## ntfy

Install the ntfy app on your phone and subscribe to a topic. In Helprr, add an
**ntfy** channel with the server (`https://ntfy.sh`, or your own) and the same topic.
Anyone who knows a topic on a public server can read it, so pick one that is hard to
guess. For a protected topic, enter an access token, or a user name and password.

When `APP_ORIGIN` is set, tapping the notification opens the item in Helprr.

## Gotify

In Gotify, open **Apps**, create an application for Helprr and copy its token. In
Helprr, add a **Gotify** channel with the server's address and that token, and choose
a priority.

## Apprise

Run the [Apprise API](https://github.com/caronc/apprise-api) and save your Apprise
URLs under a configuration key. In Helprr, add an **Apprise** channel with the API's
address (for example `http://apprise:8000`) and that key (`apprise` by default).
**Tags** sends only to the saved URLs with one of those tags.

## Webhook

A **Webhook** channel POSTs each notification as JSON:

```json
{
  "source": "helprr",
  "event": "imported",
  "title": "Imported: Dune",
  "body": "Dune (2021) was imported",
  "url": "https://helprr.example.com/movies/12",
  "path": "/movies/12",
  "metadata": { "source": "radarr", "movieId": 12 },
  "sentAt": "2026-11-07T10:00:00.000Z"
}
```

`url` is set only when `APP_ORIGIN` is. The address is kept like a password, since a
Home Assistant webhook keeps its key in it. To let the receiver check that a call came
from Helprr, enter a **secret header value**: it is sent in the `X-Helprr-Secret`
header, or the header name you choose.

For Home Assistant, add an automation with a **Webhook** trigger, copy its address
(`http://homeassistant.local:8123/api/webhook/…`) into Helprr, and read the fields as
`trigger.json.title`, `trigger.json.body` and `trigger.json.event`.

## Email

Add an **Email** channel with your SMTP server, its port, the encryption (STARTTLS on
port 587, or TLS on 465), and the sender and recipient addresses. Enter a user name and
password if the server needs them; use an app password where your provider offers one.
Helprr never sends email without encryption.

## Admin events

Admins can also get these, by push or on a channel:

- **Helprr update available**, once per new release. Helprr checks GitHub's releases
  every six hours for it.
- **Security alert**: an admin signed in from a browser or device not seen before
  (judged by the browser's name, so treat it as a hint, not proof),
  10 or more failed sign-ins within 10 minutes, or two-step sign-in turned off for an
  account. Each one links to **Settings → Operation audit → Security**.

## Backups

**Settings → Backup** exports each person's channels with their account. Secrets are
included only when **Include API keys / tokens** is on, and then only for your own
channels: never another person's. Importing a file without them keeps the secrets
already saved for the same address; a channel that has none yet is skipped, and the
import says which, so it can be set up again.
