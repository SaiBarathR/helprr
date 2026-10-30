# Changelog

All notable changes to Helprr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.1] - 2026-10-30

### Added

- **Delete Twitch files from more places**: the ⋯ menu on a video, a Downloaded
  filter, and multi-select on a streamer's page.

### Fixed

- **Deleting a Twitch video from Jellyfin no longer fails.** Library files are now
  writable by their group, and older ones are fixed when the worker starts.
  Jellyfin's user needs to be in the worker's group (`TWITCH_PGID`).
- **Files you delete in Jellyfin now leave Helprr too**, within a few minutes, with
  their chat and subtitle files.
- Twitch polling skips streamers nobody follows. Following one again does not push
  everything you missed.
- Free space in the queue reads in TB and says it is the library disk.

## [1.10.0] - 2026-10-30

### Added

- **Twitch archiver (optional)**: follow streamers, get a push when one publishes
  a new VOD, and save videos into a Jellyfin library with chapters, metadata and
  the chat as a scrolling subtitle track. It stays off until you add a Twitch
  connection, and it needs a separate worker container. See the README.
- **A feed for your streamers**: New and All views, filters, search, Live now and
  Expiring soon shelves, and a badge for unseen videos. Twitch deletes VODs after
  7 to 60 days, so videos about to expire are called out, and a push warns you.
- **Download from anywhere**: the feed, a push, a streamer page, multi-select, or
  a pasted link. A queue page shows live speed and time left, with cancel and retry.
- **Rules, off by default**: per streamer and per video type, with a preview
  before saving. Nothing downloads by itself until you turn on Auto-download.
- **Nightly re-encode**: on an Intel GPU, saved videos shrink by about 63–82%,
  never while Jellyfin is transcoding, and Jellyfin keeps your watched state.
- **Retention**: keep the latest few, delete after a number of days, or after
  watching. You see the list first, and keep-forever files are never deleted.
- **Import who you follow on Twitch**, using a one-time code. It reads only your
  follows, and only ever adds subscriptions.

### Changed

- The first start applies two new database migrations. Back up first, as usual.
- `client_secret` values and `auth-token` cookies are now redacted from logs.
- Settings export and import can carry Twitch settings, rules and subscriptions.

### Upgrading

Nothing changes unless you turn this on: without `COMPOSE_PROFILES=twitch` the
default services stay `helprr`, `helprr-db` and `helprr-redis`. Saving Twitch's
data needs the new `helprr-twitch-worker` image, and re-encoding needs `/dev/dri`.

## [1.9.0] - 2026-10-30

### Added

- **Search every indexer from Helprr**: a Search tab on the Prowlarr page, with
  category chips, sorting and cancel, and a Grab button that sends a release to
  Prowlarr's own download client after a confirmation. Needs Prowlarr manage
  access. Only the Search button searches, so tapping a category or coming back
  to the tab does not spend tracker quota. Sonarr and Radarr don't track what is
  grabbed here.
- **Indexer detail sheet**: tap an indexer for why it is blocked and until when,
  its numbers for the last 7 days, its recent activity and categories, and Test,
  on/off and Delete. A link can open it directly, and the back gesture closes it.
- **Quick edit in the sheet**: priority, app profile and tags, shown by name.
  Each change saves on its own. Without manage access they are shown as text.
- **Apps tab**: the apps Prowlarr syncs to, with Test and Test All, and a warning
  when an arr connected to Helprr may have no Prowlarr app.
- **Push notifications for Prowlarr's health**: subscribers to health warnings
  get these with no new setting, and the notification opens the Prowlarr page.
  In Settings the event is still listed under Sonarr/Radarr.

### Security

- The logger now hides `passkey`, `authkey`, `torrent_pass` and `rsskey` values,
  as it already did API keys. Search text is left out of request logs, because
  it can be a pasted link with a key in it.
- Release links can carry tracker passkeys, so they never reach the browser: a
  search returns a temporary token for each result, and the real reference stays
  on the server, readable only by the user who searched.

### Fixed

- Global search over Prowlarr history matched only on event type, because it read
  fields Prowlarr does not return. It now matches the search text and the indexer
  name, and lists indexers first, linking to their sheet.
- Changing an indexer that was deleted elsewhere now says so instead of showing a
  generic error.

## [1.8.0] - 2026-10-30

### Security

- **Prowlarr credentials no longer reach the browser.** Anyone with Prowlarr
  view access (not only admins) could read indexer credentials in two
  responses. The indexer list included each indexer's settings, and Prowlarr
  masks only the fields it marks as secret, so a definition keeping its API key
  in an ordinary field came back in clear. History records quoted the URLs
  Prowlarr called, with API keys and passkeys in them. The indexer list now
  sends only what the pages use. History, Test All results, health messages and
  logged Prowlarr errors keep only each URL's host and drop magnet links, so the
  URL in the History drawer now opens the indexer's site. Log lines written
  before this release are not changed.
- Removed the add-indexer API routes left over from an abandoned screen
  (`GET /api/prowlarr/schema`, `POST /api/prowlarr/indexers`). Nothing used them.

### Added

- **Turn an indexer on or off from Helprr**: a switch on each row of the
  Prowlarr page, and Enable/Disable in its long-press menu. Needs Prowlarr
  manage access. The row changes at once and goes back with a message if
  Prowlarr refuses.
- **Prowlarr health warnings** on the Prowlarr page: failing indexers, apps that
  fail to sync, a proxy that is down, errors first, with a Learn more link.
  Nothing is shown when all is well.
- **Host charts** on the Prowlarr Stats tab: queries and grabs per calling host.

### Fixed

- Every row in the Prowlarr Stats charts and the Insights top-indexers card now
  has its label; a chart with few rows could drop one.

### Changed

- The Docker image is built on Node 24.22.1, and the release workflows use the
  current versions of their GitHub Actions.

## [1.7.0] - 2026-10-30

### Security

- **Settings import no longer moves stored secrets to a new address.**
  Importing a settings file that named an existing connection with a different
  URL kept that connection's API key, custom headers and tokens, so an admin
  importing a tampered file would have sent them to the new address (editing a
  connection already refused this). A URL change now needs a fresh API key or
  password in the file; otherwise that connection is skipped with a warning
  naming it. Same-URL imports keep omitted secrets as before.
- Cancelling a manual download that Helprr had added to qBittorrent reported,
  and audited, its torrent as removed on qBittorrent's acknowledgement alone.
  It now checks the torrent is gone, as the torrent page does, and says so
  when it is not.
- A Jellyfin account with Live TV switched off, linked to a Helprr member,
  could still list Live TV channels in Helprr and play them: Jellyfin enforces
  that policy only on its own Live TV routes called with the user's own token,
  and Helprr listed channels with the admin API key. Helprr now reads each
  member's Jellyfin policy (administrator, or Live TV access allowed) and
  treats a failed read as no access. Without access, the Live TV page says Live
  TV is not enabled for the account, Jellyfin search leaves channels out, and
  the media and image proxies and playback refuse channels, programmes and
  recordings.
