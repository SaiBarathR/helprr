// Jellyfin and its Playback Reporting plugin, answered from the invented library
// (demo/library.mjs). Plays are a made-up table that the plugin's SQL runs against, in a
// read-only SQLite database, so every chart Helprr draws gets a real answer.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hex, iso } from '../library.mjs';
import { raw } from './raw.mjs';

const TICKS = 10_000_000; // per second
const DAY = 86_400_000;
const SERVER_ID = hex('server', 32);
const id = (kind, n) => hex(`${kind}${n}`, 32);

// ---- the catalogue -----------------------------------------------------------------
export function buildCatalog(lib) {
  const views = [
    { Id: id('view', 'movies'), Name: 'Movies', CollectionType: 'movies', path: '/media/movies' },
    { Id: id('view', 'tv'), Name: 'Shows', CollectionType: 'tvshows', path: '/media/tv' },
    { Id: id('view', 'music'), Name: 'Music', CollectionType: 'music', path: '/media/music' },
  ];
  const [moviesView, tvView, musicView] = views;
  const items = [];
  const userData = (key, played, position = 0, playCount = played ? 1 : 0) => ({
    PlaybackPositionTicks: position, PlayCount: playCount, IsFavorite: false, Played: played, Key: key, ItemId: key,
  });
  const base = (fields) => ({ ServerId: SERVER_ID, ChannelId: null, ImageTags: { Primary: 'demo' }, BackdropImageTags: ['demo'], ImageBlurHashes: {}, LocationType: 'FileSystem', ...fields });

  for (const movie of lib.movies.filter((m) => m.hasFile)) {
    items.push(base({
      Id: id('movie', movie.id), Name: movie.title, OriginalTitle: movie.title, SortName: movie.sortTitle, Type: 'Movie', MediaType: 'Video', IsFolder: false,
      ParentId: moviesView.Id, view: moviesView.Id, Overview: movie.overview, Genres: movie.genres, GenreItems: movie.genres.map((g) => ({ Name: g, Id: id('genre', g) })),
      Studios: [{ Name: movie.studio, Id: id('studio', movie.studio) }], ProductionYear: movie.year, PremiereDate: movie.inCinemas, DateCreated: movie.added,
      CommunityRating: movie.ratings.tmdb.value, CriticRating: Math.round(movie.ratings.imdb.value * 10), OfficialRating: movie.certification,
      RunTimeTicks: movie.runtime * 60 * TICKS, ProviderIds: { Tmdb: String(movie.tmdbId), Imdb: movie.imdbId }, Container: 'mkv', HasSubtitles: true,
      PrimaryImageAspectRatio: 2 / 3, VideoType: 'VideoFile', Taglines: [], LocalTrailerCount: 0, SpecialFeatureCount: 0,
      People: lib.cast(movie.id).slice(0, 4).map((c) => ({ Name: c.name, Id: id('person', c.id), Role: c.character, Type: 'Actor' })),
      MediaStreams: [{ Index: 0, Type: 'Video', Codec: 'hevc', Width: 1920, Height: 1080, DisplayTitle: '1080p HEVC SDR', IsDefault: true },
        { Index: 1, Type: 'Audio', Codec: 'eac3', Channels: 6, ChannelLayout: '5.1', Language: 'eng', DisplayTitle: 'English - Dolby Digital+ - 5.1 - Default', IsDefault: true },
        { Index: 2, Type: 'Subtitle', Codec: 'subrip', Language: 'eng', DisplayTitle: 'English - SUBRIP', IsTextSubtitleStream: true, IsDefault: false }],
      UserData: userData(id('movie', movie.id), movie.id % 3 === 0, movie.id % 7 === 1 ? movie.runtime * 25 * TICKS : 0),
    }));
  }

  for (const show of lib.series) {
    const showId = id('series', show.id);
    const mine = lib.episodes.filter((ep) => ep.seriesId === show.id && ep.hasFile);
    if (!mine.length) continue;
    const watchedUpTo = show.id % 4 === 0 ? mine.length : Math.floor(mine.length * ((show.id % 5) / 5));
    items.push(base({
      Id: showId, Name: show.title, OriginalTitle: show.title, SortName: show.sortTitle, Type: 'Series', IsFolder: true, ParentId: tvView.Id, view: tvView.Id,
      Overview: show.overview, Genres: show.genres, GenreItems: show.genres.map((g) => ({ Name: g, Id: id('genre', g) })),
      Studios: [{ Name: show.network, Id: id('studio', show.network) }], ProductionYear: show.year, PremiereDate: show.firstAired, DateCreated: show.added,
      CommunityRating: show.ratings.value, OfficialRating: show.certification, Status: show.ended ? 'Ended' : 'Continuing', RunTimeTicks: show.runtime * 60 * TICKS,
      ProviderIds: { Tvdb: String(show.tvdbId), Tmdb: String(show.tmdbId), Imdb: show.imdbId }, PrimaryImageAspectRatio: 2 / 3,
      RecursiveItemCount: mine.length, ChildCount: show.seasons.length,
      UserData: { ...userData(showId, watchedUpTo === mine.length), UnplayedItemCount: mine.length - watchedUpTo, PlayedPercentage: Math.round((watchedUpTo / mine.length) * 100) },
    }));
    for (const season of show.seasons) {
      const seasonId = id(`season${show.id}-`, season.seasonNumber);
      const eps = mine.filter((ep) => ep.seasonNumber === season.seasonNumber);
      if (!eps.length) continue;
      items.push(base({
        Id: seasonId, Name: `Season ${season.seasonNumber}`, SortName: `Season ${String(season.seasonNumber).padStart(3, '0')}`, Type: 'Season', IsFolder: true,
        ParentId: showId, view: tvView.Id, SeriesId: showId, SeriesName: show.title, IndexNumber: season.seasonNumber, ProductionYear: show.year,
        ChildCount: eps.length, RecursiveItemCount: eps.length, DateCreated: show.added, PrimaryImageAspectRatio: 2 / 3, UserData: userData(seasonId, false),
      }));
      for (const ep of eps) {
        const index = mine.indexOf(ep);
        const epId = id('episode', ep.id);
        items.push(base({
          Id: epId, Name: ep.title, SortName: `${String(ep.seasonNumber).padStart(3, '0')}-${String(ep.episodeNumber).padStart(4, '0')}`, Type: 'Episode', MediaType: 'Video',
          IsFolder: false, ParentId: seasonId, view: tvView.Id, SeasonId: seasonId, SeasonName: `Season ${ep.seasonNumber}`, SeriesId: showId, SeriesName: show.title,
          IndexNumber: ep.episodeNumber, ParentIndexNumber: ep.seasonNumber, PremiereDate: ep.airDateUtc, DateCreated: iso(Date.parse(ep.airDateUtc) + 2 * 3_600_000),
          ProductionYear: Number(ep.airDate.slice(0, 4)), Overview: show.overview, RunTimeTicks: ep.runtime * 60 * TICKS, Container: 'mkv', HasSubtitles: true,
          ProviderIds: { Tvdb: String(95_000_000 + ep.id) }, SeriesPrimaryImageTag: 'demo', ParentBackdropItemId: showId, ParentBackdropImageTags: ['demo'],
          PrimaryImageAspectRatio: 16 / 9, VideoType: 'VideoFile', ImageTags: { Primary: 'demo' },
          UserData: userData(epId, index < watchedUpTo, index === watchedUpTo && show.id % 3 === 1 ? ep.runtime * 20 * TICKS : 0),
        }));
      }
    }
  }

  for (const artist of lib.artists) {
    const artistId = id('artist', artist.id);
    items.push(base({ Id: artistId, Name: artist.name, SortName: artist.name.toLowerCase(), Type: 'MusicArtist', IsFolder: true, ParentId: musicView.Id, view: musicView.Id,
      Overview: artist.overview, Genres: artist.genres, DateCreated: artist.added, PrimaryImageAspectRatio: 1, UserData: userData(artistId, false) }));
    for (const album of lib.albums.filter((a) => a.artistId === artist.id && a.trackFileCount)) {
      const albumId = id('album', album.id);
      items.push(base({ Id: albumId, Name: album.title, SortName: album.title.toLowerCase(), Type: 'MusicAlbum', IsFolder: true, ParentId: musicView.Id, view: musicView.Id,
        AlbumArtist: artist.name, Artists: [artist.name], AlbumArtists: [{ Name: artist.name, Id: artistId }], ArtistItems: [{ Name: artist.name, Id: artistId }],
        ProductionYear: Number(album.releaseDate.slice(0, 4)), PremiereDate: album.releaseDate, DateCreated: artist.added, Genres: album.genres,
        RunTimeTicks: (album.duration / 1000) * TICKS, ChildCount: album.trackCount, PrimaryImageAspectRatio: 1, UserData: userData(albumId, false) }));
      for (let t = 1; t <= album.trackCount; t++) {
        const trackId = id(`track${album.id}-`, t);
        items.push(base({ Id: trackId, Name: `Track ${t}`, SortName: String(t).padStart(4, '0'), Type: 'Audio', MediaType: 'Audio', IsFolder: false, ParentId: albumId,
          view: musicView.Id, AlbumId: albumId, Album: album.title, AlbumArtist: artist.name, Artists: [artist.name], ArtistItems: [{ Name: artist.name, Id: artistId }],
          IndexNumber: t, ParentIndexNumber: 1, RunTimeTicks: Math.round(album.duration / album.trackCount / 1000) * TICKS, ProductionYear: Number(album.releaseDate.slice(0, 4)),
          DateCreated: artist.added, ImageTags: {}, AlbumPrimaryImageTag: 'demo', UserData: userData(trackId, false) }));
      }
    }
  }

  // Each view's newest addition and size, for the library cards.
  for (const view of views) {
    const mine = items.filter((item) => item.view === view.Id);
    view.count = mine.filter((item) => ['Movie', 'Series', 'MusicAlbum'].includes(item.Type)).length;
    view.lastAdded = mine.map((item) => item.DateCreated).sort().at(-1);
  }
  const byId = new Map(items.map((item) => [item.Id, item]));
  return { views, items, byId };
}

