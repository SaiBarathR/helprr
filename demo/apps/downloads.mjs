// qBittorrent, Prowlarr and Seerr, answered from the invented library (demo/library.mjs).
import { iso } from '../library.mjs';
import { raw } from './raw.mjs';

// ---- qBittorrent -------------------------------------------------------------------
function torrentJson(lib, t) {
  const done = Math.round(t.size * t.progress);
  const savePath = t.category === 'tv' ? '/downloads/tv' : '/downloads/movies';
  return {
    added_on: t.added_on, amount_left: t.size - done, auto_tmm: true, availability: t.progress < 1 ? 3.2 : -1, category: t.category, comment: '',
    completed: done, completion_on: t.progress < 1 ? -1 : t.added_on + 1800, content_path: `${savePath}/${t.name}`, dl_limit: 0, dlspeed: t.dlspeed,
    download_path: '', downloaded: done, downloaded_session: done, eta: t.eta, f_l_piece_prio: false, force_start: false, has_metadata: true, hash: t.hash,
    inactive_seeding_time_limit: -2, infohash_v1: t.hash, infohash_v2: '', last_activity: Math.floor(lib.now / 1000) - 5, magnet_uri: '', max_inactive_seeding_time: -1,
    max_ratio: -1, max_seeding_time: -1, name: t.name, num_complete: 24, num_incomplete: 3, num_leechs: t.progress < 1 ? 0 : 2, num_seeds: t.progress < 1 ? 11 : 0,
    popularity: 0, priority: t.progress < 1 ? 1 : 0, private: false, progress: t.progress, ratio: t.progress < 1 ? 0.01 : 0.84, ratio_limit: -2, reannounce: 1200,
    root_path: `${savePath}/${t.name}`, save_path: savePath, seeding_time: t.progress < 1 ? 0 : Math.floor(lib.now / 1000) - t.added_on - 1800, seeding_time_limit: -2,
    seen_complete: t.added_on, seq_dl: false, size: t.size, state: t.state, super_seeding: false, tags: '', time_active: Math.floor(lib.now / 1000) - t.added_on,
    total_size: t.size, tracker: 'udp://tracker.example.invalid:1337/announce', trackers_count: 1, up_limit: 0, uploaded: Math.round(t.size * 0.84),
    uploaded_session: Math.round(t.size * 0.2), upspeed: t.upspeed,
  };
}

export function qbittorrent(lib, method, path, query) {
  if (method !== 'GET') return null;
  if (path === '/api/v2/app/version') return raw(200, 'v5.1.2', 'text/plain');
  if (path === '/api/v2/app/webapiVersion') return raw(200, '2.11.4', 'text/plain');
  if (path === '/api/v2/torrents/info') {
    const filter = query.get('filter');
    const hashes = query.get('hashes')?.split('|');
    return lib.torrents.filter((t) => !hashes || hashes.includes(t.hash))
      .filter((t) => !filter || filter === 'all' || (filter === 'downloading' ? t.progress < 1 : filter === 'completed' || filter === 'seeding' ? t.progress === 1 : true))
      .filter((t) => !query.get('category') || t.category === query.get('category'))
      .map((t) => torrentJson(lib, t));
  }
  if (path === '/api/v2/transfer/info') {
    return { connection_status: 'connected', dht_nodes: 312, dl_info_data: 48 * 1024 ** 3, dl_info_speed: lib.torrents.reduce((s, t) => s + t.dlspeed, 0), dl_rate_limit: 0,
      last_external_address_v4: '', last_external_address_v6: '', up_info_data: 61 * 1024 ** 3, up_info_speed: lib.torrents.reduce((s, t) => s + t.upspeed, 0), up_rate_limit: 0 };
  }
  if (path === '/api/v2/transfer/speedLimitsMode') return raw(200, '0', 'text/plain');
  if (path === '/api/v2/transfer/downloadLimit' || path === '/api/v2/transfer/uploadLimit') return raw(200, '0', 'text/plain');
  if (path === '/api/v2/torrents/categories') return { tv: { name: 'tv', savePath: '/downloads/tv' }, movies: { name: 'movies', savePath: '/downloads/movies' } };
  if (path === '/api/v2/torrents/tags') return [];
  if (path === '/api/v2/torrents/properties') {
    const t = lib.torrents.find((x) => x.hash === query.get('hash'));
    return t ? { save_path: torrentJson(lib, t).save_path, creation_date: t.added_on, piece_size: 4194304, comment: '', total_wasted: 0, total_uploaded: 0, total_downloaded: 0,
      up_limit: -1, dl_limit: -1, time_elapsed: 600, seeding_time: 0, nb_connections: 12, share_ratio: 0, addition_date: t.added_on, completion_date: -1, created_by: '',
      dl_speed: t.dlspeed, up_speed: t.upspeed, eta: t.eta, total_size: t.size, pieces_have: 0, pieces_num: 400 } : raw(404, 'Not Found', 'text/plain');
  }
  if (path === '/api/v2/torrents/files') {
    const t = lib.torrents.find((x) => x.hash === query.get('hash'));
    return t ? [{ index: 0, name: `${t.name}.mkv`, size: t.size, progress: t.progress, priority: 1, is_seed: t.progress === 1, availability: 1 }] : [];
  }
  if (path === '/api/v2/torrents/trackers') return [{ url: 'udp://tracker.example.invalid:1337/announce', status: 2, tier: 0, num_peers: 14, num_seeds: 11, num_leeches: 3, num_downloaded: 40, msg: '' }];
  return undefined;
}