- A response fetched for a session that had just ended (a poster, a read-only
  API answer or a page refresh) could finish after sign-in had cleared the
  browser's per-user caches and write the old session's data back into them.
  The service worker now drops any such write, and the page waits briefly for
  the worker before it clears the caches itself.
- API responses that set no caching policy are now sent with
  `Cache-Control: private, no-store`, errors included. Nothing was cacheable in
  practice; this is a safe default.
- Every list route bounds its page, page size, offset and limit: a value that
  is not a number falls back to the route's default, and one out of range is
  clamped. Before, some values answered with a server error or were passed
  unbounded to Sonarr, Radarr, Lidarr, Prowlarr, Seerr, AniList or TMDB.
- `next` was updated to 16.4.2 for three advisories (an image-optimizer RCE
  through `sharp` on glibc Linux, a Server Actions denial of service, and an
  RCE in `use cache` functions). Helprr was not exposed: it already pins the
  fixed `sharp`, runs on Alpine (musl), and uses neither Server Actions nor
  `use cache`.
- `dompurify` was updated to 3.4.17 and `zod` pinned to 4.6.7 for new
  advisories. Helprr was not exposed: it calls DOMPurify with its default
  options only, and `zod` only validates the service worker's build settings.
- `follow-redirects` (used through `axios`) was updated to 1.16.1 for two
  advisories about credential headers kept across cross-origin redirects.

### Added

- **Send a torrent to Sonarr or Radarr.** Add Torrent can hand a magnet link or
  `.torrent` file to Sonarr or Radarr for one movie or series, instead of
  adding it to qBittorrent only:
  - Pick the movie or series (and the instance when there are several). A
    title that is not in the library yet is added with its searches off, using
    the quality profile, root folder and tags you choose.
  - **Check** shows how Sonarr/Radarr read the release (quality, year,
    episodes), what they will do, the download client, and any problem in
    their own words. **Send** is offered only for exactly what was checked.
    When the title is unmonitored, or several download clients could take the
    download, the form asks you to choose.
  - Sonarr/Radarr then own the download, the import and the rename. A
    `.torrent` file is fetched once by Sonarr/Radarr from a two-minute link,
    so Helprr needs an address they can reach (`ARR_CALLBACK_ORIGIN`, or
    `APP_ORIGIN`); magnet links need neither.
  - **Torrents → Linked downloads** follows each one through Sonarr/Radarr's
    queue until the import, with In progress, Needs attention and History
    tabs and a progress figure while it downloads. A download counts as
    imported only once the title has a file it did not have before. Each
    download's page shows where it stopped, what went wrong in
    Sonarr/Radarr's words, who sent it, and its history, with **Cancel
    download**, **Unlink**, **Send again** and **Open movie/series**.
  - Cancel removes the download from Sonarr/Radarr's queue and never starts a
    search for another release. It can also delete the torrent and its data,
    blocklist the release, and remove a title the download added while that
    title still has no files, each only with the matching permission.
  - **Choose files before download (advanced)** adds the torrent stopped so you
    can pick its files first. When they finish, Sonarr/Radarr say what each
    chosen file is; Helprr imports them on its own only when every chosen
    video maps cleanly, and otherwise **Map files** lets you decide per file
    (Import or Leave it, and which episodes), check the result with
    Sonarr/Radarr, and import. Only the chosen files are ever scanned or
    imported, and they are copied (hardlinked where possible) so the torrent
    keeps seeding.
  - Sending needs the add-torrent, manage-activity and add-movie or add-series
    permissions; choosing files also needs the manage and delete torrent
    permissions. Every title added, release sent and removal is recorded in
    the operation audit.
- A download whose added title is gone (removed by a cancel, by a failed
  send, or in Sonarr/Radarr) says so instead of "Added to the library by this
  download", and no longer links to it. On the manual import page, unticking a
  file explains that it stays in the download folder and can't be imported
  from Helprr later.
- **Rate titles.** The Watch overlay, its tiles' popover and a title's detail
  page have a Rate control: thumbs down, thumbs up, or "Love this!". The latest
  rating wins, choosing it again clears it, and nothing is written to
  Jellyfin. Ratings feed the recommendations: a like or love raises the
  title's genres (a love counts twice), and clearing a thumbs-down lets the
  title back in unless Not interested still hides it.
- **Recommendations learn from requests**, and from a newly linked account
  straight away. A Seerr request made through Helprr counts as interest in
  that title's genres, once per title. Linking a Jellyfin account, an admin
  changing a user's Jellyfin user, or a settings import that changes AniList
  links rebuilds that user's recommendations the next time they are read (or
  within 30 minutes) instead of up to six hours later.