// ---- plays (Playback Reporting) ----------------------------------------------------
// Sixty days of invented plays: who watched what, when, where and how. Only what was in
// the library before today is played, and every number is drawn, so the plays stay the
// same all day however often they are rebuilt.
function buildPlays(lib, catalog) {
  const before = iso(lib.today);
  const watchable = catalog.items.filter((item) => (item.Type === 'Movie' || item.Type === 'Episode') && item.DateCreated < before);
  const rows = [];
  let rowid = 1;
  for (let day = 59; day >= 0; day--) {
    const count = 2 + Math.floor(lib.rand() * 5);
    for (let n = 0; n < count; n++) {
      const user = lib.users[Math.floor(lib.rand() * lib.users.length)];
      const item = watchable[Math.floor(lib.rand() * watchable.length)];
      const device = lib.devices[Math.floor(lib.rand() * lib.devices.length)];
      const hour = [8, 12, 18, 19, 20, 21, 22, 23][Math.floor(lib.rand() * 8)];
      const at = lib.today - day * DAY + hour * 3_600_000 + Math.floor(lib.rand() * 59) * 60_000;
      const seconds = Math.round((item.RunTimeTicks / TICKS) * (0.3 + lib.rand() * 0.7));
      const direct = lib.rand() > 0.3;
      if (at > lib.now) continue;
      rows.push({
        rowid: rowid++, DateCreated: new Date(at).toISOString().replace('T', ' ').slice(0, 19), UserId: user.id.replace(/-/g, ''), ItemId: item.Id,
        ItemType: item.Type, ItemName: item.Type === 'Episode' ? `${item.SeriesName} - s${String(item.ParentIndexNumber).padStart(2, '0')}e${String(item.IndexNumber).padStart(2, '0')} - ${item.Name}` : item.Name,
        PlaybackMethod: direct ? 'DirectPlay' : 'Transcode (v:direct a:aac)', ClientName: device.client, DeviceName: device.name, PlayDuration: seconds,
      });
    }
  }
  return rows;
}