// ---- Prowlarr ----------------------------------------------------------------------
const INDEXERS = ['Demo Indexer 1', 'Demo Indexer 2', 'Demo Indexer 3'];

export function prowlarr(lib, method, path) {
  if (method !== 'GET') return null;
  if (path === '/api/v1/system/status') {
    return { appName: 'Prowlarr', instanceName: 'Prowlarr', version: '2.0.5.5160', buildTime: '2026-09-01T00:00:00Z', isDebug: false, isProduction: true, isAdmin: false,
      isUserInteractive: false, startupPath: '/app/prowlarr/bin', appData: '/config', osName: 'ubuntu', osVersion: '24.04', isNetCore: true, isLinux: true, isOsx: false,
      isWindows: false, isDocker: true, isContainerized: true, mode: 'console', branch: 'master', databaseType: 'sqLite', databaseVersion: '3.45.1', authentication: 'forms',
      migrationVersion: 40, urlBase: '', runtimeVersion: '8.0.0', runtimeName: '.NET', startTime: iso(lib.now - 3 * 86_400_000), packageUpdateMechanism: 'docker' };
  }
  if (path === '/api/v1/indexer') {
    return INDEXERS.map((name, i) => ({ indexerUrls: [], legacyUrls: [], definitionName: 'demo', description: 'An invented indexer for the demo.', language: 'en-US',
      encoding: 'Unicode (UTF-8)', enable: true, redirect: false, supportsRss: true, supportsSearch: true, supportsRedirect: false, supportsPagination: false, appProfileId: 1,
      protocol: 'torrent', privacy: i === 2 ? 'private' : 'public', capabilities: { limitsMax: 100, limitsDefault: 100, categories: [], supportsRawSearch: false,
        searchParams: ['q'], tvSearchParams: ['q', 'season', 'ep'], movieSearchParams: ['q'], musicSearchParams: ['q'], bookSearchParams: ['q'] },
      priority: 25, downloadClientId: 0, added: iso(lib.today - (200 + i * 40) * 86_400_000), sortName: name.toLowerCase(), name, fields: [],
      implementationName: 'Cardigann', implementation: 'Cardigann', configContract: 'CardigannSettings', infoLink: '', tags: [], id: i + 1 }));
  }
  if (path === '/api/v1/indexerstatus' || path === '/api/v1/tag') return [];
  if (path === '/api/v1/history') return { page: 1, pageSize: 50, sortKey: 'date', sortDirection: 'descending', totalRecords: 0, records: [] };
  if (path === '/api/v1/indexerstats') {
    return { indexers: INDEXERS.map((name, i) => ({ indexerId: i + 1, indexerName: name, averageResponseTime: 300 + i * 150, averageGrabResponseTime: 200, numberOfQueries: 400 - i * 90,
      numberOfGrabs: 30 - i * 8, numberOfRssQueries: 300, numberOfAuthQueries: 0, numberOfFailedQueries: i, numberOfFailedGrabs: 0, numberOfFailedRssQueries: 0, numberOfFailedAuthQueries: 0 })),
      userAgents: [], hosts: [] };
  }
  if (path === '/api/v1/applications') {
    return ['Sonarr', 'Radarr', 'Lidarr'].map((name, i) => ({ syncLevel: 'fullSync', enable: true, name, fields: [], implementationName: name, implementation: name,
      configContract: `${name}Settings`, infoLink: '', tags: [], id: i + 1 }));
  }
  if (path === '/api/v1/health') return [];
  return undefined;
}

