# Helprr

Helprr is the dashboard I wanted for my own media server: one place to see what is downloading, what is available, what needs attention, and what I might want to watch next. It is a self-hosted, mobile-first Progressive Web App (PWA) that sits on top of the *arr stack, qBittorrent, Jellyfin, Prowlarr, and a few discovery/request services.

I built it because I wanted an iPhone-friendly way to manage my setup and receive proper push notifications, without paying for another subscription. I have used the iPhone PWA from the first day I created this repository, and I test every feature in the real setup before I call it done. Desktop is not an afterthought either—the larger layout is where the configurable dashboard, analytics, and admin tools are most useful.

> [!WARNING] This entire project was built with AI-assisted development—mainly Codex, Claude/Opus, and Gemini. I have tested the features I use and keep using the app every day, but this is still a personal self-hosted project. It is not affiliated with, endorsed by, or a replacement for any service it connects to.



## What to expect

Helprr is not trying to clone every setting from Sonarr, Radarr, Lidarr, qBittorrent, or Jellyfin. I have added the parts I actually need for day-to-day use and kept the rest in the original services. What you see in the app depends on which services you connect and what permissions the signed-in user has.

### Dashboard and personalization

- Separate mobile and desktop layouts, draggable widgets, and saved dashboard layouts.
- Widgets for the things I want at a glance: library counts, activity, calendar, active downloads, storage, service health, Prowlarr, Jellyfin, Seerr, cleanup, recommendations, insights, watchlists, library gaps, and shortcuts.
- Per-user layout customization, plus shared layouts for administrators.
- Theme, navigation order/visibility, carousel, refresh, timezone, and discovery-layout preferences.
- Global command palette/search (`⌘K` / `Ctrl+K`) when clicking through the sidebar is slower than just searching.



### Media, discovery, and requests

- Browse, search, filter, sort, add, monitor, tag, edit, and manage movies, TV series, music artists/albums, and files.
- TMDb discovery with the rails I use most, plus collections, people, credits, region/language controls, and filters.
- AniList anime and manga discovery, schedules, people/studio pages, library tracking, and Sonarr/Radarr mappings (including auto-mapping).
- Watchlists, scheduled reminders, calendar views, a random-watch picker, and library-gap views for when I do not know what to watch.
- Subscribe to the calendar in Apple, Google or any calendar app with private, revocable feed links, and pick a title together with the household's Tonight pick.
- Watch a Jellyfin library without leaving Helprr: in-app playback with audio/subtitle track selection, scrubbing previews, chapters, and resume from whichever device stopped last. An optional cinematic layout turns the section into a streaming-service home. Titles the browser cannot play natively are transcoded by the Jellyfin server, so it needs the headroom for that. Each person signs in to Jellyfin once so what they watch is recorded on their own Jellyfin account — progress, resume points, and history — rather than showing up unattributed.
- Seerr request visibility and workflow when Seerr is part of the setup.
- Send a magnet link or `.torrent` file to Sonarr or Radarr for one title from **Add Torrent**: Helprr checks first what Sonarr/Radarr will read from it and do, adds the title (searches off) when it is new, and follows the download through Sonarr/Radarr's own queue to the imported file under **Torrents → Linked downloads**. An advanced option picks the torrent's files before anything downloads; Sonarr/Radarr then say what each file is, and you confirm any file they are unsure of.



### Operations and server control

- Activity queue/history, wanted/missing/cutoff views with search-all, blocklist, mark as failed, grab now, bulk removal, and manual import (Sonarr, Radarr and Lidarr).
- Library cleanup with a "Leaving soon" countdown that anyone can stop with Keep, and that never deletes on its own.
- Bulk edit of quality profile, root folder and other settings, and bulk Organize.
- qBittorrent details/files, add/start/stop/delete actions, moving, tags, queue order, speed limits, alternative limits, and time-windowed bandwidth schedules.
- Rule-based queue, download, and seeding cleanup with dry runs, automation, strikes, and history.
- Prowlarr indexer status and detail, on/off switches, quick edit of priority, app profile and tags, health warnings with push notifications, search across all indexers with grab, app sync status, testing, statistics, and history.
- Jellyfin library and playback views, active sessions/devices, watch-state actions, server tasks/control, and playback analytics.
- Insights pages for checking library growth, downloads, storage, media analysis, and viewing habits without digging through several separate apps.