// One play database at a time: a rebuild closes and removes the one before.
let playDb = null;
process.once('exit', () => closePlays());
// docker stop and Ctrl-C end the process without "exit" running on its own.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    closePlays();
    process.exit(0);
  });
}
function closePlays() {
  if (!playDb) return;
  playDb.db.close();
  rmSync(playDb.dir, { recursive: true, force: true });
  playDb = null;
}

function openPlays(rows) {
  closePlays();
  const dir = mkdtempSync(join(tmpdir(), 'helprr-demo-'));
  const file = join(dir, 'playback.db');
  const writer = new DatabaseSync(file);
  writer.exec(`CREATE TABLE PlaybackActivity (DateCreated DATETIME NOT NULL, UserId TEXT, ItemId TEXT, ItemType TEXT, ItemName TEXT,
    PlaybackMethod TEXT, ClientName TEXT, DeviceName TEXT, PlayDuration INT)`);
  const insert = writer.prepare('INSERT INTO PlaybackActivity (rowid, DateCreated, UserId, ItemId, ItemType, ItemName, PlaybackMethod, ClientName, DeviceName, PlayDuration) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const r of rows) insert.run(r.rowid, r.DateCreated, r.UserId, r.ItemId, r.ItemType, r.ItemName, r.PlaybackMethod, r.ClientName, r.DeviceName, r.PlayDuration);
  writer.close();
  // Queries run on a read-only connection: nothing they say can change the table.
  playDb = { dir, db: new DatabaseSync(file, { readOnly: true }) };
  return playDb.db;
}

function runQuery(db, sql) {
  if (!/^\s*select\b/i.test(sql)) return { colums: [], results: [], message: 'Only SELECT queries are allowed.' };
  try {
    const statement = db.prepare(sql);
    const columns = statement.columns().map((column) => column.name);
    const results = [];
    // The plugin answers every cell as a string, and spells "columns" its own way.
    for (const row of statement.iterate()) {
      results.push(columns.map((c) => (row[c] === null ? '' : String(row[c]))));
      if (results.length === 10_000) break;
    }
    return { colums: columns, results, message: '' };
  } catch (error) {
    return { colums: [], results: [], message: String(error.message) };
  }
}

// ---- answers -----------------------------------------------------------------------
function userJson(lib, user, i) {
  const lastSeen = iso(lib.now - (i * 5 + 1) * 3_600_000);
  return {
    Name: user.name, ServerId: SERVER_ID, Id: user.id, HasPassword: true, HasConfiguredPassword: true, HasConfiguredEasyPassword: false, EnableAutoLogin: false,
    LastLoginDate: lastSeen, LastActivityDate: lastSeen, PrimaryImageTag: undefined,
    Configuration: { PlayDefaultAudioTrack: true, SubtitleLanguagePreference: '', DisplayMissingEpisodes: false, GroupedFolders: [], SubtitleMode: 'Default',
      DisplayCollectionsView: false, EnableLocalPassword: false, OrderedViews: [], LatestItemsExcludes: [], MyMediaExcludes: [], HidePlayedInLatest: true,
      RememberAudioSelections: true, RememberSubtitleSelections: true, EnableNextEpisodeAutoPlay: true, CastReceiverId: 'F007D354' },
    Policy: { IsAdministrator: user.admin, IsHidden: false, EnableCollectionManagement: user.admin, EnableSubtitleManagement: user.admin, EnableLyricManagement: false,
      IsDisabled: false, BlockedTags: [], AllowedTags: [], EnableUserPreferenceAccess: true, AccessSchedules: [], BlockUnratedItems: [], EnableRemoteControlOfOtherUsers: user.admin,
      EnableSharedDeviceControl: true, EnableRemoteAccess: true, EnableLiveTvManagement: false, EnableLiveTvAccess: false, EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: true, EnableVideoPlaybackTranscoding: true, EnablePlaybackRemuxing: true, ForceRemoteSourceTranscoding: false,
      EnableContentDeletion: user.admin, EnableContentDeletionFromFolders: [], EnableContentDownloading: true, EnableSyncTranscoding: true, EnableMediaConversion: true,
      EnabledDevices: [], EnableAllDevices: true, EnabledChannels: [], EnableAllChannels: true, EnabledFolders: [], EnableAllFolders: true, InvalidLoginAttemptCount: 0,
      LoginAttemptsBeforeLockout: -1, MaxActiveSessions: 0, EnablePublicSharing: true, BlockedMediaFolders: [], BlockedChannels: [], RemoteClientBitrateLimit: 0,
      AuthenticationProviderId: 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
      PasswordResetProviderId: 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider', SyncPlayAccess: 'CreateAndJoinGroups' },
  };
}

// The internal "view" field never leaves the server.
function clean(item) {
  if (!item) return item;
  const out = { ...item };
  delete out.view;
  return out;
}

function list(items, query) {
  const start = Number(query.get('StartIndex') ?? query.get('startIndex') ?? 0);
  const limit = query.get('Limit') ?? query.get('limit');
  const slice = limit ? items.slice(start, start + Number(limit)) : items.slice(start);
  return { Items: slice.map(clean), TotalRecordCount: items.length, StartIndex: start };
}

// Jellyfin's query parameters are case-insensitive.
function params(query) {
  const lower = new Map();
  for (const [key, value] of query) lower.set(key.toLowerCase(), value);
  return { get: (key) => lower.get(key.toLowerCase()) ?? null };
}

function sortItems(items, sortBy, order) {
  const keys = (sortBy ?? 'SortName').split(',');
  const value = (item, key) => {
    switch (key) {
      case 'DateCreated': return item.DateCreated ?? '';
      case 'PremiereDate': return item.PremiereDate ?? '';
      case 'ProductionYear': return item.ProductionYear ?? 0;
      case 'CommunityRating': return item.CommunityRating ?? 0;
      case 'CriticRating': return item.CriticRating ?? 0;
      case 'Runtime': return item.RunTimeTicks ?? 0;
      case 'DatePlayed': return item.UserData?.LastPlayedDate ?? '';
      case 'PlayCount': return item.UserData?.PlayCount ?? 0;
      case 'IndexNumber': return item.IndexNumber ?? 0;
      case 'ParentIndexNumber': return item.ParentIndexNumber ?? 0;
      case 'Random': return item.Id;
      default: return item.SortName ?? item.Name ?? '';
    }
  };
  const direction = (order ?? 'Ascending').split(',')[0] === 'Descending' ? -1 : 1;
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const [x, y] = [value(a, key), value(b, key)];
      if (x < y) return -direction;
      if (x > y) return direction;
    }
    return 0;
  });
}