// ---- Seerr -------------------------------------------------------------------------
function seerrUser(lib, all, user, i) {
  return { permissions: i === 0 ? 2 : 32, warnings: [], id: i + 1, email: user.email, plexUsername: null, jellyfinUsername: user.name, username: null,
    recoveryLinkExpirationDate: null, userType: 3, plexId: null, jellyfinUserId: user.id, avatar: '/avatarproxy/demo', avatarETag: null, avatarVersion: null,
    movieQuotaLimit: null, movieQuotaDays: null, tvQuotaLimit: null, tvQuotaDays: null, createdAt: iso(lib.today - (300 - i * 40) * 86_400_000),
    updatedAt: iso(lib.today - i * 86_400_000), requestCount: all.filter((r) => r.userIndex === i).length, displayName: user.name };
}

// Status 1 pending, 2 approved; media status 5 available, 3 processing, 2 pending.
function requests(lib) {
  const upcoming = lib.movies.filter((m) => !m.isAvailable);
  const owned = lib.movies.filter((m) => m.hasFile).slice(3, 5);
  const shows = lib.series.slice(8, 10);
  return [
    ...upcoming.slice(0, 2).map((m, i) => ({ id: 1 + i, status: 1, type: 'movie', item: m, userIndex: 1 + i, mediaStatus: 2, at: lib.now - (4 + i * 9) * 3_600_000 })),
    ...upcoming.slice(2).map((m, i) => ({ id: 3 + i, status: 2, type: 'movie', item: m, userIndex: 2, mediaStatus: 3, at: lib.now - (2 + i) * 86_400_000 })),
    ...owned.map((m, i) => ({ id: 5 + i, status: 2, type: 'movie', item: m, userIndex: 3, mediaStatus: 5, at: lib.now - (6 + i * 4) * 86_400_000 })),
    ...shows.map((s, i) => ({ id: 7 + i, status: 2, type: 'tv', item: s, userIndex: 1, mediaStatus: 5, at: lib.now - (12 + i * 5) * 86_400_000 })),
  ];
}

function requestJson(r, users) {
  const at = iso(r.at);
  return {
    id: r.id, status: r.status, createdAt: at, updatedAt: at, type: r.type, is4k: false, serverId: 0, profileId: 1,
    rootFolder: r.type === 'movie' ? '/media/movies' : '/media/tv', languageProfileId: null, tags: [], isAutoRequest: false, ignoreQuota: false,
    media: { downloadStatus: [], downloadStatus4k: [], id: 100 + r.id, mediaType: r.type, tmdbId: r.item.tmdbId, tvdbId: r.type === 'tv' ? r.item.tvdbId : null,
      imdbId: r.item.imdbId, status: r.mediaStatus, status4k: 1, createdAt: at, updatedAt: at, lastSeasonChange: at, mediaAddedAt: r.mediaStatus === 5 ? at : null,
      serviceId: 0, serviceId4k: null, externalServiceId: r.item.id, externalServiceId4k: null, externalServiceSlug: String(r.item.tmdbId), externalServiceSlug4k: null,
      ratingKey: null, ratingKey4k: null, jellyfinMediaId: null, jellyfinMediaId4k: null },
    seasons: r.type === 'tv' ? r.item.seasons.map((s, i) => ({ id: r.id * 10 + i, seasonNumber: s.seasonNumber, status: 2, createdAt: at, updatedAt: at })) : [],
    modifiedBy: r.status === 2 ? users[0] : null, requestedBy: users[r.userIndex],
  };
}

const ARR_SERVER = { hostname: 'helprr-demo-upstreams', apiKey: 'demo-not-a-real-key', useSsl: false, activeProfileId: 1, activeProfileName: 'HD-1080p',
  is4k: false, isDefault: true, syncEnabled: false, preventSearch: false, tagRequests: false, tags: [], id: 0 };