### Alerts, users, and administration

- Installable PWA with Web Push, device preferences, inbox/history, test notifications, digest events, and per-event controls, plus ntfy, Gotify, Apprise, webhook and email channels, and admin alerts for updates, security events and backups.
- Per-user accounts with invite links, two-step sign-in, optional sign-in at an authenticating proxy, admin/member roles, granular capability overrides, and active-session revocation.
- Multiple Sonarr, Radarr, and Lidarr instances; service health checks; custom HTTP headers for supported integrations behind an authenticating proxy.
- Database backups from Helprr (now or on a schedule), settings backup/restore, a security log and operation audit, log retention, and server-log inspection for the moments when something needs fixing.
- Personal API tokens for a read-only status API (iOS Shortcuts, Homepage, Home Assistant).



## Integrations

All integrations are optional and configured in **Settings → Instances**. Features that depend on an integration stay unavailable until it is connected. AniList is the exception: its public catalog works without connecting an account, and only list tracking needs one.


| Integration | What Helprr uses it for                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| Sonarr      | TV library, monitoring, queue/activity, discovery additions, file and episode actions |
| Radarr      | Movie library, monitoring, queue/activity, discovery additions, file actions          |
| Lidarr      | Music library, artist/album actions, monitoring, files                                |
| qBittorrent | Torrents, transfer state, file priorities, limits, cleanup, bandwidth schedules       |
| Prowlarr    | Indexers, search and grab, app sync, history, tests, and reliability stats            |
| Jellyfin    | Library/watch status, in-app playback, sessions/devices, analytics, server control    |
| TMDb        | Movie/TV discovery, metadata, collections, people, and artwork                        |
| AniList     | Anime/manga discovery, schedules, library tracking, and mappings                      |
| Seerr       | Requests and request workflow                                                         |

See the [upstream compatibility matrix](docs/upstream-compatibility.md) for the exact
versions and API contracts verified in the isolated development stack. The matrix is a
point-in-time test record, not an unsupported promise covering older or newer releases.




## Current interface

These are the hand-picked captures from my current setup. They are not mockups—the gallery shows the actual desktop and iPhone PWA experience I use for monitoring, discovery, planning, administration, and cleanup.

### Desktop

<p align="center">
  <img src="docs/screenshots/desktop-slideshow.webp" alt="Animated preview of the Helprr desktop interface, including the dashboard, discovery, media details, search, anime, calendar, and cleanup views" width="100%" />
</p>

<details>
<summary><strong>View all desktop screenshots</strong></summary>

<p align="center">
  <img src="docs/screenshots/desktop-dashboard.jpg" alt="Helprr desktop dashboard with media, download, cleanup, service-health, Jellyfin, and scheduled-task widgets" width="49%" />
  <img src="docs/screenshots/desktop-discover.jpg" alt="Helprr desktop Discover page with search, trending rails, and movie status" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-movie-details.jpg" alt="Helprr desktop movie detail page with metadata, cast, crew, and Radarr actions" width="49%" />
  <img src="docs/screenshots/desktop-command-palette.jpg" alt="Helprr desktop global command palette with library and remote discovery search scopes" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-tmdb-search.jpg" alt="Helprr desktop TMDb search results from the command palette" width="49%" />
  <img src="docs/screenshots/desktop-anime.jpg" alt="Helprr desktop Anime page with a featured title, watch progress, and planning rails" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-anime-schedule.jpg" alt="Helprr desktop Anime schedule with upcoming episodes and reminder controls" width="49%" />
  <img src="docs/screenshots/desktop-calendar-agenda.jpg" alt="Helprr desktop Calendar agenda showing scheduled episode and media releases" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-calendar-month.jpg" alt="Helprr desktop month calendar with release details and notification actions" width="49%" />
  <img src="docs/screenshots/desktop-settings.jpg" alt="Helprr desktop settings hub with instance, user, preference, service, storage, and backup controls" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/desktop-cleanup.jpg" alt="Helprr desktop cleanup dashboard with automated queue and download cleanup controls" width="49%" />