function filterItems(catalog, q) {
  let items = catalog.items;
  const ids = q.get('Ids');
  if (ids) { const wanted = ids.split(','); return wanted.map((x) => catalog.byId.get(x)).filter(Boolean); }
  const parentId = q.get('ParentId');
  const recursive = q.get('Recursive') === 'true';
  if (parentId) {
    const view = catalog.views.find((v) => v.Id === parentId);
    if (view) items = items.filter((item) => item.view === parentId && (recursive || item.ParentId === parentId));
    else items = recursive ? items.filter((item) => item.ParentId === parentId || item.SeriesId === parentId || item.AlbumId === parentId) : items.filter((item) => item.ParentId === parentId);
  } else if (!recursive && !q.get('IncludeItemTypes') && !q.get('SearchTerm')) {
    return catalog.views;
  }
  const types = q.get('IncludeItemTypes')?.split(',');
  if (types) items = items.filter((item) => types.includes(item.Type));
  const excluded = q.get('ExcludeItemTypes')?.split(',');
  if (excluded) items = items.filter((item) => !excluded.includes(item.Type));
  const term = q.get('SearchTerm')?.toLowerCase();
  if (term) items = items.filter((item) => item.Name.toLowerCase().includes(term));
  const genres = q.get('Genres')?.split('|');
  if (genres) items = items.filter((item) => item.Genres?.some((g) => genres.includes(g)));
  const years = q.get('Years')?.split(',').map(Number);
  if (years) items = items.filter((item) => years.includes(item.ProductionYear));
  const artist = q.get('ArtistIds') ?? q.get('AlbumArtistIds');
  if (artist) items = items.filter((item) => item.ArtistItems?.some((a) => artist.split(',').includes(a.Id)));
  if (q.get('ParentIndexNumber')) items = items.filter((item) => item.ParentIndexNumber === Number(q.get('ParentIndexNumber')));
  if (q.get('IsPlayed') === 'true') items = items.filter((item) => item.UserData?.Played);
  if (q.get('IsPlayed') === 'false') items = items.filter((item) => !item.UserData?.Played);
  if (q.get('IsFavorite') === 'true') items = items.filter((item) => item.UserData?.IsFavorite);
  const filters = q.get('Filters')?.split(',') ?? [];
  if (filters.includes('IsPlayed')) items = items.filter((item) => item.UserData?.Played);
  if (filters.includes('IsUnplayed')) items = items.filter((item) => !item.UserData?.Played);
  if (filters.includes('IsFavorite')) items = items.filter((item) => item.UserData?.IsFavorite);
  if (filters.includes('IsResumable')) items = items.filter((item) => item.UserData?.PlaybackPositionTicks > 0);
  return sortItems(items, q.get('SortBy'), q.get('SortOrder'));
}

