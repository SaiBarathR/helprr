---
title: YouTube
description: Follow channels and playlists, and save videos to a Jellyfin library.
---

Follow channels and playlists, see new videos in a feed grouped by channel, and save
them to a Jellyfin library with chapters and captions. Saved videos can clear themselves after you watch
them. It shares the Twitch worker, and is off until you set it up.

**Settings → YouTube** has a checklist that shows what is ready and what is left.

## Set it up

1. Get a free YouTube Data API key. In the
   [Google Cloud console](https://console.cloud.google.com/), create a project, enable
   **YouTube Data API v3**, then create an API key under **Credentials**. Restrict it to
   that one API. Paste it into **Settings → YouTube**.
2. In `.env`, turn on the worker and choose a folder, then run `./scripts/update.sh`:

   ```sh
   COMPOSE_PROFILES=youtube         # or twitch,youtube for both
   YOUTUBE_LIBRARY_HOST_PATH=/path/to/youtube
   ```

   Create the folder first, owned by the worker's user (`TWITCH_PUID:TWITCH_PGID`);
   otherwise Docker creates it as root and the worker cannot write to it:
   `mkdir -p /path/to/youtube && sudo chown "$TWITCH_PUID:$TWITCH_PGID" /path/to/youtube`.
   The worker also mounts the Twitch folder (`./twitch-library` unless set), which
   `setup-env.sh` makes on a new install.

   Without a folder YouTube stays not ready, and Twitch carries on as normal. Keep it
   separate from the Twitch folder. If you want to delete from Jellyfin, add Jellyfin's
   user to the group in `TWITCH_PGID`, which this worker shares.

3. In **Settings → YouTube**, create the Jellyfin library. The path is the folder as
   Jellyfin sees it. All internet metadata is off for it; exclude it from Intro Skipper.
4. Press **+** on **YouTube → Channels**, then paste an `@handle`, a channel link or a
   playlist link. A name works too, but Google allows only 100 searches a day, so a
   search runs only when you ask.

## Downloading

The download sheet first asks YouTube what this video really offers, which usually takes a
few seconds. It then lists only those qualities and codecs, each with the size YouTube
reports, and the worker fetches exactly the copy you chose. It starts from your rules, so
by default **1080p H.264**, which plays almost everywhere. If the check fails, the sheet
says so and shows no size, and the Queue shows what was saved.

**Quality comes first**: 4K always means 4K. YouTube has no H.264 above 1080p, so 4K
uses VP9 or AV1 and the sheet tells you which. A video's shape does not matter: MKBHD's
3840×1920 counts as 4K, and a Short's 1080×1920 as 1080p.

| Codec | Pick it when |
| --- | --- |
| H.264 | You want it to just play. YouTube stops at 1080p here. |
| VP9 | You want 4K or 1440p on a player that handles it. |
| AV1 | You want smaller files on a modern player. It is often, not always, the smallest. |
| HDR | Listed only when a video has it. Keep it for HDR screens. |

In rules, **Most compatible** means H.264 up to 1080p and VP9 above that, and **Best
available** means AV1, with HDR when the video has it.

4K is large: a real one-hour episode was 2 GB at 1080p H.264 and 9.3 GB in 4K AV1.
While a video downloads, its page and the Queue show its progress and the copy being
saved. The Library shows the real resolution of each file.

**SponsorBlock** marks sponsors as chapters by default, so the video stays whole and
you can skip them. **Remove** cuts them out instead. **Captions** are saved as English
SRT when YouTube has them. A brand-new video may not have them yet.

**Re-encode to H.265** is off by default. YouTube's files are already small, so re-encoding
usually makes them bigger. Choose it only if a player needs H.265.

## Rules

Auto-download is **off** until you turn on the switch in **Settings → YouTube**. Each
channel then picks a preset under ⋯ → **Download rules**:

| Preset | What it does | Good for |
| --- | --- | --- |
| Manual | Nothing downloads by itself | Channels you pick from |
| Everything | Videos and live replays, not Shorts | A podcast you never miss |
| Long videos | Over 20 minutes, not Shorts | Skipping clips |
| Live replays only | Only the replay after a stream | A weekly live show |

Anything further, such as title words or a different quality, shows as Custom and uses
the same editor as Twitch. **Try on recent videos** shows what would download, and why.
Rules wait 3 hours after a video is published, or after a stream ends, because higher
qualities and SponsorBlock segments take time to appear. Only newly found videos
download by themselves, so one you deleted never comes back.

## Watch and clear

Off by default. In **Settings → YouTube**, choose whose watching counts and turn on
**Clear watched videos**. A video is then deleted 3 days after that person watches it.
You can change the days globally or per channel.

- Only the watched rule runs by itself. An unwatched video never clears.
- **Keep forever** always wins, and the Library shows **Clears 4 Nov** so it is never a
  surprise.
- Anything in doubt stops the sweep and shows why in Settings: Jellyfin down, the viewer
  gone, or the connection changed.
- At most 20 files clear in a sweep and 50 in a day. Going over pauses cleanup and sends
  a notification, so a bad rule cannot empty the library.
- Jellyfin's played flag is the only signal, so jumping to the end counts as watched.

Everything cleared appears in **YouTube → Library → History** with the rule that did it.

## Age-restricted videos

These need a Google account. Use a **spare account**, never your main or Premium one.
YouTube can sign an account out, and using one with yt-dlp is against its terms.

1. Open a private window and sign in to YouTube with the spare account.
2. Export the cookies for youtube.com with an extension such as *Get cookies.txt LOCALLY*.
3. Close the private window without signing out.
4. Add the file under **Settings → YouTube → Age-restricted videos**.

Helprr keeps only YouTube and Google cookies, stores them encrypted and never shows them
again. They are used only for a video that needs them, and every other video runs
without them. If the account stops working, those downloads stop at once and a
notification asks for a new export, because repeated failed logins could harm it.

## When something goes wrong

| You see | What it means | What to do |
| --- | --- | --- |
| Worker: Not ready | The worker is off, or has no YouTube folder | Check `COMPOSE_PROFILES` and `YOUTUBE_LIBRARY_HOST_PATH`, then run `./scripts/update.sh` |
| Not in Jellyfin | Jellyfin has not scanned the file yet | Wait a minute. A new library gets a full scan by itself |
| Age-restricted | The video needs the spare account | Add one, as above, then retry |
| Blocked, or too many requests | YouTube is limiting this server | Nothing. Downloads retry slowly, by the hour |
| YouTube downloads are paused | Several downloads failed the same way, so YouTube probably changed something | Helprr tries a new yt-dlp by itself. Twitch is not affected |
| Quota is used up | The daily API limit was reached | It resets at midnight Pacific time. Polling slows at 80% and stops at 95% |
| Cleanup paused | Over the limit, or Jellyfin could not be read | Read the reason in Settings, check your rules, then turn it on again |

YouTube can change how downloads work at any time, and that can break them until yt-dlp
catches up. Downloading from YouTube is against its terms, and doing so is your choice.
Keep this for personal use.