- **Activity's Queue tab loads more.** It showed only the first 50 downloads
  of each instance. The list now says how many are loaded ("50 of 1,500 queue
  items loaded") with a **Load more** button, and the Failed tab checks every
  instance's whole queue for downloads waiting on an import.
- **Activity import** can import files whose names Sonarr/Radarr could not
  re-check against the chosen movie or series (Import used to stay disabled);
  each such file says it will be imported as scanned. Each file has a checkbox,
  so a sample, an extra or a file you want to keep seeding can be left in the
  download; the button counts the files it will import.
- **Subtitle appearance in Settings → Preferences.** Size, font, edge,
  background, colour and position can be set without a title open, with a
  preview that matches the player. They apply to text subtitles (SRT, WebVTT)
  on this device; ASS/SSA subtitles keep their own styling.
- When a stream cannot be reached, the player stops after the first attempt
  (about 40 seconds instead of about 80) with "The stream couldn't be reached"
  and a **Retry** button, which starts again from the same position with the
  same tracks and version. Other playback errors also offer Retry.
- Play all and Shuffle all say when they stop at their 500-title limit
  ("Queued 500 of 507 titles").
- Discover offers **Add to <instance>** (or **Add to another** with several)
  when another Radarr or Sonarr instance does not have the title yet.
- On the Requests page, "Open in Helprr" opens a title that is not in the
  library yet on its Discover page; Helprr's own pending-approval rows offer it
  in their long-press menu too.
- **Settings → Service status** shows administrators whether background polling
  is running, when its last cycle finished, and any job that is failing or has
  been running for more than five minutes.
- Cleanup History names who ran each cleanup: the signed-in user, or
  `system:cleanup-scheduler` for an automatic run. Every torrent deletion and
  queue removal a cleaner attempts is now recorded in the operation audit,
  marked successful only once the item is confirmed gone, and audit entries
  show the request id.
- Saving cleaner settings that turn on automatic deletion asks for confirmation
  first, says what the cleaner will delete and how often, and recommends a dry
  run when none is on record. A settings import that would turn on automatic
  deletion asks the same, once for each cleaner.
- When part of a settings import could not be put into effect (for example
  restarting polling or clearing the image cache), the Backup page now lists
  what failed with **Retry** and **Dismiss**, instead of only logging it.
- `scripts/update.sh` takes a validated backup, then pulls and restarts only the
  Helprr container, waits for it to become healthy and checks `/api/ready`. It
  stops before pulling anything if the backup fails. It ships as a release
  asset.
- `scripts/backup.sh --keep N` keeps the newest N of its own backups (default
  10; `0` keeps every backup). The README explains how to keep a copy off the
  host.
- The README has a Privacy section listing every outbound request Helprr makes
  (it has no telemetry), and a Requirements note: Docker Compose 2.18 or newer
  on a supported Docker Engine, and the latest two major iOS versions for the
  iPhone app.

### Changed

- **Interactive search opens its own page** instead of a bottom drawer, for
  movies, series seasons, episodes and music albums, so a swipe or a stray tap
  can no longer dismiss it. It searches as soon as it opens, has **Search
  again**, keeps its filters and sort pinned while the results scroll, and
  shows a failure on the page with **Try again**. Going back to the title and
  returning within five minutes shows the same results without asking every
  indexer again; a grab starts a fresh search next time.
- **Back returns to the page you came from** on series, season and episode
  pages, torrent files, Excluded titles and Scheduled alerts, instead of always
  opening the parent list. A page opened from a link with nothing before it
  still goes to its parent.
- **A fresh visit starts at the top.** Opening a page from the navigation no
  longer jumps to where an earlier visit was left; Back, Forward and reload
  still restore the position. Calendar opens on today on a fresh visit, and
  Back restores the picked day, period and scroll position.
- The bundled Redis moves from `redis:7-alpine` to `redis:8-alpine`, because
  the Redis 7 image is built on an Alpine release that reaches end of life on
  2026-11-01. Existing installs move it once by hand (see the README's
  Updating section).
- The Docker image is built on an exact Node 24 version pinned by digest, and
  the Prisma CLI no longer reports usage when the container starts.
- `/api/ready` answers `stopping` (HTTP 503) as soon as a graceful shutdown
  begins, instead of reporting ready while the app drains.
- `backup.sh` now deletes all but its newest 10 backups after each successful
  run unless given `--keep`.
- Jellyfin's own playback reports are now the only thing that saves a resume
  position, so Jellyfin's resume and played thresholds apply. Helprr used to
  save the position a second time with the admin key every 10 seconds.
- Select lists open below or above their field, fit the room there and scroll
  inside, instead of covering the screen. Menus, select lists and popovers in
  the installed iPhone app stay clear of the status bar and home indicator,
  and a long-press menu opened near the bottom edge moves up above it.
- The installed version on Settings → Status reads `1.7.0` rather than the
  Docker tag `v1.7.0`.

### Fixed

- **Push after a VAPID key rotation.** A device whose subscription used the
  old key kept showing as subscribed (and healthy on the Devices page) while
  nothing arrived. Opening Helprr on that device now replaces the subscription
  itself when notification permission is granted, keeping the device's
  per-event preferences and name, or asks you to turn notifications on again
  in one tap. The Devices page shows a device whose pushes fail, with what to
  do. An old-key subscription is no longer registered again, and a browser
  whose push support never answers no longer leaves the Enable button
  spinning.
- **Player:**
  - Keys pressed inside a dialog, or in a dialog's menu or select list, no
    longer also control playback.
  - A seek in a progressive (non-HLS) audio transcode no longer skips to the
    next track, the clock shows the real position after it, and a seek while
    paused stays paused.
  - After "Playback did not start", a late error or pause no longer replaces
    the message, and progress stops being reported for the released session.
  - Next and Previous tell Jellyfin the outgoing title stopped, at its
    position, so it no longer stays listed as playing and its played state is
    recorded. A Play whose queue cannot load stops the title it replaces.
  - Play all and Shuffle all queue at most 500 titles (a large set queued
    600), and on a library without a collection type queue each title once
    rather than folders and their contents.
  - A browser that refuses local storage (some private modes) gets its own
    Jellyfin playback device id instead of one shared by every such browser.
- **Installed app and offline:**
  - Coming back online, for example when Wi-Fi hands over to mobile data, no
    longer reloads the app, which closed the player and dropped unsaved forms.
  - After a deploy, a new version waited until the iPhone app (or a Safari tab)
    was force-quit, and every navigation became a full reload meanwhile. The
    service worker no longer uses navigation preload, so updates take over by
    themselves.
  - A cached page whose security nonce does not match its scripts, which left
    Safari stuck on "Loading...", is never served or cached.
- **Navigation and scroll:**
  - Discover: Back returns to a results grid opened by a pill (such as
    Trending) instead of the home carousels.
  - Calendar month view keeps the tapped day and its panel's position after
    opening a title and going Back.
  - Changing a filter in an Activity link view keeps the list where it is, and
    a link's tab (for example from a notification) no longer replaces the saved
    tab on a later plain visit.
  - After "View all" from the dashboard, Discover scrolls the selected sort
    chip into view.
- **Menus:** pressing inside a dialog no longer opens the long-press menu of
  the item behind it, and For You recommendation cards open their action menu
  again (Not interested was unreachable there).
- **Accessibility:**
  - Repeat buttons say their mode ("Repeat: off/all/one"), and the audio
    player's controls are named.
  - The scheduled-alert dialog announces which alert type and release types
    are chosen.
  - The dashboard has a page heading, the collapsed sidebar's links and
    buttons have names, and unknown addresses show Helprr's own 404 page.
  - Red warning and error text, the destructive badge and delete buttons in
    light glass reach AA contrast in every theme, and so does Jellyfin's
    "Restart needed" badge in the light theme.
  - The Random view has a single page heading.
- **Images:** Calendar and search-palette artwork goes through Helprr's image
  proxy, so it loads where the browser cannot reach Sonarr, Radarr or Lidarr.
  An image that fails to load shows a neutral tile or is hidden, never the
  browser's broken-image icon.
- **Cleanup:**
  - A torrent re-added with the same hash no longer inherits the old copy's
    strikes. Strikes counted before this update start again once.
  - A failed strike clear or prune after a removal no longer reports the
    removal as failed or skips its Cleanup History entry.
  - **Next** on the Cleanup dashboard pages through more than 30 active strikes
    instead of jumping back to page 1.
  - A torrent deleted from the list is audited as done only once qBittorrent
    no longer lists it; deleting one that is already gone answers "That
    torrent is no longer in qBittorrent." A failed delete in the operation
    audit reads "files/data were to be deleted".
- **Settings import:**
  - A large but valid backup could fail with a server error because the import
    ran past the database's five-second transaction limit. It now imports in
    batches within one transaction.
  - An import of UI preferences alone no longer sends notification device
    rules from a browser without a push subscription.
- **Library and instances:**
  - A newly added instance shows in the combined library at once.
  - One slow instance costs one timeout instead of two, and when every
    instance fails the list reports an error instead of an empty library.
  - Series, movie and music pages read Windows media paths (`C:\Media\…`)
    correctly, and saving without changing the root folder sends the stored
    path unchanged.
  - Specials (season 0) link to their episode from the Activity queue and
    from notifications, and an older notification opens its own instance.
  - On an artist's Files page, a file row's Interactive search looks for that
    row's album.
  - An AniList id AniList does not know answers "not found" rather than an
    error, and a missing rate-limit header no longer starts a false cooldown.
  - Anime Explore: a year range with Seasonal sort lists the current season's
    anime from those years, and a range given high to low means the same
    years.
- **Recommendations:** a title just hidden with Not interested or a dislike
  could come back for up to 15 minutes.
- **Pages a member cannot use:** Activity, Calendar, Insights and the
  operation audit show the not-found page instead of failing requests; the
  dashboard's Overview tiles link only to pages the user may open; the
  Jellyfin overview no longer polls sessions for members who cannot see them;
  and Requests shows its counts and Users tab only to approvers. The API
  already refused these requests.
- **Torrents:** a torrent still fetching its metadata shows its size as "—"
  instead of "NaN undefined" or "0 B".
- **Dashboard:** the Service Health widget added on a phone fills the width and
  shows every service.
- Sticky table headers on Movies, Series, Music and Torrents stick, below the
  real toolbar height.
- When refreshing a series' episodes fails, the last loaded list stays with a
  notice and Retry.
- The Seerr request dialog fills **Request As** when your Seerr account loads
  after the service data, and the Logs date picker opens on the applied range.
- Anime Relations cards no longer overlap their relation and format labels;
  the Recommendations feed's Not interested button clears the iPhone's home
  indicator; "No pending requests" says "in Seerr" under Helprr's own pending
  approvals.
- An interrupted page transition (a quick Back) is no longer logged as a
  server error, and Calendar no longer logs a ResizeObserver warning on every
  visit.

## [1.6.3] - 2026-10-17

### Security

- Several read routes needed only a signed-in session, so a member whose
  feature an admin had turned off could still read it by calling the route:
  Sonarr and Radarr credits, the Sonarr, Radarr and Lidarr lookups, quality
  definitions, languages, quality and metadata profiles, tag lists, dashboard
  layouts, and the Anime and Discover detail routes. Each now requires the
  feature's capability (or one of the capabilities of the pages that use it),
  the Anime and Discover pages check it too, and the For You and Anime carousel
  widgets declare the capability they need.
- Discover sections carry your library state but were marked publicly
  cacheable and kept in a shared server cache, so a browser cache shared by two
  accounts or a proxy could hand one account's response to another, and a newly
  added title kept showing as missing for up to five minutes. They are now
  private to the session, and only the TMDB catalog is cached.
- The Discover collection page fetched Helprr's own API at an address built
  from forwarded request headers, sending the visitor's session cookie with it,
  and the AniList sign-in built its redirects from the same headers. Both now
  use `APP_ORIGIN` or the server itself, never request headers.
- A saved API key or custom header value was reused whatever URL the
  connection was changed to, so managing instances was enough to send a key to
  another address. A saved secret is now used only with the URL it was saved
  for, and a `Host` custom header is not accepted. Service connections also no
  longer follow a redirect to another host with their API key, custom headers,
  or sign-in body.
- Push subscriptions are accepted only for the browsers' push services, checked
  when subscribing and again before every send.
- An import started from the Activity page could name any file the *arr could
  reach. It is now limited to the files of that download and recorded in the
  operation audit. Renaming files checks that every file belongs to the title.
- A single-torrent action accepted `all` or a list of hashes, which
  qBittorrent reads as many torrents, a delete included. It now takes exactly
  one torrent. The media proxy decodes a path once and checks it again after
  building the upstream address, and several routes validate ids before using
  them.
- Revoking this device's session from **Settings → Sessions** now clears this
  browser the way signing out does. When a session ends any other way (it
  expires, or is revoked from another device), the sign-in page clears what it
  left in the browser (page copies that include the account's name and role,
  saved lists, posters) as soon as it opens, rather than at the next sign-in.
- A local password hash made with an older cost setting is upgraded at the
  next successful sign-in. Startup now warns when the PostgreSQL or Redis
  password is shorter than 16 characters.

### Fixed

- After connecting an AniList account, the result (connected, or why it
  failed) was never shown: the sign-in returned to the Settings menu rather than
  to Settings → Instances, where the AniList card reports it.
- In Firefox, the second line of a two-line subtitle sat on the seek bar while
  the player controls showed.
- Player: "Add to queue" on a series, season, or album queues what it holds,
  and an item queued while a Play is still being expanded is kept. A seek or a
  media error while the next title is starting no longer disturbs that start,
  and a seek no longer moves the title being left. When the next title fails
  to start, Jellyfin is told the previous one stopped, at its real position,
  instead of showing it as still playing, and the play button shows Play rather
  than Pause. An expanded music player stays expanded from track to track.
- A cleanup removal whose Cleanup History entry could not be written was
  reported as failed although the download had been removed.
- A delete dialog that was closed after a failed delete kept "Also delete
  files" ticked for the next attempt. A restored search survives a reload.
- In Settings, a service rejecting a connection's key no longer sends you to
  the sign-in page as if your session had expired.
- Descriptions are sanitised in the browser only, so the server no longer
  loads a DOM library to do it.

### Changed

- Deleting a movie or series from its own page no longer always deletes its
  files. Like the library lists, the confirmation offers "Also delete all files
  from disk", off by default.
- Editing a saved connection's URL now says straight away that its API key (or
  password, or header values) has to be entered again.