function nextUp(catalog, q) {
  const seriesId = q.get('SeriesId');
  const out = [];
  for (const show of catalog.items.filter((item) => item.Type === 'Series' && (!seriesId || item.Id === seriesId))) {
    const eps = catalog.items.filter((item) => item.Type === 'Episode' && item.SeriesId === show.Id);
    const watched = eps.filter((ep) => ep.UserData.Played).length;
    if (!watched || watched === eps.length) continue;
    out.push(eps[watched]);
  }
  return out;
}

function sessions(lib, catalog) {
  const episode = catalog.items.find((item) => item.Type === 'Episode' && item.UserData.PlaybackPositionTicks > 0) ?? catalog.items.find((item) => item.Type === 'Episode');
  const movie = catalog.items.find((item) => item.Type === 'Movie' && item.UserData.PlaybackPositionTicks > 0) ?? catalog.items.find((item) => item.Type === 'Movie');
  const playing = [
    { device: lib.devices[0], user: lib.users[1], item: episode, paused: false, method: 'DirectPlay', progress: 0.36 },
    { device: lib.devices[1], user: lib.users[2], item: movie, paused: true, method: 'Transcode', progress: 0.62 },
  ];
  const session = (device, user, extra = {}) => ({
    Id: hex(`session${device.id}`, 32), UserId: user.id, UserName: user.name, Client: device.client, DeviceName: device.name, DeviceId: device.id,
    ApplicationVersion: '10.11.2', LastActivityDate: iso(lib.now - 30_000), LastPlaybackCheckIn: iso(lib.now - 10_000), RemoteEndPoint: '10.0.0.20',
    PlayableMediaTypes: ['Audio', 'Video'], AdditionalUsers: [], IsActive: true, SupportsMediaControl: true, SupportsRemoteControl: true, ServerId: SERVER_ID,
    Capabilities: { PlayableMediaTypes: ['Audio', 'Video'], SupportedCommands: [], SupportsMediaControl: true, SupportsPersistentIdentifier: true }, ...extra,
  });
  const active = playing.filter((p) => p.item).map((p) => session(p.device, p.user, {
    NowPlayingItem: clean(p.item),
    PlayState: { PositionTicks: Math.round(p.item.RunTimeTicks * p.progress), CanSeek: true, IsPaused: p.paused, IsMuted: false, VolumeLevel: 100,
      AudioStreamIndex: 1, SubtitleStreamIndex: -1, MediaSourceId: p.item.Id, PlayMethod: p.method, RepeatMode: 'RepeatNone', PlaybackOrder: 'Default' },
    ...(p.method === 'Transcode' ? { TranscodingInfo: { AudioCodec: 'aac', VideoCodec: 'h264', Container: 'ts', IsVideoDirect: false, IsAudioDirect: false,
      Bitrate: 8_000_000, Framerate: 23.976, CompletionPercentage: 70, Width: 1920, Height: 1080, AudioChannels: 2, HardwareAccelerationType: 'vaapi',
      TranscodeReasons: ['VideoCodecNotSupported'] } } : {}),
  }));
  const idle = lib.devices.slice(2, 4).map((device, i) => session(device, lib.users[(i + 3) % lib.users.length], { LastActivityDate: iso(lib.now - (i + 1) * 900_000) }));
  return [...active, ...idle];
}