export function seerr(lib, method, path, query) {
  if (method !== 'GET') return null;
  const all = requests(lib);
  const users = lib.users.map((u, i) => seerrUser(lib, all, u, i));
  if (path === '/api/v1/status') return { version: '2.7.3', commitTag: 'demo', updateAvailable: false, commitsBehind: 0, restartRequired: false };
  if (path === '/api/v1/auth/me') return users[0];
  if (path === '/api/v1/user') {
    const take = Number(query.get('take') ?? 10);
    const skip = Number(query.get('skip') ?? 0);
    return { pageInfo: { pages: Math.ceil(users.length / take), pageSize: take, results: users.length, page: Math.floor(skip / take) + 1 }, results: users.slice(skip, skip + take) };
  }
  const user = path.match(/^\/api\/v1\/user\/(\d+)(\/requests|\/quota)?$/);
  if (user) {
    const index = Number(user[1]) - 1;
    if (!users[index]) return raw(404, { message: 'User not found.' });
    if (user[2] === '/quota') return { movie: { days: 7, limit: 0, used: 0, remaining: 0, restricted: false }, tv: { days: 7, limit: 0, used: 0, remaining: 0, restricted: false } };
    if (user[2] === '/requests') {
      const mine = all.filter((r) => r.userIndex === index).map((r) => requestJson(r, users));
      return { pageInfo: { pages: 1, pageSize: 20, results: mine.length, page: 1 }, results: mine };
    }
    return users[index];
  }
  if (path === '/api/v1/request/count') {
    const count = (fn) => all.filter(fn).length;
    return { total: all.length, movie: count((r) => r.type === 'movie'), tv: count((r) => r.type === 'tv'), pending: count((r) => r.status === 1),
      approved: count((r) => r.status === 2), declined: 0, processing: count((r) => r.mediaStatus === 3), available: count((r) => r.mediaStatus === 5), completed: count((r) => r.mediaStatus === 5) };
  }
  if (path === '/api/v1/request') {
    const filter = query.get('filter') ?? 'all';
    const take = Number(query.get('take') ?? 20);
    const skip = Number(query.get('skip') ?? 0);
    const keep = { pending: (r) => r.status === 1, approved: (r) => r.status === 2, processing: (r) => r.mediaStatus === 3, available: (r) => r.mediaStatus === 5,
      unavailable: (r) => r.mediaStatus !== 5, completed: (r) => r.mediaStatus === 5, declined: () => false }[filter] ?? (() => true);
    const requestedBy = query.get('requestedBy');
    const list = all.filter(keep).filter((r) => !requestedBy || r.userIndex === Number(requestedBy) - 1)
      .filter((r) => !query.get('mediaType') || query.get('mediaType') === 'all' || r.type === query.get('mediaType'))
      .sort((a, b) => b.at - a.at).map((r) => requestJson(r, users));
    return { pageInfo: { pages: Math.max(1, Math.ceil(list.length / take)), pageSize: take, results: list.length, page: Math.floor(skip / take) + 1 }, results: list.slice(skip, skip + take) };
  }
  const request = path.match(/^\/api\/v1\/request\/(\d+)$/);
  if (request) { const r = all.find((x) => x.id === Number(request[1])); return r ? requestJson(r, users) : raw(404, { message: 'Request not found.' }); }
  // Titles for the request list. No poster: the demo does not call TMDB.
  const media = path.match(/^\/api\/v1\/(movie|tv)\/(\d+)$/);
  if (media) {
    const item = media[1] === 'movie' ? lib.movies.find((m) => m.tmdbId === Number(media[2])) : lib.series.find((s) => s.tmdbId === Number(media[2]));
    if (!item) return raw(404, { message: 'Not found.' });
    return media[1] === 'movie'
      ? { id: item.tmdbId, title: item.title, releaseDate: item.inCinemas.slice(0, 10), overview: item.overview, posterPath: null, backdropPath: null, genres: [], mediaInfo: null }
      : { id: item.tmdbId, name: item.title, firstAirDate: item.firstAired.slice(0, 10), overview: item.overview, posterPath: null, backdropPath: null, genres: [],
        seasons: item.seasons.map((s) => ({ id: item.id * 10 + s.seasonNumber, seasonNumber: s.seasonNumber, episodeCount: s.statistics.totalEpisodeCount, name: `Season ${s.seasonNumber}` })), mediaInfo: null };
  }
  if (path === '/api/v1/settings/sonarr') {
    return [{ ...ARR_SERVER, name: 'Sonarr', port: 8989, activeDirectory: '/media/tv', animeSeriesType: 'anime', activeAnimeProfileId: 1, activeAnimeProfileName: 'HD-1080p',
      activeAnimeDirectory: '/media/tv', animeTags: [], enableSeasonFolders: true, monitorNewItems: 'all' }];
  }
  if (path === '/api/v1/settings/radarr') return [{ ...ARR_SERVER, name: 'Radarr', port: 7878, activeDirectory: '/media/movies', minimumAvailability: 'released' }];
  return undefined;
}
