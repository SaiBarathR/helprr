---
title: Twitch
description: Follow streamers, get a push for new VODs, and save them to Jellyfin.
---

Follow streamers, get a push for new VODs, and save them into a Jellyfin library
with chapters, chat and metadata. The feed groups VODs by streamer; Grid and List are
one tap away. Saved files are re-encoded to HEVC overnight on
an Intel GPU. It is off until you configure it, and needs a separate worker container.

1. Turn on two-factor authentication on your Twitch account, then register an
   application at [dev.twitch.tv/console](https://dev.twitch.tv/console/apps):
   redirect URL `http://localhost`, client type **Confidential**. Copy the client ID
   and create a new secret.
2. Enter both in **Settings → Instances → Twitch**.
3. In `.env`, set the worker's profile and library folder, then run `./scripts/update.sh`:

   ```sh
   COMPOSE_PROFILES=twitch
   TWITCH_LIBRARY_HOST_PATH=/path/to/twitch
   # The host's render group, for the re-encode: getent group render
   TWITCH_RENDER_GID=992
   ```

   The GPU is optional. On a host without `/dev/dri` the worker still runs, shows
   **No GPU**, and leaves files as they are. On an SELinux host, run
   `setsebool -P container_use_devices 1` if the worker reports no GPU.

   Create the library folder first, owned by the worker's user. Otherwise Docker
   creates it as root, and the worker cannot write to it:

   ```sh
   mkdir -p /path/to/twitch && sudo chown "$TWITCH_PUID:$TWITCH_PGID" /path/to/twitch
   ```

   On a new install, `setup-env.sh` already set `TWITCH_PUID`, `TWITCH_PGID` and
   `TWITCH_RENDER_GID`, and made the default `./twitch-library` folder.

   The worker writes files that its group can change, so add Jellyfin's user to the
   group in `TWITCH_PGID` if you want to delete from Jellyfin. Files you delete there
   drop out of Helprr within a few minutes.

4. In **Settings → Twitch**, create the library. The path is the folder as Jellyfin
   sees it. All internet metadata is off for it; exclude it from Intro Skipper.

Auto-download is **off** by default: nothing downloads until you pick a video or
turn on the switch and write rules. Sub-only VODs and 1440p need your browser's
`auth-token` cookie, which grants full access to your Twitch account; changing your
password or signing out everywhere revokes it, and logging out does not.

A streamer's rule belongs to the streamer, not to whoever set it: while anyone is still
subscribed, it keeps downloading. Unsubscribing tells you how many others still are, and
offers an admin **Turn off auto-download**.

**Twitch → Library** lists every saved video with its size, codec and whether it was
re-encoded, how much space that saved, and whether the original is still kept. From there
you can re-encode now or tonight, restore or delete a kept original, keep a video forever,
and see what was deleted, when, and why.

Downloading from Twitch is outside its terms unless through its own features. Keep
this for personal use.
