# Upstream compatibility

Last verified: **2026-07-14**, from Helprr's isolated development stack during the
Helprr 1.1.0 qualification and release. The `JELLYFIN` row was re-verified on
**2026-08-28** for the in-app Watch and playback work; see
[Jellyfin in-app playback](#jellyfin-in-app-playback) for what that covered and
what it did not. Every other row still carries its 2026-07-14 evidence.

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
| `SONARR` | Sonarr | REST `/api/v3` | `4.0.19.2979` (two instances) | Authenticated system-status probe; live queue, cleanup, file, and whole-series operations |
| `RADARR` | Radarr | REST `/api/v3` | `6.2.1.10461` (two instances) | Authenticated system-status probe; live cleanup and whole-movie operations |
| `LIDARR` | Lidarr | REST `/api/v1` | `3.1.2.4913` | Authenticated system-status probe; live track-file and album operations |
| `QBITTORRENT` | qBittorrent | Web API `/api/v2` | `v5.1.4` | Authenticated app-version probe; live queue, cleanup, keep-data, and delete-data operations |
| `PROWLARR` | Prowlarr | REST `/api/v1` | `2.4.0.5397` | Authenticated system-status probe |
| `JELLYFIN` | Jellyfin | Unversioned REST routes such as `/System/Info`, `/Items`, `/Items/{id}/PlaybackInfo`, `/Videos/{id}/…`, `/Audio/{id}/…`, `/Sessions/Playing*`, `/Users/AuthenticateByName`, `/UserItems/{id}/UserData` | `10.11.11` | Authenticated system-information and admin-access probe; live catalog, image, media-proxy, and in-app playback flows (see the note below) |
| `TMDB` | TMDB | Hosted API `v3` | No product version exposed | Authenticated `/configuration` request succeeded |
| `ANILIST` | AniList | Hosted GraphQL API at `graphql.anilist.co` | No product version exposed | OAuth-authenticated Viewer query succeeded |
| `SEERR` | Seerr | REST `/api/v1` | `3.3.0` | Authenticated current-user and status probes |

The live probes above used the isolated Helprr development database and application.
They made read-only status, configuration, or viewer requests. The destructive-flow
evidence refers to intentionally created test downloads/media and did not target the
stable Helprr database.

### Jellyfin in-app playback

Helprr's Watch section plays a Jellyfin library in-app, so it depends on more than
`/System/Info`. Verified against Jellyfin `10.11.11` from the isolated development
stack on **2026-08-28**:

- **Catalog and proxy flows, re-verified 2026-08-28.** Library views, home rails,
  next-up, search, filtered item queries, and Live TV channel listings returned live
  data. The image and media proxies served real bytes, resolved each request to an
  item, and refused non-allowlisted upstream paths, path traversal, and items the
  requesting user cannot see.
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
  percentage `line`) while it is up. Verified rendering on Chrome for Android
  and Safari 26.4. Do not "restore parity" here without re-measuring on a phone.
- **Web Push on Android, verified 2026-09-04.** Exercised for the first time
  against the installed WebAPK over an HTTPS origin: `pushManager.subscribe`
  returned an FCM endpoint, the subscription persisted, and
  `POST /api/notifications/test` reported `{"sent":1}` with the notification
  posted by the WebAPK's own package (title, body, icon and origin subtext
  correct). Push cannot be exercised over a plain-HTTP origin at all — there is
  no secure context, so the service worker API is absent.
- **Not qualified.** Live TV *playback* has never been exercised — no tuner is
  configured on the reference server, so only channel listing is covered. Chapter
  markers are likewise unexercised because no item reached during testing carried
  chapters. Both degrade to an absent control rather than an error, but neither has
  feature-flow evidence behind it.

Jellyfin exposes these routes without an API version, so a future `10.x` release can
change them without a contract change. Re-run the flows above after upgrading rather
than treating a successful connection test as proof that playback still works.

## Before reporting an upstream compatibility problem

1. In **Settings → Instances**, re-test the affected connection and record the exact
   upstream version.
2. Reproduce the smallest affected Helprr flow. A successful connection test proves
   authentication and the status endpoint only; it does not prove every feature.
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