- The cleanup permission is now labelled "Manage cleanup rules & run cleanups
  (deletes downloads and files)", which is what it already allowed.
- The release runbook makes a security review of each release's changes a
  required step.

## [1.6.2] - 2026-10-09

### Security

- Three Jellyfin routes put an id from the request into the path of a call
  Helprr makes to Jellyfin with its own API key, without checking the id's
  shape. A signed-in member could craft one that sent the call to a different
  Jellyfin endpoint: marking an item unwatched could become deleting a library
  item, and reading playback history could become reading other server data,
  Jellyfin's API keys included. Starting or stopping a scheduled task had the
  same flaw for accounts allowed to control the server. Each value is now
  checked before it is used, and Helprr refuses to send Jellyfin a request whose
  path could be read as another one. Update promptly if anyone you do not fully
  trust can sign in. Helprr has no dedicated record of this flaw being used.
  Retained request logs may show it but cannot rule it out; if you are unsure,
  replace the Jellyfin API key afterwards.
- The media proxy's path check missed an encoded `..`, so a member could request
  Jellyfin paths outside the playback allowlist. Those requests carry the
  member's own Jellyfin token, so they reached only what Jellyfin already lets
  that member read.
- A member could end another member's idle playback session by sending its
  device id. Only the session's owner can now.
- Starting playback returned Jellyfin's media source as received, which carried
  the member's own Jellyfin access token inside a URL and, for a remote source,
  its provider's address and request headers. The playback response now limits
  the negotiated media source to the fields the player uses, and it and the item
  detail response leave out item, stream, and chapter-image paths and a media
  source's address and request headers. The token was only ever sent to the
  member it belongs to.
- `next` was updated to 16.3.8 for a request-forgery advisory in image
  optimization (CVE-2026-94483). `npm audit --omit=dev` reports no known
  advisories at release.

### Fixed

- The "Search Discover" shortcut and the share screen's "Search Discover for …"
  link opened Discover with an empty search box. They now search for the text. A
  search link opens its own view like other Discover links, so nothing done
  there changes your saved Discover filters.
- Discover emptied its search box when you moved between a link's view and the
  plain page.
- A Live TV channel was shown with a seek bar, a position, and a time remaining
  that meant nothing. The player, the mini player, and the now-playing bar show
  a LIVE indicator instead, and the ten-second skip controls are not offered.
  Previous now goes from a live channel to the title queued before it.
