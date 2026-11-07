---
title: Privacy
description: Helprr has no telemetry. Every request it makes, and why.
---

Helprr has no telemetry. It sends no usage, analytics, crash, or installation data
anywhere, Next.js and Prisma telemetry are turned off in the image, and fonts are
bundled. Every outbound request is one of these:

- **Services you configure.** The Helprr server talks to Sonarr, Radarr, Lidarr,
  qBittorrent, Prowlarr, Jellyfin, Seerr, and TMDB at the addresses you enter.
- **Update check.** Every six hours, and on an admin visit, the server asks
  GitHub's public API for Helprr's latest release and keeps a successful answer for
  six hours (see
  [Update notices](/helprr/maintain/update/#update-notices-and-support-bundles)); after a failed check, it
  asks again an hour later or on the next admin visit. A new release is announced to
  admins once, by push and on their [notification channels](/helprr/notifications/).
- **AniList.** The server reads AniList's public API (`graphql.anilist.co`) for the
  Anime pages and to map Sonarr anime to AniList, including a nightly run that sends
  never-mapped anime titles (**Settings → Anime mappings → Nightly auto-map**
  turns it off). If an administrator connects an AniList account, it signs in
  through `anilist.co`, and Helprr reads that one account's lists and updates them
  for admins.
- **Artwork.** The server fetches most posters and backdrops from TMDB, TheTVDB,
  fanart.tv, TVmaze, AniList, and Lidarr's image host, plus any host in
  `EXTRA_ALLOWED_IMAGE_HOSTS`, and serves them through its own image proxy.
- **Push notifications.** Notifications go through the push service of each
  subscribed browser (Apple, Google, Mozilla, or Microsoft), encrypted as Web Push
  requires.
- **Notification channels.** Notifications someone chose to send to ntfy, Gotify,
  Apprise, a webhook or an email server go to the address they entered (see
  [Notifications](/helprr/notifications/)).
- **Loaded by the viewer's browser.** A few things load straight from the source
  rather than through Helprr: Seerr request posters from `image.tmdb.org`, a
  connected AniList account's avatar from AniList, trailer thumbnails from
  `img.youtube.com` (and, for an anime's Dailymotion trailer, the thumbnail AniList
  links to), and, when a trailer is played, the YouTube or Dailymotion player.

Links to IMDb, TMDB, MusicBrainz, and similar sites are fetched only when you open
them.