function activityLog(lib, plays, q) {
  const users = new Map(lib.users.map((u) => [u.id.replace(/-/g, ''), u]));
  const entries = plays.slice(-60).reverse().map((play, i) => {
    const user = users.get(play.UserId);
    return { Id: 9000 - i, Name: `${user.name} is playing ${play.ItemName} on ${play.DeviceName}`, ShortOverview: '', Type: 'VideoPlayback',
      Date: iso(Date.parse(`${play.DateCreated.replace(' ', 'T')}Z`)), UserId: user.id, Severity: 'Information', ItemId: play.ItemId };
  });
  const minDate = q.get('MinDate');
  const list2 = minDate ? entries.filter((e) => Date.parse(e.Date) >= Date.parse(minDate)) : entries;
  return list(list2, q);
}

function breakdown(db, column, q, where = '') {
  const days = Number(q.get('days') ?? 7);
  const end = q.get('endDate') ?? iso(Date.now()).slice(0, 10);
  const rows = db.prepare(`SELECT ${column} as label, COUNT(*) as count, SUM(PlayDuration) as time FROM PlaybackActivity
    WHERE date(DateCreated) > date(?, ?) AND date(DateCreated) <= date(?) ${where} GROUP BY label ORDER BY count DESC`).all(end, `-${days} days`, end);
  return rows.map((r) => ({ label: r.label, count: r.count, time: r.time }));
}