- On iPhone and iPad, styled (ASS/SSA) subtitles were burned into the picture by
  a server transcode. They are drawn in the browser, as on desktop. In any
  browser, a stream that was slow to start could be switched to burned-in
  subtitles needlessly, and the browser's own subtitles could then be drawn on
  top of the burned-in ones.
- When a newly picked title failed to start, the previous title's position and
  length stayed on the player under the error, Play could resume the previous
  title, and closing the player could save its resume point in the wrong place.
- Pressing Previous straight after Next, before the next title had loaded,
  rewound the outgoing title and then switched anyway. It now goes back.
- On an install opened over plain `http://` rather than HTTPS or localhost, every
  browser shared one Jellyfin playback device, so two people watching at once
  shared a session, and Add rule on Settings → Downloads did nothing.
- A browser closing its connection in the middle of a response could stop the
  server process. It is now logged and ignored.

### Changed

- The README and the architecture, compatibility, and release notes were
  corrected where they had drifted from the code. Most visibly: deleting from a
  movie or series page always deletes its files (only the library lists and the
  artist and album pages offer the choice), and the 30-second shutdown drain is
  a wait, not a guarantee, for a cleanup cycle still running.

## [1.6.1] - 2026-10-08

### Fixed

- Chrome and other Chromium browsers, on desktop and Android, drew text
  subtitles (SRT, WebVTT) through the seek bar while the player controls were
  showing. The subtitle now sits just above the controls, or above an open
  panel, as it already did in Safari.
- A single tap on the player's seek bar in Safari on iPhone and iPad did not
  seek: the time preview stayed on screen and the next touch jumped to the
  earlier tap's position. A tap now seeks straight to where it lands.
- Skip Intro and Next episode covered the playback speed, quality, and subtitle
  delay controls of an open player panel. They hide while a panel is open.

## [1.6.0] - 2026-10-07

### Added

- Activity lists downloads that Sonarr or Radarr track but could not match to a
  series or movie, such as a torrent added by hand into the arr's category. Each
  shows the arr's reason and an Import button, counts in the Activity badge, and
  raises "Manual Import Required" when it is waiting on an import. The first poll
  after updating announces any such download already in the queue once.
- The Activity import page takes the series or movie from each scanned file when
  the download carries none, and offers "Choose series" or "Choose movie" when
  the arr cannot match the files either. Import stays disabled until every file
  has one.
- qBittorrent settings, a torrent's own settings, Rename, and bulk Set Speed
  Limits each open on a full page instead of a drawer, so the iPhone keyboard no
  longer pushes the form off screen. A torrent's limits and options show
  read-only in its detail drawer, and the bulk page shows the limit the selected
  torrents share, or "Mixed".
- The season page has per-episode Automatic and Interactive search.
- Every filtered list names its active filters as removable chips, with a dot on
  the filter button and Clear all. Instance menus say which app an instance
  belongs to.
- Recommendations shows how many titles are excluded and links to a new Excluded
  titles page, where a title hidden with Not interested or a dislike can be
  shown again.
- Discover and Anime Explore say what a sort preset leaves out: the vote floor
  behind Highly Rated and Most Loved, "not out yet" for Upcoming, and the season
  behind Seasonal.
- Torrents has a Layout setting: Automatic (a table on wide screens, cards on
  phones), Cards, or Table.

### Changed

- Import-confirmed removals in the Download Cleaner are stricter (see Fixed).
  A pack the arr never fully imports now stays in qBittorrent until it is
  imported or removed by hand. A download no arr grabbed is never removed by
  these rules. While one configured arr cannot be read, these removals pause and
  the affected torrents are reported as skipped. Plain ratio and seed-time rules
  are unchanged.
- Links into Discover, Anime Explore, Anime Library, and Activity (a studio
  chip, "View all", a notification) open a temporary view and no longer
  overwrite saved filters.
- Manually imported downloads leave the Activity queue on their own. Queue items
  that need an import say why and offer Import.
- Detail pages use the full width on desktop, and edit forms sit in a centred
  column. Small controls get a 44px tap area on phones without moving.
- Prowlarr's Delete indexer and Jellyfin's Restart and Shut down moved into
  menus, away from one-tap reach.

### Fixed

- The Download Cleaner removed a torrent, with its files, that Sonarr had only
  partly imported. A single import event for the torrent counted as imported, so
  a season pack with one episode imported and nine held for manual import was
  deleted. A torrent now counts as imported only when no arr queue still lists
  it, every arr that grabbed it has an import as the newest event for each
  episode or movie, and every configured arr's queue and history could be read
  to the end.
- A malformed arr queue response, or a page shorter than the arr's reported
  total, counts as an unreadable queue instead of an empty one. The queue
  cleaner already stops its cycle on an unreadable queue.
- Activity's Sources filter no longer sticks on the app named in a notification
  link.
- Automatic searches no longer report "started" when the arr rejected them.
- Manual imports from Activity carry the release group, indexer flags, and
  release type, so imported files keep their release group.
- After switching alternative speed limits, the torrent settings show the limits
  now in force.
- Long release names stay inside dialogs and drawers. Dialogs and sheets cap
  their height and scroll, and save bars, the bulk bar, and toasts sit above the
  tab bar and the home indicator.
- On small phones the Monitor drawer keeps Apply and Cancel visible, Calendar
  opens with today in view, the Activity queue detail drawer scrolls, and long
  text no longer squeezes or spills at 344px.
- The Recommendations Feed card no longer runs under the bottom tab bar or the
  now-playing bar, which hid Share and Not interested.
- The phone More menu no longer puts its first row under the status bar when the
  navigation is at the bottom, and fits sixteen entries on an 874pt-tall phone
  instead of hiding Settings behind a scroll.
- The dashboard Edit button no longer sits on top of the mini video player.
- Rails start at the page edge instead of flush against the screen, and text on
  tinted pills and banners is readable in the light theme.

### Security

- Production dependencies were updated to patched releases: `next` 16.3.6,
  `axios` 1.20.0, `undici` 7.29.1, `sharp` 0.35.5, `source-map-js` 1.2.2, and the
  pinned `brace-expansion` 1, 2, and 5 lines. `npm audit --omit=dev` reports no
  known advisories at release.

## [1.5.1] - 2026-09-17

### Fixed

- Paging one Watch carousel moved another. Each row's scroll offset was stored
  under its link or, for a row without one, its title, so two rows that resolved
  to the same key shared a single position.
- Cards stayed blank when paging a carousel past its first page. The rows mount
  only the cards near the viewport, and that decision read `scrollLeft`, which
  does not change when the arrows translate the track with a transform. Visibility
  is now measured against the viewport itself and keeps refreshing while the track
  is still moving.
- Episodes and seasons in the cinematic carousels showed their own still instead
  of the show's artwork, unlike Continue Watching and Next Up.
- Album and artist covers were missing from the phone detail screen. Music items
  were given the 16:9 backdrop frame used for video, which they have no image
  for; they now use a square frame that shows the whole cover, and the autoplay
  preview is left to video.

## [1.5.0] - 2026-09-13

