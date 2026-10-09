# Upstream compatibility

Last verified: **2026-10-07**, from Helprr's isolated development stack on the
Helprr 1.6.0 release commit. Every product version below was read back that day
through Helprr's own connection test, and every integration answered a live read.
Five services had moved to a newer version since the previous check, so their rows
now name both versions and say which evidence belongs to which; see
[2026-10-07 re-verification](#2026-10-07-re-verification) for what was and was not
re-run.

Earlier checks: the first matrix dates from **2026-07-14** (Helprr 1.1.0). The
`JELLYFIN` row was re-verified on **2026-08-28** for the in-app Watch and playback
work; see [Jellyfin in-app playback](#jellyfin-in-app-playback). Jellyfin
**12.0.0** was checked on **2026-09-13** with the qualification limits below.

## How to read this matrix

The versions below are exact, point-in-time reference versions that Helprr has
actually connected to. They are not minimums, maximums, or promises that every
release between two versions is compatible. The API contract column records the
namespace Helprr currently calls; it must not be read as a supported product-version
range.

No minimum or maximum upstream version is claimed yet. A different patch, minor, or
major version may work when it preserves the same API, but it remains unqualified until
the affected Helprr flows are tested. Unversioned hosted APIs can change without a
product release number.

## Verified reference versions

| Service type | Integration | API contract used by Helprr | Exact version verified | Verification evidence |
| --- | --- | --- | --- | --- |
| `SONARR` | Sonarr | REST `/api/v3` | `4.0.20.3014` (two instances); `4.0.19.2979` (earlier qualification) | On `4.0.20.3014`: system-status probe; live series, queue, history, and wanted reads; unmatched-download queue listing, manual-import scan, series re-evaluation, and manual import (see below). On `4.0.19.2979`: live cleanup, file, and whole-series operations |
| `RADARR` | Radarr | REST `/api/v3` | `6.4.4.10685` (two instances); `6.2.1.10461` (earlier qualification) | On `6.4.4.10685`: system-status probe; live movie-list and quality-profile reads; paged reads checked. On `6.2.1.10461`: live cleanup and whole-movie operations |
| `LIDARR` | Lidarr | REST `/api/v1` | `3.1.2.4913` | Authenticated system-status probe; live track-file and album operations. Artist-list and health reads re-run 2026-10-07 |
| `QBITTORRENT` | qBittorrent | Web API `/api/v2` | `v5.1.4` | Authenticated app-version probe; live queue, cleanup, keep-data, and delete-data operations. Torrent-list, transfer-summary, and category reads re-run 2026-10-07 |
| `PROWLARR` | Prowlarr | REST `/api/v1` | `2.5.2.5491`; `2.4.0.5397` (earlier qualification) | Authenticated system-status probe on both; live indexer-list and status reads on `2.5.2.5491` |
| `JELLYFIN` | Jellyfin | Unversioned REST routes such as `/System/Info`, `/Items`, `/Items/{id}/PlaybackInfo`, `/Videos/{id}/…`, `/Audio/{id}/…`, `/Sessions/Playing*`, `/Users/AuthenticateByName`, `/UserItems/{id}/UserData` | `12.2.0`; `12.0.0` and `10.11.11` (earlier qualifications) | On `12.2.0`: catalog reads, playback negotiation, HLS and subtitle delivery through the media proxy, member-attributed sessions under a new device id, resume, proxy refusals, and Playback Reporting reads; in-player direct play, remux, transcode, track and quality changes, libass, burned-in PGS, and Live TV on 2026-10-08 (see below). On `12.0.0`: live v12 API, catalog, and Chrome HLS playback checks with legacy authorization disabled (see below) |
| `TMDB` | TMDB | Hosted API `v3` | No product version exposed | Authenticated `/configuration` request succeeded; Discover read re-run 2026-10-07 |
| `ANILIST` | AniList | Hosted GraphQL API at `graphql.anilist.co` | No product version exposed | OAuth-authenticated Viewer query succeeded; Anime home read re-run 2026-10-07 |
| `SEERR` | Seerr | REST `/api/v1` | `3.4.1`; `3.3.0` (earlier qualification) | Authenticated current-user and status probes on both; live request-list and user-list reads on `3.4.1` |

The live probes above used the isolated Helprr development database and application.
They made read-only status, configuration, or viewer requests. The destructive-flow
evidence refers to intentionally created test downloads/media and did not target the
stable Helprr database. The 2026-10-07 manual imports are the exception: they imported
real hand-added downloads into the library, on purpose, through a local build.

### 2026-10-07 re-verification

Versions and live reads were taken from the development stack on Helprr 1.6.0
(`2ea86dc`), signed in as an administrator. The feature flows ran earlier the same
week on the builds named with them.

- **Versions.** Each version in the matrix is what `POST /api/services/test` returned
  that day, the same probe as **Settings → Instances → Test**. Sonarr, Radarr,
  Prowlarr, Jellyfin, and Seerr had moved since the previous check; Lidarr and
  qBittorrent had not. AniList signs in with OAuth and has no connection test, and
  TMDB reports no version.
- **Live reads.** Through Helprr's own routes, each of these returned live data:
  Sonarr series, quality profiles, queue, history, and wanted; Radarr movies and
  quality profiles; Lidarr artists and health; qBittorrent torrents, transfer
  summary, and categories; Prowlarr indexers and status; Jellyfin system info,
  libraries, counts, and sessions; Seerr requests and users; TMDB Discover; and the
  AniList-backed Anime home.
- **Sonarr `4.0.20.3014` feature flows**, exercised on 2026-10-06 and 2026-10-07
  while building Helprr 1.6.0, on a local build unless noted:
  - The queue listed a hand-added download Sonarr could not match once Helprr
    asked for unknown-series items, and polling announced it as "Manual Import
    Required".
  - The manual-import scan returned each file's own series, season, and episode.
    For a pack Sonarr returned as "Unknown Series", its re-evaluation with the
    series supplied mapped all 25 files.
  - Two manual imports ran through Helprr, of ten and of 25 files. Sonarr dropped
    the first from its queue; after the second the Activity badge returned to 0
    and each file carried its release group.
  - Paged reads against the live instance honoured page sizes of 1,000 and 5,000,
    reported totals that matched the rows delivered, and returned history newest
    first. The same check passed on Radarr `6.4.4.10685`.
- **Jellyfin `12.2.0` playback re-qualification.** Run through Helprr's own routes
  on the development stack, signed in through `/Users/AuthenticateByName` as a
  Jellyfin-linked administrator. Unless marked as seen in a player, these are
  API-level checks: the request Helprr sends and the bytes or state Jellyfin
  returns.
  - **Catalog.** Library views, home rails, next-up, resume, recently added,
    search, paged movie and series queries, filters, and the Live TV listing
    returned live data.
  - **Negotiation and delivery.** `PlaybackInfo` for a 4K HEVC film with a
    transcode-only profile returned an HLS transcode. The master playlist, the
    variant playlist, and the first media segment came back through
    `/api/jellyfin/media`, with every playlist entry on a Helprr URL and no
    `api_key` or `ApiKey`. A text subtitle (`mov_text`) was delivered as WebVTT.
  - **Token/DeviceId independence.** The member token had been minted against the
    per-account device id. Playback reports were then sent under a new, never-used
    browser device id: Jellyfin listed a session for that device id owned by the
    signed-in member, accepted `/Sessions/Playing/Progress`, and its position
    advanced across successive reads. One stored token per member is still
    sufficient on `12.2.0`.
  - **Track, seek, and quality requests.** Asking for the second audio track, a
    subtitle track, a start offset at half the runtime, and a 1.5 Mbps cap each
    produced a stream that carried the choice. These were negotiated, not played.
  - **Stop and resume.** A stop at 10% saved exactly the ticks sent
    (`6315584000`) in the item's user data, the item appeared in Continue
    Watching, a fresh negotiation started from that offset, the active encoding
    was released, and the session disappeared. The position was then reset.
  - **Refusals.** The media proxy answered `404` for a non-allowlisted path, two
    path-traversal forms, and an unknown item id, and `401` without a Helprr
    session.
  - **Playback Reporting and administration reads.** Activity, hourly, movie, TV,
    device, and playback-method reports, user lists, devices, users, scheduled
    tasks, and the activity log returned data. A favourite was toggled and
    restored.
  - **Seen in a player.** An episode played as a transcode in the installed app on
    the iOS Simulator (iOS 27) with English subtitles displayed, and a film played
    in a desktop browser at 1440×900. Both showed as a session under the member
    and left none behind when stopped. Two transcoded playbacks earlier that day,
    on the development server at `cc3494a` and on a local build, behaved the same.
- **Jellyfin `12.2.0` in a player, 2026-10-08.** Played on the development stack
  at `e1ee60c` (Helprr 1.6.0 plus documentation commits) as a Jellyfin-linked
  administrator, in desktop Chrome 154 and in Safari on the iOS Simulator
  (iOS 27). The delivery method was read from Jellyfin's session list, because
  Helprr labels a remux as a transcode.
  - **Direct play.** An H.264/AAC MP4 played from `stream.mp4` over range
    requests under a `DirectPlay` session, in both browsers. An H.264 MKV played
    directly in Chrome.
  - **Remux and transcode.** A HEVC MKV played as fMP4 HLS with the video and
    audio copied, in both browsers. A 4K Dolby Vision/HDR10 film played in Chrome
    with the video copied and its E-AC-3 audio transcoded.
  - **Changes inside a playing session.** In both browsers: switching the audio
    track, switching the subtitle track, seeking by dragging the bar, and
    lowering the quality, which delivered 1280×720. In Chrome also: a jump from
    the chapter list, and a quality change while paused, which kept the exact
    position. Stopping saved the resume position.
  - **ASS/SSA through libass.** Rendered through libass in Chrome, where all 23
    of an episode's attached fonts were fetched through the media proxy. On the
    iOS Simulator this build burned ASS/SSA in instead: the libass canvas was
    never sized under Safari's native HLS. That was fixed in #280, merged after
    1.6.1.
  - **Burned-in PGS.** Present in the picture in both browsers; in Chrome
    confirmed by comparing the same frame with the track on and off.
  - **Live TV.** One channel played in Chrome as a live HLS transcode under a
    `TvChannel` session. The player showed it with the on-demand seek bar; it
    now reads `IsInfiniteStream` from the negotiated source and shows a LIVE
    indicator instead, with no scrubber, clocks, or ten-second skips.
  - **Defects found, fixed in Helprr 1.6.1.** All three predate `12.2.0` and none
    is a Jellyfin contract change: Chrome drew native text subtitles through the
    seek bar while the controls were up (see the corrected cue-placement entry
    under [Jellyfin in-app playback](#jellyfin-in-app-playback)); a single tap
    on the seek bar in iOS Safari did not seek, and the next touch applied that
    tap's position; and the Skip Intro and Next episode buttons covered the
    controls of an open panel. The fixes were checked on a local build in
    desktop Chrome, on the iOS Simulator, and in Chrome 149 on the Android
    emulator.
- **Not re-run on the newer versions.** These still rest on the earlier
  qualification named in the matrix:
  - Download Cleaner and Queue Cleaner removals, and every delete flow, on Sonarr,
    Radarr, and qBittorrent. The rewritten import confirmation was replayed against
    real history, not against a live removal.
  - Radarr's unmatched-download listing and movie chooser, which are covered by
    tests only: there was no unmatched movie download to try.
  - Prowlarr and Seerr beyond the reads above.
  - On Jellyfin `12.2.0`: token revocation, which means revoking a live member
    token; trickplay and alternate versions, because none of the 707 items
    checked on the reference server has either; Live TV in Safari; and playback
    on a physical iPhone.

### Jellyfin 12 compatibility (2026-09-13)

The configured server returned `Version: 12.0.0` and
`EnableLegacyAuthorization: false`. Its live `/api-docs/openapi.json` and the
[official v12.0 server source](https://github.com/jellyfin/jellyfin/tree/v12.0)
were compared with Helprr's client and media proxies. See also the
[Jellyfin 12 release notes](https://jellyfin.org/posts/jellyfin-release-12.0/).

- Catalog calls now use `/UserViews`, `/Items`, `/Items/Latest`, and
  `/Items/{itemId}` with explicit user IDs, including local trailers and special
  features. The older `/Users/{userId}/...` aliases remain in the v12 source but
  are obsolete and hidden from its API specification. Query parameters cannot
  override the client's scoped user identity.
- Authentication, image delivery, and playback requests use the standard
  `Authorization: MediaBrowser ...` header. Duplicate legacy `X-Emby-*` headers
  were removed. Tokens returned in media URLs, including `ApiKey` and legacy
  `api_key`, continue to be stripped before browser-facing proxy URLs are built.
- Explicit catalog recursion, item types, pagination, filters, and abort signals
  are preserved. Helprr does not parse the old `10.x` version prefix, use the
  removed Quick Connect GET route, or call the removed no-op administration APIs.
- Live client checks passed for library views and virtual folders, item counts,
  latest/resume/next-up/recommendations, catalog/detail/search, seasons/episodes,
  people/genres/studios, trailers/theme media/media segments, devices/users/tasks,
  activity, and Live TV listings. Existing member-scoped catalog reads also
  passed. A favorite was toggled and restored successfully.
- Installed Playback Reporting plugin reads passed, including activity, hourly,
  movie/TV, and device breakdown reports. This is evidence for the installed
  plugin, not a promise that older plugin binaries work on v12.
- Chrome 152 on macOS exercised Watch home, catalog/search, episode details,
  artwork and HEVC/MKV HLS transcoding for Friends S1E1. After account connection,
  real UI clicks verified advancing unmuted video, pause/resume, seeking, English
  SUBRIP subtitles delivered as WebVTT (HTTP 200), and quality changes both paused
  and playing. Paused quality changes preserved the exact position and intent.
  Playback/session and encoding cleanup requests returned HTTP 200. Background
  preview traffic was not isolated in the final post-stop network capture, so
  this does not establish zero post-stop media requests. An isolated
  stop saved exactly `1895470570` ticks (3:09.547057) in Jellyfin's user-data and
  item responses; a fresh page offered Resume and negotiated that exact offset,
  then video advanced normally. An abandoned paused test tab had
  initially overwritten progress, so concurrent same-account players are not
  qualified by this run. Token revocation was covered by regression tests rather
  than revoking the user's live credentials.
- No Live TV tuner was available, so empty channel/program/recording responses
  only qualify listing contracts. Physical iPhone/PWA playback, alternate episode
  versions, book reading, server restart/shutdown, task execution and device
  deletion were not exercised. New Jellyfin features are not automatically new
  Helprr features.

### Jellyfin in-app playback

Helprr's Watch section plays a Jellyfin library in-app, so it depends on more than
`/System/Info`. Verified against Jellyfin `10.11.11` from the isolated development
stack on **2026-08-28**:

- **Catalog and proxy flows, re-verified 2026-08-28.** Library views, home rails,
  next-up, search, filtered item queries, and Live TV channel listings returned live
  data. The image and media proxies served real bytes, resolved each
  item-specific request to an item (libass's static fallback font is the one
  allowlisted path with none), and refused non-allowlisted upstream paths, path
  traversal, and items the requesting user cannot see. The image proxy is the
  exception to the last: it serves server-wide artwork to admins and to users
  with `jellyfin.sessions` or `jellyfin.stats`.
- **Playback flows, from the development-stack testing recorded during this work.**
  Direct play, remux, and server-side HLS transcode selected from a browser
  capability profile; audio and subtitle track switching; ASS/SSA rendering through
  libass; burned-in PGS; and trickplay thumbnails against a library with generated
  tiles.
- **Per-member session attribution, verified 2026-08-28.** Playback is signed
  with the member's own access token rather than the admin API key. Measured
  side by side on the same item and device id: under the API key
  `/Sessions/Playing` was accepted but the session carried no user and
  `/Sessions/Playing/Progress` returned `400`; under a member token the session
  reported that member and progress returned `204` with the position advancing
  across successive reads. `/Users/AuthenticateByName` issued the token and
  `POST /UserItems/{id}/UserData?userId=` persisted resume position.
- **Token/DeviceId independence, verified 2026-08-28.** A member access token is
  accepted, and attributes correctly, when presented with a `DeviceId` other
  than the one it was minted against. Helprr's design depends on this: it stores
  one token per member and presents it with each browser's own device id.
  **Re-test this specifically after a Jellyfin upgrade** — if a future release
  binds a token to its minting device, one stored token per member stops being
  sufficient and playback breaks for every member on a second browser.
  Re-tested on `12.2.0` on 2026-10-07 and still holds; see
  [2026-10-07 re-verification](#2026-10-07-re-verification).
- **Revocation behaviour, verified 2026-08-28.** Revoking a member's token
  mid-playback causes the next media request to fail with an upstream
  `401`/`403`, which Helprr treats as the only available revocation signal. This
  was exercised during an active HLS transcode: the segment after the last
  successful one was refused and the player surfaced the connect gate.
- **Deliberate divergence: native cue placement, 2026-09-04.** jellyfin-web
  places WebVTT/SRT cues by counting text rows from the bottom of the video box
  (`htmlVideoPlayer/plugin.js` `renderTracksEvents`), and Helprr followed it.
  Rows are text-sized and the player chrome is pixel-sized, so on a phone they
  disagree: at 426x876 the seek bar was drawn through the last line of a cue,
  and in landscape through the middle of a two-line one. Helprr now keeps the
  row placement only while the chrome is hidden, and pins the cue box's bottom
  to the top of the chrome (`snapToLines: false`, `lineAlign: 'end'`, a
  percentage `line`) while it is up. Verified rendering on Safari 26.4. Do not
  "restore parity" here without re-measuring on a phone.
  **Corrected 2026-10-08.** The original entry also named Chrome for Android.
  Blink has no `VTTCue.lineAlign`, so through Helprr 1.6.0 Chrome anchored the
  percentage line at the cue's top edge and drew the cue through the seek bar.
  From 1.6.1 Chrome keeps the cue on the bottom row and raises the browser's cue
  container by the height of the chrome. Rendering was checked with the chrome up
  and hidden in desktop Chrome 154 at four viewport sizes, in Chrome 149 on the
  Android emulator in portrait and landscape, and in Safari on the iOS Simulator
  (iOS 27), where placement was already correct and has not changed. Firefox was
  not checked.
- **Web Push on Android, verified 2026-09-04.** Exercised for the first time
  against the installed WebAPK over an HTTPS origin: `pushManager.subscribe`
  returned an FCM endpoint, the subscription persisted, and
  `POST /api/notifications/test` reported `{"sent":1}` with the notification
  posted by the WebAPK's own package (title, body, icon and origin subtext
  correct). Push cannot be exercised over a plain-HTTP origin at all — there is
  no secure context, so the service worker API is absent.
- **Not qualified at the time.** Live TV *playback* had not been exercised — no
  tuner was configured on the reference server, so only channel listing was
  covered. Chapter markers were likewise unexercised because no item reached
  during testing carried chapters. Both were first exercised on `12.2.0` on
  2026-10-08; see [2026-10-07 re-verification](#2026-10-07-re-verification).

Jellyfin exposes these routes without an API version, so a future release can
change them without a contract change. Re-run the flows above after upgrading rather
than treating a successful connection test as proof that playback still works.

## Before reporting an upstream compatibility problem

1. In **Settings → Instances**, re-test the affected connection and record the exact
   upstream version.
2. Reproduce the smallest affected Helprr flow. A successful connection test proves
   authentication and that service's own probe endpoint only (for Jellyfin, also
   that the key is an administrator's and resolves to a user); it does not prove
   every feature.
3. Download the admin support bundle from **Settings → Service status**. Review it
   before sharing because operational metadata and recent redacted logs may still be
   private.
4. Include the Helprr version/commit, upstream product version, failing action, HTTP
   status, and whether the same action still works in the upstream application's UI.

## Maintaining this matrix

Update a row only after observing the version from the isolated development stack and
testing the affected integration. Record a new verification date and state whether the
evidence was only a connection probe or included real feature flows. Do not turn two
successful point versions into an inclusive range: a minimum/maximum claim requires
explicit boundary testing and remains outside Helprr's current compatibility policy.
