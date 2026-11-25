---
title: qBittorrent
description: Connect qBittorrent to Helprr.
---

**Usual port:** 8080. **Key:** your Web UI **username and password**, set in qBittorrent's **Tools → Options → Web UI → Authentication**.

**What it adds:** Torrents and their files, transfer speeds and limits, file priorities, cleanup rules and bandwidth schedules.

In **Settings → Instances**, tap **+ Add qBittorrent instance** (or **Add its key**, if
Find apps on this network found it). Enter a name (any label, such as Main), the address
([which one?](/helprr/connect/#which-address-to-use)) and the key, then **Test**, and
**Save** once it works.

Use the Web UI's address and port.

## More than one qBittorrent

Connect a second qBittorrent (a seedbox, for example) as its own instance. One is the
default: it is the one Torrents opens first and the one older links and shortcuts use.
With several, the **Filter** menu on **Torrents** has a **qBittorrent** section to switch
between them, and the line above the search names the one shown. Torrents shows one at a
time; its settings, categories, tags, log and **Add Torrent** are for the one picked
(Add Torrent can also pick it). A push about a torrent opens its own qBittorrent.

The dashboard's torrent counts and speeds, the downloads badge, Insights and global search
cover every qBittorrent. Cleanup rules and the bandwidth schedule apply to all of them; a
torrent listed by two qBittorrents at once is skipped by cleanup, since Helprr cannot tell
which copy a rule is about. Which qBittorrent Sonarr or Radarr sends a download to is set
in their own download clients.

## Queueing, seeding limits and the log

**Torrents → Settings** shows qBittorrent's **Queueing** (how many torrents download,
upload or run at once) and its global **Seeding Limits** (a ratio, a seeding time and an
inactive seeding time, and what happens when a torrent reaches one: stop it, remove it,
remove it with its files, or super seed). Everyone who sees torrents can read them; only
admins can change them, since they apply to every torrent. Choosing to remove torrents asks
first, and so does turning on or lowering a limit while torrents are removed at a limit
(those already past it go at once). While queueing is off the queue buttons on a torrent stay off.

Admins also get **Torrents → Settings → Log**: qBittorrent's own messages, newest first,
filtered by level, with **Load more** for older ones. It shows what qBittorrent keeps
since it last started. IP addresses (including your external one) are hidden, and links
are cut to their host; file paths are shown, as they say which file an error is about.