### Added

- A new **Watch** section plays a Jellyfin library inside Helprr instead of
  handing off to another app. Movies, episodes, and music play in-app with direct
  play, remux, or server-side HLS transcode chosen from a real browser capability
  profile.
- The player carries the controls a long watch actually needs: audio and
  subtitle track selection before and during playback, ASS/SSA rendering through
  the same libass worker jellyfin-web uses, burned-in PGS bitmaps, trickplay
  thumbnail previews while scrubbing, chapter markers, playback rate, and resume
  from where the last device stopped.
- Watch home leads with a billboard and shaped rails: continue watching, next up,
  recently added, per-library rows, and Helprr recommendations. Hovering a card
  on a wide screen expands it in place with a muted preview.
- Watch also has New & Popular with a Coming Soon agenda drawn from the Sonarr,
  Radarr, and Lidarr calendars, a search wall across every item type, My List,
  Browse, a Live TV channel guide, collection hubs, and Top 10 rows.
- Detail pages show a multi-provider rating strip (IMDb, TMDb, Metacritic, Rotten
  Tomatoes, Trakt) sourced from the *arr instance that owns the title, the exact
  media file and its audio/subtitle streams, and whether the title is already
  downloading.
- Movie and series pages gain a **Play in Helprr** action when the title exists in
  the Jellyfin library.
- **Settings → Appearance → Watch** adds a Cinematic mode toggle for the
  streaming-service layout and an Autoplay previews toggle, since previews can
  make the server transcode.
- Minimizing the player keeps audio going in a now-playing bar, so browsing the
  library does not stop playback.
- Each member watches as themselves. Playback now runs on the member's own
  Jellyfin account, so Jellyfin's dashboard shows who is watching, the position
  bar tracks live, and Playback Reporting attributes the session. Signing in with
  Jellyfin connects the account automatically; **Settings → Account** adds a
  connect option for members who use a Helprr password.
- Trying to watch without a connected Jellyfin account shows a sign-in panel over
  the player rather than an error, and playback starts as soon as it succeeds.
- **Settings → Users** marks members who are linked to a Jellyfin account but
  have not connected it yet, so it is clear who still cannot watch.
- Live TV playback and chapter markers ship without feature-flow testing: the
  reference server has no tuner and no item reached during testing carried
  chapters. Both degrade to an absent control rather than an error.
- Helprr connects to Jellyfin 12. The client uses the documented `/UserViews`,
  `/Items`, `/Items/Latest`, and `/Items/{itemId}` routes with an explicit user
  id, and authenticates with the standard `Authorization: MediaBrowser` header,
  so it works on a server that has legacy authorization disabled. Jellyfin
  10.11 remains qualified.
- Detail pages describe what a title actually is — Dolby Vision, HDR, Atmos,
  resolution, and subtitle availability read from the real media file — instead
  of a fixed "HD CC" label.

### Changed

- Navigating inside the app replaces the page immediately with a loading view in
  the already-loaded shell, and the navigation controls stay usable while the
  route downloads. Same-page filter, query-string, and hash changes keep the
  current controls.
- Helprr asks for less mobile data. Recent dashboard data is reused for up to 30
  seconds, unobserved widget requests are cancelled on leaving a page, Watch
  genre rows wait until they approach the viewport, logs load 200 entries before
  the existing 1,000-entry expansion, and media download summaries poll every 60
  seconds when idle instead of continuously.
- The installed app precaches far less on first load. The optional libass
  subtitle engines (about 7.7 MB) are fetched on demand during playback rather
  than up front, which cut precached bytes by roughly 86%. The offline fallback
  and authenticated API cache rules are unchanged.
- Watch rails are windowed, player chrome loads lazily, artwork is requested at
  the size it is displayed at, and the torrents view reads incremental deltas, so
  navigation stays responsive on a phone.

### Fixed

- Watching in Helprr was attributed to nobody in Jellyfin. The session showed no
  user, its live position never advanced because Jellyfin rejected every progress
  report, and playback analytics had nothing to record against. Resume points and
  watched state were always correct; only attribution was missing.
- A Jellyfin token revoked while a transcode was playing left the player stalled
  on a frozen frame indefinitely, because HLS segment failures are handled inside
  hls.js and its retry for network errors is unbounded. Playback now stops and
  offers reconnection.
- Interactive search and grab wait up to 300 seconds for Radarr, Sonarr, and
  Lidarr indexer queries instead of aborting at the default 30-second HTTP
  timeout.
- Scroll position is restored across the whole application. Navigation used to
  hide the outgoing page, which collapsed its height and overwrote the saved
  position with zero, so returning to a long list started at the top. Scroll
  ownership now lives in one controller in the app shell, restores nested
  scrollers as content arrives, yields to a real scroll gesture, and rebuilds
  infinite-scroll depth after the payload cache expires.
- The anime library returned to the wrong tab, and its offset was lost because
  restoring the tab was treated as a view switch.
- An installed iOS app in standalone mode lost its scroll position on back,
  because it commits the destination route before delivering the popstate for
  it. Safari on the same device was unaffected.
- The PWA's offline page never worked. `/offline.html` was missing from the
  public route allowlist, so the service worker precached the login redirect
  under that key, and its Retry button was inert under the production CSP.
- The installed app could not rotate, and its icon was letterboxed on the home
  screen.
- Edge-anchored sheets, drawers, and the queue panel could sit under a phone's
  home indicator and notch.
- Sharing a link into Helprr from another app sent it to the host that was
  asked for rather than the container's bind address.

### Security

- The browser never receives a Jellyfin API key. Catalog reads, `PlaybackInfo`,
  and every stream, subtitle, attachment, and font byte pass through
  capability-checked Helprr routes.
- The media proxy forwards only allowlisted playback paths, resolves each request
  to an item and applies the same per-item access check as the image proxy,
  strips caller-supplied `api_key`/token query parameters, refuses upstream
  redirects, and rewrites HLS playlists onto Helprr URLs.
- Playback uses a per-browser device id so one Helprr user cannot take over
  another's Jellyfin session.
- Playback no longer runs on the Jellyfin admin API key. It uses the member's own
  access token, and refuses to play rather than quietly falling back to the admin
  key, so a session can never be more privileged than the member driving it. The
  media proxy is signed the same way, which means Jellyfin also enforces that
  member's own library permissions on the streamed bytes.
- Member Jellyfin access tokens are encrypted at rest (AES-256-GCM). A token that
  cannot be decrypted after a secret rotation is treated as absent and the member
  is asked to reconnect. Tokens are never included in any API response.
- Connecting a Jellyfin account only ever connects the account already linked to
  that profile; valid credentials for a different Jellyfin user are refused, so a
  member cannot watch or record history as somebody else. The connect endpoint
  shares the per-IP, per-username, and global backoff limits used by sign-in.
- A Jellyfin administrator revoking a device now takes effect in Helprr: the
  rejected request drops the stored token and the member is asked to reconnect,
  including mid-stream.
- The production Content-Security-Policy now allows `'wasm-unsafe-eval'`, blob
  workers and media, and data-URI fonts, which subtitle rendering and HLS
  playback require.