</p>












</details>

### iPhone PWA

<p align="center">
  <img src="docs/screenshots/mobile-slideshow.webp" alt="Animated preview of the Helprr iPhone PWA, including the dashboard, discovery, media details, anime, settings, and calendar views" width="320" />
</p>

<details>
<summary><strong>View all iPhone PWA screenshots</strong></summary>

<p align="center">
  <img src="docs/screenshots/mobile-dashboard.jpg" alt="Helprr iPhone dashboard with library, downloads, indexers, cleanup, and streaming widgets" width="31%" />
  <img src="docs/screenshots/mobile-anime-search.jpg" alt="Helprr iPhone AniList search results" width="31%" />
  <img src="docs/screenshots/mobile-discover.jpg" alt="Helprr iPhone Discover page with trending movies and theater releases" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-movie-details.jpg" alt="Helprr iPhone movie detail page with metadata and Radarr action" width="31%" />
  <img src="docs/screenshots/mobile-anime.jpg" alt="Helprr iPhone Anime page with featured content and watch rails" width="31%" />
  <img src="docs/screenshots/mobile-anime-schedule.jpg" alt="Helprr iPhone Anime schedule with upcoming releases and reminders" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-random-watch.jpg" alt="Helprr iPhone random watch suggestion with movie details and open action" width="31%" />
  <img src="docs/screenshots/mobile-insights-analysis.jpg" alt="Helprr iPhone Insights technical media analysis" width="31%" />
  <img src="docs/screenshots/mobile-settings.jpg" alt="Helprr iPhone settings hub with instance, user, notification, storage, logging, and download controls" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-notification-history.jpg" alt="Helprr iPhone notification history with daily summaries and health warnings" width="31%" />
  <img src="docs/screenshots/mobile-cleanup.jpg" alt="Helprr iPhone cleanup dashboard with automated and manual cleanup controls" width="31%" />
  <img src="docs/screenshots/mobile-calendar-week.jpg" alt="Helprr iPhone Calendar week view with upcoming releases" width="31%" />
</p>

<p align="center">
  <img src="docs/screenshots/mobile-calendar-month.jpg" alt="Helprr iPhone Calendar month view with release counts and daily agenda" width="31%" />
</p>










</details>

### Video demos

I recorded two short walkthroughs from the real app so you can get a better feel for it before setting anything up.

#### Desktop walkthrough

This covers the dashboard, Calendar, Discover, notifications, and the settings/admin side of the app.

https://github.com/user-attachments/assets/2969a145-719e-453a-a1e1-112cd0dd60c0

#### iPhone PWA walkthrough

This shows the installable mobile experience, day-to-day browsing, and the push-notification flow.

https://github.com/user-attachments/assets/7fa980fd-0dc6-48a8-91c1-cd35453571fd

## Install

On a Linux machine with Docker Engine and the Compose plugin (Docker Compose 2.18 or
newer):

```bash
curl -fsSL https://github.com/SaiBarathR/helprr/releases/latest/download/install.sh | sh
```

1. The installer asks for a folder, a port and a timezone, then starts Helprr and says
   where to open it.
2. Open it and create your admin account. Do it before Helprr is reachable from the
   internet.
3. Connect your apps in **Settings → Instances**: **Find apps on this network** fills
   in the ones it finds.

