---
title: What can delete files
description: Every place Helprr can remove files from your disk.
---

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