- `next` 16.2.11 -> 16.3.3 for a critical Image Optimization API RCE on AVIF
  input (GHSA-2xp9-vwfh-vxw4) and CVE-2026-75604, and `sharp` 0.35.4 for a high
  libheif advisory (GHSA-rgj7-g3m4-5g8c). The service worker caches
  `/_next/image`, so the image path was reachable in this deployment.
- The base image's OpenSSL is patched during the build so the release image
  passes the blocking vulnerability scan.

## [1.4.0] - 2026-08-26

### Added

- Movie and series detail pages show a live download card for that title, with
  per-release status, season or episode labeling, quality, progress, sizes,
  download client, and a humanized time remaining. The card starts collapsed so
  it does not dominate mobile space.
- Seerr request filters now include `completed` and `deleted`, matching the full
  upstream Jellyseerr status set.
- Detail pages show locale metadata: original language and production or origin
  country for movies, series, and anime.
- Unscoped search with no library matches offers scoped TMDB, AniList, and other
  fallbacks while preserving the typed query.
- Calendar agenda is window-virtualized so only nearby rows mount and artwork
  outside the viewport is not fetched.
- Settings → Storage reports image-cache health, queue and running work,
  hit/stale/miss counts, and a copy-safe diagnostic summary. The same bounded
  summary is included in administrator support bundles.

### Changed

- Dashboard widgets lazy-load, gate work by capability, configured service, and
  viewport proximity, and pause polling when offscreen.
- The authenticated shell fetches watch-status and pending-request data only
  while a consumer needs it. The command palette dialog loads on first open.
- Search reuses the cached Arr library instead of refetching it on every query.
- Activity history fetches a bounded upstream window for common filters and
  reports when a local-only scan was truncated.
- Image-cache bytes persist across app-container replacement on dedicated
  Compose volumes. Fresh and stale hits skip the processing queue; true misses
  use a fair queue, per-user and global running limits, and stale-while-revalidate.
- Logging persists in ordered batches, caps outstanding log memory, and
  coalesces retention scans.

### Fixed

- Android PWA pushes now send with high urgency and Doze-safe TTLs so FCM can
  deliver while the device is asleep.
- Lidarr artist and album covers load through Lidarr's authenticated media-cover
  API, including reverse-proxy bases and custom headers.
- Image caching works again after a Redis Lua empty-eviction encoding bug that
  discarded successful fills and left posters blank.
- Cold poster loading is retryable on the client, bounded on the server, and no
  longer returns 429 merely because the processing limiter is busy.
- Storage Usage widget rows scroll inside the dashboard card instead of being
  clipped.
- Anime Explore and credits pages distinguish failed requests from empty
  results, keep cached data after a background-refetch failure, and stop
  infinite-scroll auto-retry after a failed next page.
- Notification device lists stay in sync after register, reconcile, revoke,
  unsubscribe, and service-worker endpoint rotation, without exposing push key
  material in API DTOs.

### Security

- Authenticated GET routes enforce capabilities and filtered service reads
  before upstream work.
- Login, Jellyfin auth, and Web Share Target bodies are bounded. Usernames are
  limited to 64 Unicode characters and passwords to 1,024 UTF-8 bytes; the
  15-character local-password minimum is unchanged.
- The image proxy accepts only validated JPEG, PNG, and WebP within byte and
  pixel limits, with atomic quota and LRU accounting, generation-safe purge, and
  fail-soft Redis bypass.
- Cross-tab auth cache boundaries and sensitive request logging were tightened.
- Transitive production dependencies were pinned to patched `brace-expansion@5`,
  `deepmerge-ts`, `nanoid@3`, and `undici@7`.

## [1.3.0] - 2026-07-29

### Added

- A shared data-table experience for movies, series, music, and torrents with
  resizable columns, persisted widths and page sizes, sortable headers,
  pagination, and horizontal mobile scrolling.
- Branded loading, error, retry, and not-found states across primary routes, with
  clearer separation between an upstream failure and a genuinely empty result.
- Field-level connection validation and accessible page, tab, control, and touch
  semantics across administration and media-management surfaces.

### Changed

- Light mode now uses scheme-aware image scrims, hero blends, status colors, and
  custom-theme detection instead of washed-out overlays.
- Activity queue sorting now lives in the filter menu, preserves the selected
  field and direction, and reverses direction when the active sort is selected
  again.
- Settings with automatic or deferred saves now flush pending edits, expose
  unsaved state where appropriate, and guard navigation away from dirty forms.
- Media deletion prompts use a consistent dialog flow, segmented controls use
  proper tab semantics, and shared tables support opt-in sticky headers.
- Tablet navigation, mobile toolbar geometry, page spacing, image fallbacks, and
  responsive controls received a broad interaction and visual-polish pass.

### Fixed

- iOS Safari and installed PWAs no longer lift long-pressed poster cards above
  context menus, and TokenInput suggestions reliably select without accidental
  follow-up choices.
- Activity pull-to-refresh no longer captures normal downward scrolling when the
  document or nested content is away from the top.
- Failed storage, media-detail, episode, album, and torrent requests no longer
  render misleading zero, empty, or not-found states; affected views provide a
  truthful retry path.
- Torrent file navigation and zero-file messaging, calendar control sizing,
  no-backdrop header spacing, tablet sidebar defaults, and mobile media toolbars
  now behave consistently at their supported breakpoints.

### Security

- Next.js, Serwist, Sharp, PostCSS, and both supported `brace-expansion` lines
  were updated or pinned to patched versions, clearing the blocking
  high/critical release-image scan findings.

## [1.2.0] - 2026-07-17

### Added

- A learning recommendation engine with personalized rails, a dedicated feed,
  trailer-aware suggestions, event-driven taste profiles, and a refreshed random
  watch experience.
- Context actions across media, anime, watchlist, activity, and management surfaces,
  including quick add, request, watch-state, and destructive actions where permitted.
- Reusable multi-instance selectors on the Radarr, Sonarr, and Lidarr add pages that
  preserve the selected service instance while resetting instance-local choices.
- Cleanup scope discovery and clearer per-instance targeting for queue and download
  cleaner configuration and previews.
- CI: pull requests now build the amd64 image and run the same pinned,
  blocking Trivy scan as publishes, so vulnerabilities surface at review time.
- Branch protection on `main` (PR + passing `lint-and-build` and `image-scan`
  checks required, admins included) and on `development` (force pushes and
  deletion blocked).

### Changed

- Cleanup configuration now uses searchable token inputs, responsive field layouts,
  clearer run previews, and more truthful labels for destructive options.
- Sticky toolbars, horizontal media rails, logs, service instances, sessions, users,
  torrents, and library pages have improved mobile and desktop interaction polish.
- Maintainer documentation now records the protected-branch release flow, exact
  edge-to-stable qualification gates, and the application's architecture and context
  action conventions.

### Security

- Cleanup execution revalidates queue and download candidates immediately before
  deletion, binds previews more tightly to the selected scope, and preserves accurate
  per-item results when upstream state changes.

### Fixed

- Add pages preserve the selected instance.
- Comma-containing ignored-download entries remain intact when cleanup settings are
  edited or saved.