export function createJellyfin(lib) {
  const catalog = buildCatalog(lib);
  const plays = buildPlays(lib, catalog);
  const db = openPlays(plays);
  const admin = lib.users.find((u) => u.admin);

  return function jellyfin(method, path, query, body) {
    const q = params(query);
    if (method === 'POST' && path === '/user_usage_stats/submit_custom_query') {
      let sql = '';
      try { sql = JSON.parse(body || '{}').CustomQueryString ?? ''; } catch { /* answered as an empty query */ }
      return runQuery(db, String(sql));
    }
    if (method !== 'GET') return null;
    if (path === '/System/Info' || path === '/System/Info/Public') {
      return { ServerName: 'Demo Jellyfin', Version: '10.11.2', ProductName: 'Jellyfin Server', OperatingSystem: 'Linux', OperatingSystemDisplayName: 'Linux',
        Id: SERVER_ID, StartupWizardCompleted: true, HasPendingRestart: false, IsShuttingDown: false, SupportsLibraryMonitor: true, WebSocketPortNumber: 8096,
        CompletedInstallations: [], CanSelfRestart: true, CanLaunchWebBrowser: false, HasUpdateAvailable: false, SystemArchitecture: 'X64', LocalAddress: 'http://helprr-demo-upstreams:8096',
        ProgramDataPath: '/config', WebPath: '/jellyfin/jellyfin-web', ItemsByNamePath: '/config/metadata', CachePath: '/cache', LogPath: '/config/log',
        InternalMetadataPath: '/config/metadata', TranscodingTempPath: '/cache/transcodes', EncoderLocation: 'Custom', CastReceiverApplications: [] };
    }
    if (path === '/Users') return lib.users.map((u, i) => userJson(lib, u, i));
    if (path === '/Users/Me') return userJson(lib, admin, lib.users.indexOf(admin));
    const user = path.match(/^\/Users\/([0-9a-f-]{32,36})$/i);
    if (user) { const i = lib.users.findIndex((u) => u.id === user[1].replace(/-/g, '')); return i >= 0 ? userJson(lib, lib.users[i], i) : raw(404, {}); }
    if (path === '/Auth/Keys') return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
    if (path === '/UserViews') {
      return list(catalog.views.map((v) => ({ Name: v.Name, ServerId: SERVER_ID, Id: v.Id, CollectionType: v.CollectionType, Type: 'CollectionFolder', IsFolder: true,
        ChildCount: v.count, DateLastMediaAdded: v.lastAdded, ImageTags: { Primary: 'demo' }, BackdropImageTags: [], PrimaryImageAspectRatio: 16 / 9, LocationType: 'FileSystem' })), q);
    }
    if (path === '/Library/VirtualFolders') {
      return catalog.views.map((v) => ({ Name: v.Name, Locations: [v.path], CollectionType: v.CollectionType, ItemId: v.Id, PrimaryImageItemId: v.Id, RefreshStatus: 'Idle',
        LibraryOptions: { Enabled: true, EnableRealtimeMonitor: true, PathInfos: [{ Path: v.path }], TypeOptions: [] } }));
    }
    if (path === '/Items/Counts') {
      const count = (type) => catalog.items.filter((item) => item.Type === type).length;
      return { MovieCount: count('Movie'), SeriesCount: count('Series'), EpisodeCount: count('Episode'), ArtistCount: count('MusicArtist'), ProgramCount: 0, TrailerCount: 0,
        SongCount: count('Audio'), AlbumCount: count('MusicAlbum'), MusicVideoCount: 0, BoxSetCount: 0, BookCount: 0, ItemCount: catalog.items.length };
    }
    if (path === '/Items/Filters') {
      const items = filterItems(catalog, q);
      return { Genres: [...new Set(items.flatMap((item) => item.Genres ?? []))].sort(), Tags: [], OfficialRatings: [...new Set(items.map((item) => item.OfficialRating).filter(Boolean))].sort(),
        Years: [...new Set(items.map((item) => item.ProductionYear).filter(Boolean))].sort() };
    }
    if (path === '/Items') return list(filterItems(catalog, q), q);
    if (path === '/Items/Latest') {
      const parentId = q.get('ParentId');
      const types = q.get('IncludeItemTypes')?.split(',') ?? ['Movie', 'Episode', 'MusicAlbum'];
      const latest = sortItems(catalog.items.filter((item) => types.includes(item.Type) && (!parentId || item.view === parentId)), 'DateCreated', 'Descending');
      return latest.slice(0, Number(q.get('Limit') ?? 16)).map(clean);
    }
    if (path === '/UserItems/Resume') {
      const types = q.get('IncludeItemTypes')?.split(',');
      return list(catalog.items.filter((item) => item.UserData?.PlaybackPositionTicks > 0 && (!types || types.includes(item.Type))), q);
    }
    if (path === '/Shows/NextUp') return list(nextUp(catalog, q), q);
    if (path === '/Shows/Upcoming' || path === '/Movies/Recommendations' || path === '/LiveTv/Recordings' || path === '/LiveTv/Channels' || path === '/LiveTv/Programs') {
      return path === '/Movies/Recommendations' ? [] : list([], q);
    }
    const episodes = path.match(/^\/Shows\/([0-9a-f]{32})\/(Episodes|Seasons)$/i);
    if (episodes) {
      const type = episodes[2] === 'Episodes' ? 'Episode' : 'Season';
      const seasonId = q.get('SeasonId');
      return list(sortItems(catalog.items.filter((item) => item.Type === type && item.SeriesId === episodes[1] && (!seasonId || item.SeasonId === seasonId)),
        type === 'Episode' ? 'ParentIndexNumber,IndexNumber' : 'IndexNumber', 'Ascending'), q);
    }
    if (path === '/Search/Hints') {
      const term = (q.get('SearchTerm') ?? '').toLowerCase();
      const hints = catalog.items.filter((item) => term && ['Movie', 'Series', 'MusicAlbum', 'MusicArtist'].includes(item.Type) && item.Name.toLowerCase().includes(term))
        .slice(0, Number(q.get('Limit') ?? 20))
        .map((item) => ({ Id: item.Id, ItemId: item.Id, Name: item.Name, Type: item.Type, ProductionYear: item.ProductionYear, PrimaryImageTag: 'demo', SeriesName: item.SeriesName }));
      return { SearchHints: hints, TotalRecordCount: hints.length };
    }
    const entity = path.match(/^\/(Genres|Studios|Persons)$/);
    if (entity) {
      const scope = q.get('ParentId') ? catalog.items.filter((item) => item.view === q.get('ParentId')) : catalog.items;
      const names = entity[1] === 'Genres' ? scope.flatMap((item) => item.Genres ?? []) : entity[1] === 'Studios'
        ? scope.flatMap((item) => (item.Studios ?? []).map((s) => s.Name)) : scope.flatMap((item) => (item.People ?? []).map((p) => p.Name));
      const unique = [...new Set(names)].sort().map((name) => ({ Name: name, Id: id(entity[1], name), Type: entity[1].slice(0, -1), ServerId: SERVER_ID, ImageTags: {} }));
      return list(unique, q);
    }
    const item = path.match(/^\/Items\/([0-9a-f]{32})(\/[A-Za-z]+)?$/i);
    if (item) {
      const found = catalog.byId.get(item[1]) ?? catalog.views.find((v) => v.Id === item[1]);
      if (!found) return raw(404, {});
      if (!item[2]) return clean(found);
      if (item[2] === '/Similar') {
        return list(catalog.items.filter((other) => other.Type === found.Type && other.Id !== found.Id && other.Genres?.some((g) => found.Genres?.includes(g))).slice(0, Number(q.get('Limit') ?? 12)), q);
      }
      if (item[2] === '/LocalTrailers' || item[2] === '/SpecialFeatures') return [];
      if (item[2] === '/InstantMix') return list(catalog.items.filter((other) => other.Type === 'Audio').slice(0, 20), q);
      if (item[2] === '/ThemeMedia') {
        const empty = { OwnerId: found.Id, Items: [], TotalRecordCount: 0, StartIndex: 0 };
        return { ThemeVideosResult: empty, ThemeSongsResult: empty, SoundtrackSongsResult: empty };
      }
      return undefined;
    }
    if (/^\/MediaSegments\//.test(path)) return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
    if (path === '/Sessions') return sessions(lib, catalog);
    if (path === '/Devices') {
      return list(lib.devices.map((d) => { const u = lib.users.find((x) => x.id === d.userId); return { Name: d.name, Id: d.id, LastUserName: u.name, AppName: d.client,
        AppVersion: '10.11.2', LastUserId: u.id, DateLastActivity: d.lastSeen, Capabilities: { PlayableMediaTypes: [], SupportedCommands: [], SupportsMediaControl: false, SupportsPersistentIdentifier: true } }; }), q);
    }
    if (path === '/System/ActivityLog/Entries') return activityLog(lib, plays, q);
    if (path === '/ScheduledTasks') {
      return ['Scan Media Library', 'Clean Cache Directory', 'Refresh People', 'Extract Chapter Images'].map((name, i) => ({ Name: name, State: 'Idle', Id: hex(`task${i}`, 32),
        LastExecutionResult: { StartTimeUtc: iso(lib.now - (i + 1) * 6 * 3_600_000), EndTimeUtc: iso(lib.now - (i + 1) * 6 * 3_600_000 + 95_000), Status: 'Completed', Name: name, Key: `Task${i}`, Id: hex(`task${i}`, 32) },
        Triggers: [{ Type: 'IntervalTrigger', IntervalTicks: 12 * 3600 * TICKS }], Description: `Demo task: ${name.toLowerCase()}.`, Category: i ? 'Maintenance' : 'Library', IsHidden: false, Key: `Task${i}` }));
    }

    // Playback Reporting plugin.
    if (path === '/user_usage_stats/type_filter_list') return ['Movie', 'Episode'];
    if (path === '/user_usage_stats/user_list') return lib.users.map((u) => ({ name: u.name, id: u.id, in_list: true }));
    if (path === '/user_usage_stats/user_activity') {
      const days = Number(q.get('days') ?? 7);
      const since = lib.now - days * DAY;
      return lib.users.map((u) => {
        const mine = plays.filter((p) => p.UserId === u.id && Date.parse(`${p.DateCreated.replace(' ', 'T')}Z`) >= since);
        const last = mine.at(-1);
        const total = mine.reduce((s, p) => s + p.PlayDuration, 0);
        return { latest_date: last ? last.DateCreated : '', user_id: u.id, total_count: mine.length, total_time: total, item_name: last?.ItemName ?? '',
          client_name: last?.ClientName ?? '', user_name: u.name, has_image: false, last_seen: last ? `${Math.max(1, Math.round((lib.now - Date.parse(`${last.DateCreated.replace(' ', 'T')}Z`)) / 3_600_000))} hours ago` : 'never',
          total_play_time: `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m` };
      });
    }
    if (path === '/user_usage_stats/PlayActivity') {
      const days = Number(q.get('days') ?? 30);
      const end = Date.parse(q.get('endDate') ?? iso(lib.now).slice(0, 10));
      const duration = q.get('dataType') === 'time';
      return lib.users.map((u) => {
        const usage = {};
        for (let d = days - 1; d >= 0; d--) usage[iso(end - d * DAY).slice(0, 10)] = 0;
        for (const p of plays.filter((x) => x.UserId === u.id)) {
          const day = p.DateCreated.slice(0, 10);
          if (day in usage) usage[day] += duration ? p.PlayDuration : 1;
        }
        return { user_id: u.id, user_name: u.name, user_usage: usage };
      });
    }
    if (path === '/user_usage_stats/HourlyReport') {
      const days = Number(q.get('days') ?? 7);
      const end = q.get('endDate') ?? iso(lib.now).slice(0, 10);
      const rows = db.prepare(`SELECT ((CAST(strftime('%w', DateCreated) AS INTEGER) + 6) % 7) as d, strftime('%H', DateCreated) as h, SUM(PlayDuration) as t
        FROM PlaybackActivity WHERE date(DateCreated) > date(?, ?) AND date(DateCreated) <= date(?) GROUP BY d, h`).all(end, `-${days} days`, end);
      const out = {};
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) out[`${d}-${String(h).padStart(2, '0')}`] = 0;
      for (const r of rows) out[`${r.d}-${r.h}`] = r.t;
      return out;
    }
    const report = path.match(/^\/user_usage_stats\/(ClientName|DeviceName|PlaybackMethod|ItemType|UserId)\/BreakdownReport$/);
    if (report) {
      const rows = breakdown(db, report[1], q);
      if (report[1] !== 'UserId') return rows;
      return rows.map((r) => ({ ...r, label: lib.users.find((u) => u.id === r.label)?.name ?? r.label }));
    }
    if (path === '/user_usage_stats/GetTvShowsReport') return breakdown(db, "substr(ItemName, 1, instr(ItemName, ' - ') - 1)", q, "AND ItemType = 'Episode'");
    if (path === '/user_usage_stats/MoviesReport') return breakdown(db, 'ItemName', q, "AND ItemType = 'Movie'");
    const dayItems = path.match(/^\/user_usage_stats\/([0-9a-f]{32})\/(\d{4}-\d{2}-\d{2})\/GetItems$/i);
    if (dayItems) {
      return plays.filter((p) => p.UserId === dayItems[1] && p.DateCreated.startsWith(dayItems[2])).map((p) => ({ Time: p.DateCreated.slice(11, 16), Id: p.ItemId,
        Name: p.ItemName, Type: p.ItemType, Client: p.ClientName, Method: p.PlaybackMethod, Device: p.DeviceName, Duration: String(p.PlayDuration), RowId: String(p.rowid) }));
    }
    return undefined;
  };
}
