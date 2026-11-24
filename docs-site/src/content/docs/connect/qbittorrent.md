---
title: qBittorrent
description: Connect qBittorrent to Helprr.
---

**Usual port:** 8080. **Key:** your Web UI **username and password**, set in qBittorrent's **Tools → Options → Web UI → Authentication**.

**What it adds:** Torrents and their files, transfer speeds and limits, file priorities, cleanup rules and bandwidth schedules.

In **Settings → Instances**, open **qBittorrent** under **Services**. Enter the address
([which one?](/helprr/connect/#which-address-to-use)) and the key, then **Test**, and
**Save** once it works.

Use the Web UI's address and port.

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