- Sticky page controls no longer interfere with media scrolling and mobile layout
  geometry across supported screen sizes.
- Re-running the publish workflow on an existing tag no longer fails the
  release-draft job; it skips creation when the release already exists.
- Uninstall docs referenced the `edge` image tag; the stable stack uses
  `stable` (or a pinned version).
- `.env.example` no longer suggests pointing the stable stack's
  `HELPRR_VERSION` at `edge`; development builds belong to the isolated dev
  stack.

## [1.1.0] - 2026-07-14

### Added

- An isolated development Docker stack with dedicated containers, database, Redis,
  volumes, network, secrets, and port `3051`, so `edge` and source builds can run
  beside stable without sharing production data.
- A separate unauthenticated `/api/ready` endpoint for bounded PostgreSQL, Redis, and
  exact migration-history readiness checks; `/api/health` remains liveness-only.
- Safe `scripts/setup-env.sh` and `scripts/backup.sh` helpers. The setup helper creates
  private, independent secrets without overwriting existing env files; the backup
  helper creates and validates private PostgreSQL custom-format snapshots without
  stopping containers.
- Admin update notices and downloadable, bounded support bundles with credential and
  token redaction.
- A maintained upstream compatibility baseline covering every supported service type
  and the exact versions exercised during release qualification.
- A complete no-clone release package: tagged releases now include Compose, the env
  template, setup helper, and backup helper from the exact tagged commit.

### Security

- Manual cleanup execution now requires a short-lived, single-use preview token bound
  to the authenticated user, cleanup type, configuration, and candidate snapshot.
  Queue/download candidates are revalidated immediately before deletion, and partial
  results are reconciled truthfully in cleanup history.
- Destructive media, album, torrent, and queue operations now share an operation-audit
  model that records actor, target, data/file disposition, and success or failure while
  preserving ownership validation for file-level actions.
- Startup rejects missing, malformed, placeholder, or shipped example credentials
  before polling, cleanup, logging timers, or other background services begin, with
  redacted variable-only errors.
- New local passwords require at least 15 Unicode characters across bootstrap, user
  creation, and resets. Password resets revoke the target user's active sessions, and
  role/capability changes take effect on the next request.
- Settings imports now have bounded hostile-input handling and stricter password-hash,
  prototype-shaped-key, member/global-scope, and auth-before-read coverage.
- Every mutating API handler is covered by a source-derived authorization-policy
  matrix, including dynamic, ownership-aware, self/session, admin, and public routes.
- Native amd64 and arm64 images are scanned with pinned Trivy before either digest can
  reach a release manifest. Fixable high/critical OS or library findings and EOL base
  images block publication; npm, npx, and Corepack are removed from the runtime image.

### Changed

- Expired sessions, operation audits, cleanup and settled-alert history, notification
  history, and orphaned image-cache generations now have bounded retention. Image
  cleanup fails closed when Redis state cannot be safely reconciled.
- CI now reconstructs the `1.0.0` database snapshot, seeds representative data, applies
  all current Prisma 6 migrations, and verifies preservation and the resulting schema.
- Stable and development Compose usage is documented as two standalone stacks; the
  development file must never be layered over the stable stack.
- No-clone install and update instructions use one latest or exact tagged asset set and
  take a validated backup before replacing deployment files or pulling an image.

### Fixed

- ARM64 Trivy scans now receive the native build-matrix platform instead of defaulting
  to amd64 when scanning an ARM64-only digest.
- Cleanup UI and history now preserve per-item partial failures instead of presenting a
  destructive run as wholly successful when upstream state changed or an item failed.

## [1.0.0] - 2026-07-13

### Added

- Lidarr album deletion (with an optional delete-files-from-disk checkbox) and
  per-track file deletion from the album page; track file deletion goes through
  the ownership-validated, audited endpoint.
- The installed version and commit are shown in Settings → Status.
- Test suite (`npm test`, vitest) covering capability resolution, file-ownership
  guards, cleanup queue pagination, and VAPID key resolution — runs in CI ahead
  of every image build.
- Version tags now draft a GitHub release with `docker-compose.yml` and
  `.env.example` attached, so installs can fetch the files matching their
  exact version.
- README operations guide: updating, backup (`pg_dump`) and restore
  (including fresh-host disaster recovery), uninstalling (with a
  `down -v` data-loss warning), and a plain-language list of every feature
  that can delete media files.
- GPL-3.0 license, security policy, changelog, and GitHub issue templates.
- iOS Shortcuts guide (`docs/ios-shortcuts.md`) covering the `/protocol`
  deep-link surface and share-sheet integration.
- CI workflow (lint + build on pushes and pull requests) and a Docker publish
  workflow: multi-arch (amd64/arm64) images on GHCR — `edge` from the
  development branch, semver + `stable` channel tags from release tags.

### Security

- Single episode/track file deletion now goes through the bulk routes, which
  validate that every file id belongs to the stated series/artist and write a
  file audit record; the unguarded `/api/sonarr/episodefile/[id]` and
  `/api/lidarr/trackfile/[id]` routes are removed. Lidarr file deletes are now
  audited (visible in Settings → File audit).
- Creating Sonarr/Radarr/Lidarr tags now requires the matching `*.editTags`
  capability; previously view-only users could create upstream tags.
- The cleanup queue cleaner now paginates past 1,000 items and skips an
  instance entirely (with a logged error) if its queue cannot be fetched
  completely — a truncated view silently exempted the tail from rules and
  strike handling.

### Fixed

- `.env.example` no longer sets `DATABASE_URL`/`REDIS_URL`: saved as `.env` for
  the Docker quick start, the old `localhost` values overrode compose's
  container wiring and made the app crash-loop with "Can't reach database
  server". Both are now commented out with Docker/local-dev guidance.
  (Caught by the fresh-install drill.)
- Interactive search, release grabs, download-client overrides, Add-page
  lookups, AniList mapping actions, and the Activity refresh now target the
  selected Sonarr/Radarr/Lidarr instance instead of always using the default.
- Graceful shutdown: the container previously ran node behind `sh -c`, so
  SIGTERM never reached the app and every update hard-killed it after
  Docker's grace period. The entrypoint now execs node as PID 1, and a
  shutdown coordinator stops polling/cleanup timers, drains in-flight cycles
  (bounded at 30s), flushes logs, and disconnects Prisma/Redis before exit.
  Compose sets `stop_grace_period: 45s`.

### Changed

- The VAPID public key is now runtime configuration served via an
  authenticated `GET /api/push/public-key` (canonical env name
  `VAPID_PUBLIC_KEY`; the old `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is still
  accepted). Web Push now works with the prebuilt image, and rotating keys no
  longer requires a rebuild.
- `docker-compose.yml` now pulls the published `ghcr.io/saibarathr/helprr`
  image (`HELPRR_VERSION`, default `stable`) instead of building from source.
  Building from source moved to `docker-compose.dev.yml`.
- `allowedDevOrigins` in `next.config.ts` is now read from the optional
  `ALLOWED_DEV_ORIGINS` env var (comma-separated) instead of being hardcoded.

### Removed

- `npm run start` — unsupported with the standalone output the production
  image uses; deploy with Docker (`node server.js` inside the image).