To look around first, the [demo](https://saibarathr.github.io/helprr/install/demo/)
runs Helprr with fake apps and invented media, beside anything else.

## Guides

Everything else is in the guides, at **<https://saibarathr.github.io/helprr/>**:

- [Install](https://saibarathr.github.io/helprr/start-here/): the installer, only the
  Compose file (Portainer and other web forms), or step by step.
- [Connect your apps](https://saibarathr.github.io/helprr/connect/): which address to
  use, and where each app's key is.
- [Phone and push](https://saibarathr.github.io/helprr/phone-and-push/) and
  [HTTPS](https://saibarathr.github.io/helprr/https/).
- [Update](https://saibarathr.github.io/helprr/maintain/update/),
  [back up and restore](https://saibarathr.github.io/helprr/maintain/backup/), and
  [troubleshooting](https://saibarathr.github.io/helprr/troubleshooting/).
- [Twitch](https://saibarathr.github.io/helprr/twitch/) and
  [YouTube](https://saibarathr.github.io/helprr/youtube/) archiving.
- [Every setting](https://saibarathr.github.io/helprr/reference/environment/),
  [privacy](https://saibarathr.github.io/helprr/reference/privacy/) (no telemetry) and
  [security notes](https://saibarathr.github.io/helprr/reference/security/).
- [Contributing](https://saibarathr.github.io/helprr/contributing/): the development
  stack and local development.

Found a vulnerability? Please report it privately: see [SECURITY.md](SECURITY.md).

## Features that can delete media files

For clarity, these are the places where Helprr can remove files from your
disk. All are permission-gated. Manual file/media/torrent/queue actions,
imports included, write success or failure to **Settings → Operation audit**,
and so does every torrent deletion and queue removal a cleaner attempts. Cleaner
runs also keep their reconciled per-item outcomes in **Cleanup → History**.
Both name who ran it: the signed-in user, or `system:cleanup-scheduler` for an
automatic run. Operation-audit records are retained for 365 days and cleanup
history for 90 days:

- **Cleanup** (queue, download, and seeding rules) — can remove downloads from
  qBittorrent *including their files* when a rule says so. Disabled by
  default; supports dry-run previews, and automatic mode is opt-in per cleaner.
- **Delete movie / series / artist / album** — every confirmation, on the
  library lists (single item or bulk selection) and on the movie, series,
  artist and album pages, offers an optional "also delete files" choice (off by
  default). Left off, the item is removed from the service and its files stay
  on disk.
- **Delete episode file / track file / movie file** — deletes that file from
  disk; the media item stays in the library as missing.
- **Activity queue removal** — optionally removes the download (and its data)
  from the download client.
- **Torrent deletion** — optionally deletes the torrent's data from disk.
- **Manual import** — moves or copies files into your library folders.
- **Linked downloads** (sent to Sonarr/Radarr from Add Torrent) — cancelling
  one can remove it from Sonarr/Radarr's queue with the torrent and its data
  (`torrents.delete`), and remove the title it added (`movies.delete` /
  `series.delete`), only while that title has no files. Choosing files before
  download imports them by copying (hardlinks when possible), so the torrent
  keeps seeding, and Helprr submits only the chosen files. An import that
  upgrades a file the title already has replaces that file: Sonarr/Radarr
  delete it, or move it to their recycle bin. It stops before an
  import when Sonarr/Radarr's **Import Extra Files** would also pick up a file
  next to them that was not chosen. A Sonarr/Radarr download client with no
  category watches every torrent and may import this one on its own when it
  finishes; Helprr warns about that before starting.

If Sonarr/Radarr has a recycle bin configured, *arr file deletions go there
instead of being removed outright. For episode-file and movie-file deletions,
Helprr records whether one was configured in the operation-audit entry.

## License

Helprr is free software, licensed under the [GNU General Public License v3.0](LICENSE).
Release history lives in [CHANGELOG.md](CHANGELOG.md).
