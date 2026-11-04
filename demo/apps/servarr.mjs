// Sonarr, Radarr and Lidarr, answered from the invented library (demo/library.mjs).
import { GIB, OVERVIEWS, iso, slug } from '../library.mjs';
import { raw } from './raw.mjs';

export const IMAGE_BASE = process.env.DEMO_IMAGE_BASE ?? 'http://helprr-demo-upstreams:9000';

export function image(kind, id, title, coverType = 'poster') {
  const url = `${IMAGE_BASE}/demo-image/${kind}-${id}-${coverType}.png?title=${encodeURIComponent(title)}`;
  return { coverType, url, remoteUrl: url };
}

function status(appName, version, now) {
  return {
    appName, instanceName: appName, version, buildTime: '2026-09-01T00:00:00Z', isDebug: false, isProduction: true, isAdmin: false,
    isUserInteractive: false, startupPath: `/app/${appName.toLowerCase()}/bin`, appData: '/config', osName: 'ubuntu', osVersion: '24.04',
    isNetCore: true, isLinux: true, isOsx: false, isWindows: false, isDocker: true, mode: 'console', branch: 'main', authentication: 'forms',
    migrationVersion: 200, urlBase: '', runtimeVersion: '8.0.0', runtimeName: '.NET', startTime: iso(now - 3 * 86_400_000),
    packageUpdateMechanism: 'docker', databaseType: 'sqLite', databaseVersion: '3.45.1',
  };
}

const QUALITY = { id: 3, name: 'WEBDL-1080p', source: 'web', resolution: 1080, modifier: 'none' };
const QUALITY_4K = { id: 18, name: 'WEBDL-2160p', source: 'web', resolution: 2160, modifier: 'none' };
const quality = (q = QUALITY) => ({ quality: q, revision: { version: 1, real: 0, isRepack: false } });

function profiles(withLanguage) {
  return [
    { id: 1, name: 'HD-1080p', upgradeAllowed: true, cutoff: 3, items: [{ quality: QUALITY, items: [], allowed: true }], minFormatScore: 0, cutoffFormatScore: 0, minUpgradeFormatScore: 1, formatItems: [], ...(withLanguage ? { language: { id: 1, name: 'English' } } : {}) },
    { id: 2, name: 'Ultra-HD', upgradeAllowed: true, cutoff: 18, items: [{ quality: QUALITY_4K, items: [], allowed: true }], minFormatScore: 0, cutoffFormatScore: 0, minUpgradeFormatScore: 1, formatItems: [], ...(withLanguage ? { language: { id: 1, name: 'English' } } : {}) },
  ];
}

const disks = () => [
  { path: '/media', label: 'media', freeSpace: Math.round(3.4 * 1024 * GIB), totalSpace: 8 * 1024 * GIB },
  { path: '/config', label: 'config', freeSpace: 180 * GIB, totalSpace: 240 * GIB },
];
const tags = () => [{ id: 1, label: 'family' }];

export function page(records, query, sortKey = 'date') {
  const pageNumber = Number(query.get('page') ?? 1);
  const pageSize = Number(query.get('pageSize') ?? 50);
  return { page: pageNumber, pageSize, sortKey: query.get('sortKey') ?? sortKey, sortDirection: query.get('sortDirection') ?? 'descending',
    totalRecords: records.length, records: records.slice((pageNumber - 1) * pageSize, pageNumber * pageSize) };
}

function inRange(dateIso, query) {
  const time = Date.parse(dateIso);
  const start = query.get('start') ? Date.parse(query.get('start')) : -Infinity;
  // A bare date means the whole of that day; a full time is the end itself.
  const endText = query.get('end');
  const end = !endText ? Infinity : Date.parse(endText) + (/^\d{4}-\d{2}-\d{2}$/.test(endText) ? 86_400_000 : 0);
  return time >= start && time < end;
}

// ---- Sonarr --------------------------------------------------------------------------
function seriesJson(lib, show) {
  return {
    title: show.title, alternateTitles: [], sortTitle: show.sortTitle, status: show.status, ended: show.ended, overview: show.overview,
    ...(show.nextAiring ? { nextAiring: show.nextAiring } : {}), previousAiring: show.previousAiring, network: show.network, airTime: show.airTime,
    images: [image('series', show.id, show.title), image('series', show.id, show.title, 'fanart'), image('series', show.id, show.title, 'banner')],
    originalLanguage: { id: 1, name: 'English' }, seasons: show.seasons, year: show.year, path: show.path, qualityProfileId: 1, seasonFolder: true,
    monitored: true, monitorNewItems: 'all', useSceneNumbering: false, runtime: show.runtime, tvdbId: show.tvdbId, tvRageId: 0, tvMazeId: 0,
    tmdbId: show.tmdbId, firstAired: show.firstAired, lastAired: show.lastAired, seriesType: show.seriesType, cleanTitle: slug(show.title).replace(/-/g, ''),
    imdbId: show.imdbId, titleSlug: slug(show.title), rootFolderPath: show.rootFolderPath, certification: show.certification, genres: show.genres,
    tags: show.tags, added: show.added, ratings: show.ratings, statistics: show.statistics, languageProfileId: 1, id: show.id,
  };
}

function episodeJson(lib, ep, withSeries = false) {
  const show = lib.series.find((s) => s.id === ep.seriesId);
  return {
    seriesId: ep.seriesId, tvdbId: 95_000_000 + ep.id, episodeFileId: ep.hasFile ? ep.id : 0, seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber,
    title: ep.title, airDate: ep.airDate, airDateUtc: ep.airDateUtc, runtime: ep.runtime, hasFile: ep.hasFile, monitored: true,
    absoluteEpisodeNumber: show.seriesType === 'anime' ? ep.absoluteEpisodeNumber : undefined, unverifiedSceneNumbering: false, id: ep.id,
    ...(withSeries ? { series: seriesJson(lib, show) } : {}),
  };
}

function sonarrHistory(lib) {
  return lib.history.filter((h) => h.kind === 'episode').map((h) => ({
    episodeId: h.item.id, seriesId: h.show.id, sourceTitle: h.release, languages: [{ id: 1, name: 'English' }], quality: quality(), customFormats: [],
    customFormatScore: 0, qualityCutoffNotMet: false, date: h.date, downloadId: h.downloadId, eventType: h.eventType,
    data: { downloadClient: 'qBittorrent', downloadClientName: 'qBittorrent', releaseGroup: 'DEMO', size: String(h.item.size), indexer: 'Demo Indexer 1' },
    episode: episodeJson(lib, h.item), series: seriesJson(lib, h.show), id: h.id,
  }));
}

function sonarrQueue(lib) {
  return lib.torrents.filter((t) => t.episode).map((t, i) => ({
    seriesId: t.show.id, episodeId: t.episode.id, seasonNumber: t.episode.seasonNumber, languages: [{ id: 1, name: 'English' }], quality: quality(),
    customFormats: [], customFormatScore: 0, size: t.size, title: t.name, sizeleft: Math.round(t.size * (1 - t.progress)), timeleft: '00:15:00',
    estimatedCompletionTime: iso(lib.now + t.eta * 1000), added: iso(t.added_on * 1000), status: 'downloading', trackedDownloadStatus: 'ok',
    trackedDownloadState: 'downloading', statusMessages: [], downloadId: t.hash.toUpperCase(), protocol: 'torrent', downloadClient: 'qBittorrent',
    downloadClientHasPostImportCategory: false, indexer: 'Demo Indexer 1', episodeHasFile: false, id: 7000 + i,
    series: seriesJson(lib, t.show), episode: episodeJson(lib, t.episode),
  }));
}

export function sonarr(lib, method, path, query) {
  if (method !== 'GET') return null;
  const showFor = (id) => lib.series.find((s) => s.id === Number(id));
  if (path === '/api/v3/system/status') return status('Sonarr', '4.0.20.3014', lib.now);
  if (path === '/api/v3/series') return lib.series.map((s) => seriesJson(lib, s));
  const series = path.match(/^\/api\/v3\/series\/(\d+)$/);
  if (series) return showFor(series[1]) ? seriesJson(lib, showFor(series[1])) : raw(404, { message: 'NotFound' });
  if (path === '/api/v3/episode') {
    const id = query.get('seriesId');
    return lib.episodes.filter((ep) => !id || ep.seriesId === Number(id)).filter((ep) => !query.get('seasonNumber') || ep.seasonNumber === Number(query.get('seasonNumber'))).map((ep) => episodeJson(lib, ep));
  }
  const episode = path.match(/^\/api\/v3\/episode\/(\d+)$/);
  if (episode) { const ep = lib.episodes.find((e) => e.id === Number(episode[1])); return ep ? episodeJson(lib, ep, true) : raw(404, {}); }
  if (path === '/api/v3/episodefile') {
    const id = Number(query.get('seriesId'));
    return lib.episodes.filter((ep) => ep.seriesId === id && ep.hasFile).map((ep) => ({ id: ep.id, seriesId: id, seasonNumber: ep.seasonNumber, size: ep.size,
      relativePath: `Season ${ep.seasonNumber}/Episode ${ep.episodeNumber}.mkv`, path: `${showFor(id).path}/Season ${ep.seasonNumber}/Episode ${ep.episodeNumber}.mkv`,
      dateAdded: ep.airDateUtc, releaseGroup: 'DEMO', languages: [{ id: 1, name: 'English' }], quality: quality(), customFormats: [], qualityCutoffNotMet: false,
      mediaInfo: { audioChannels: 5.1, audioCodec: 'EAC3', videoCodec: 'h264', resolution: '1920x1080', runTime: `${ep.runtime}:00`, subtitles: 'English', audioLanguages: 'English', videoDynamicRangeType: '' } }));
  }
  if (path === '/api/v3/calendar') return lib.episodes.filter((ep) => inRange(ep.airDateUtc, query)).map((ep) => episodeJson(lib, ep, query.get('includeSeries') !== 'false'));
  if (path === '/api/v3/history') return page(sonarrHistory(lib), query);
  if (path === '/api/v3/history/since') return sonarrHistory(lib).filter((h) => !query.get('date') || Date.parse(h.date) >= Date.parse(query.get('date')));
  if (path === '/api/v3/queue') return page(sonarrQueue(lib), query, 'timeleft');
  if (path === '/api/v3/queue/details') return sonarrQueue(lib);
  if (path === '/api/v3/wanted/missing') return page(lib.episodes.filter((ep) => !ep.hasFile && Date.parse(ep.airDateUtc) < lib.now).map((ep) => episodeJson(lib, ep, true)), query, 'airDateUtc');
  if (path === '/api/v3/wanted/cutoff') return page([], query, 'airDateUtc');
  if (path === '/api/v3/rootfolder') return [{ path: '/media/tv', accessible: true, freeSpace: Math.round(3.4 * 1024 * GIB), unmappedFolders: [], id: 1 }];
  if (path === '/api/v3/qualityprofile') return profiles(false);
  if (path === '/api/v3/languageprofile') return [{ id: 1, name: 'English' }];
  if (path === '/api/v3/tag') return tags();
  if (path === '/api/v3/diskspace') return disks();
  if (path === '/api/v3/health') return [];
  return undefined;
}

// ---- Radarr --------------------------------------------------------------------------
function movieJson(lib, movie) {
  const file = movie.hasFile ? {
    movieId: movie.id, relativePath: `${movie.title} (${movie.year}).mkv`, path: `${movie.path}/${movie.title} (${movie.year}).mkv`, size: movie.size,
    dateAdded: movie.added, releaseGroup: 'DEMO', edition: '', languages: [{ id: 1, name: 'English' }], quality: quality(movie.size > 10 * GIB ? QUALITY_4K : QUALITY),
    indexerFlags: 0, mediaInfo: { audioBitrate: 640000, audioChannels: 5.1, audioCodec: 'EAC3', audioLanguages: 'English', audioStreamCount: 1, videoBitDepth: 10,
      videoBitrate: 0, videoCodec: 'x265', videoFps: 23.976, videoDynamicRange: '', videoDynamicRangeType: '', resolution: movie.size > 10 * GIB ? '3840x2160' : '1920x1080',
      runTime: `${Math.floor(movie.runtime / 60)}:${String(movie.runtime % 60).padStart(2, '0')}:00`, scanType: 'Progressive', subtitles: 'English' },
    qualityCutoffNotMet: false, id: movie.id,
  } : undefined;
  return {
    title: movie.title, originalTitle: movie.originalTitle, originalLanguage: { id: 1, name: 'English' }, alternateTitles: [], secondaryYearSourceId: 0,
    sortTitle: movie.sortTitle, sizeOnDisk: movie.size, status: movie.status, overview: movie.overview, inCinemas: movie.inCinemas, physicalRelease: movie.physicalRelease,
    digitalRelease: movie.digitalRelease, releaseDate: movie.releaseDate, images: [image('movie', movie.id, movie.title), image('movie', movie.id, movie.title, 'fanart')],
    website: '', year: movie.year, youTubeTrailerId: '', studio: movie.studio, path: movie.path, qualityProfileId: 1, hasFile: movie.hasFile,
    movieFileId: movie.hasFile ? movie.id : 0, monitored: true, minimumAvailability: 'released', isAvailable: movie.isAvailable, folderName: movie.path,
    runtime: movie.runtime, cleanTitle: slug(movie.title).replace(/-/g, ''), imdbId: movie.imdbId, tmdbId: movie.tmdbId, titleSlug: String(movie.tmdbId),
    rootFolderPath: movie.rootFolderPath, certification: movie.certification, genres: movie.genres, keywords: [], tags: movie.tags, added: movie.added,
    ratings: movie.ratings, popularity: movie.popularity, ...(file ? { movieFile: file } : {}),
    ...(movie.collectionId ? { collection: { title: lib.collections.find((c) => c.id === movie.collectionId).title, tmdbId: 92000000 + movie.collectionId } } : {}),
    statistics: { movieFileCount: movie.hasFile ? 1 : 0, sizeOnDisk: movie.size, releaseGroups: movie.hasFile ? ['DEMO'] : [], movieFileQualities: movie.hasFile ? [QUALITY] : [] },
    id: movie.id,
  };
}

function radarrHistory(lib) {
  return lib.history.filter((h) => h.kind === 'movie').map((h) => ({
    movieId: h.item.id, sourceTitle: h.release, languages: [{ id: 1, name: 'English' }], quality: quality(QUALITY_4K), customFormats: [], customFormatScore: 0,
    qualityCutoffNotMet: false, date: h.date, downloadId: h.downloadId, eventType: h.eventType,
    data: { downloadClient: 'qBittorrent', downloadClientName: 'qBittorrent', releaseGroup: 'DEMO', size: String(h.item.size), indexer: 'Demo Indexer 2' },
    movie: movieJson(lib, h.item), id: h.id,
  }));
}

export function radarr(lib, method, path, query) {
  if (method !== 'GET') return null;
  if (path === '/api/v3/system/status') return status('Radarr', '6.4.4.10685', lib.now);
  if (path === '/api/v3/movie') return lib.movies.map((m) => movieJson(lib, m));
  const movie = path.match(/^\/api\/v3\/movie\/(\d+)$/);
  if (movie) { const m = lib.movies.find((x) => x.id === Number(movie[1])); return m ? movieJson(lib, m) : raw(404, { message: 'NotFound' }); }
  if (path === '/api/v3/moviefile') return lib.movies.filter((m) => m.hasFile && (!query.get('movieId') || m.id === Number(query.get('movieId')))).map((m) => movieJson(lib, m).movieFile);
  if (path === '/api/v3/credit') {
    const id = Number(query.get('movieId'));
    return lib.cast(id).map((c) => ({ personName: c.name, creditTmdbId: `demo-${c.id}`, personTmdbId: c.tmdbId, movieMetadataId: id, images: [image('person', c.id, c.name, 'headshot')],
      character: c.character, order: c.order, type: 'cast', id: c.id }));
  }
  if (path === '/api/v3/collection') {
    return lib.collections.map((c) => ({ title: c.title, sortTitle: c.title.toLowerCase(), tmdbId: c.tmdbId, images: [image('collection', c.id, c.title)], overview: OVERVIEWS[c.id],
      monitored: false, rootFolderPath: '/media/movies', qualityProfileId: 1, searchOnAdd: false, minimumAvailability: 'released',
      movies: c.movieIds.map((id) => { const m = movieJson(lib, lib.movies.find((x) => x.id === id)); return { ...m, isExisting: true, isExcluded: false }; }),
      missingMovies: 0, tags: [], id: c.id }));
  }
  if (path === '/api/v3/calendar') return lib.movies.filter((m) => [m.inCinemas, m.digitalRelease, m.physicalRelease].some((d) => inRange(d, query))).map((m) => movieJson(lib, m));
  if (path === '/api/v3/history') return page(radarrHistory(lib), query);
  if (path === '/api/v3/history/since') return radarrHistory(lib);
  if (path === '/api/v3/queue' || path === '/api/v3/queue/details') return path.endsWith('details') ? [] : page([], query, 'timeleft');
  if (path === '/api/v3/wanted/missing') return page(lib.movies.filter((m) => !m.hasFile).map((m) => movieJson(lib, m)), query, 'releaseDate');
  if (path === '/api/v3/wanted/cutoff') return page([], query, 'releaseDate');
  if (path === '/api/v3/rootfolder') return [{ path: '/media/movies', accessible: true, freeSpace: Math.round(3.4 * 1024 * GIB), unmappedFolders: [], id: 1 }];
  if (path === '/api/v3/qualityprofile') return profiles(true);
  if (path === '/api/v3/tag') return tags();
  if (path === '/api/v3/diskspace') return disks();
  if (path === '/api/v3/health') return [];
  return undefined;
}

// ---- Lidarr --------------------------------------------------------------------------
function artistJson(lib, artist) {
  const mine = lib.albums.filter((a) => a.artistId === artist.id);
  const tracks = mine.reduce((sum, a) => sum + a.trackCount, 0);
  const files = mine.reduce((sum, a) => sum + a.trackFileCount, 0);
  return {
    artistMetadataId: artist.id, status: 'continuing', ended: false, artistName: artist.name, foreignArtistId: artist.foreignArtistId, tadbId: 0, discogsId: 0,
    overview: artist.overview, artistType: 'Group', disambiguation: '', links: [], images: [image('artist', artist.id, artist.name)], path: artist.path,
    qualityProfileId: 1, metadataProfileId: 1, monitored: true, monitorNewItems: 'all', genres: artist.genres, cleanName: slug(artist.name).replace(/-/g, ''),
    sortName: artist.name.toLowerCase(), tags: [], added: artist.added, ratings: { votes: 0, value: 0 },
    statistics: { albumCount: mine.length, trackFileCount: files, trackCount: tracks, totalTrackCount: tracks, sizeOnDisk: mine.reduce((s, a) => s + a.sizeOnDisk, 0), percentOfTracks: tracks ? Math.round((files / tracks) * 100) : 0 },
    id: artist.id,
  };
}

function albumJson(lib, album, withArtist = true) {
  const artist = lib.artists.find((a) => a.id === album.artistId);
  return {
    title: album.title, disambiguation: '', overview: OVERVIEWS[album.id % OVERVIEWS.length], artistId: album.artistId, foreignAlbumId: album.foreignAlbumId,
    monitored: true, anyReleaseOk: true, profileId: 1, duration: album.duration, albumType: album.albumType, secondaryTypes: [], mediumCount: 1,
    ratings: { votes: 0, value: 0 }, releaseDate: album.releaseDate, releases: [{ id: album.id, albumId: album.id, foreignReleaseId: `demo-release-${album.id}`,
      title: album.title, status: 'Official', duration: album.duration, trackCount: album.trackCount, media: [{ mediumNumber: 1, mediumName: '', mediumFormat: 'Digital Media' }],
      mediumCount: 1, disambiguation: '', country: [], label: [], format: 'Digital Media', monitored: true }],
    genres: album.genres, media: [{ mediumNumber: 1, mediumName: '', mediumFormat: 'Digital Media' }], images: [image('album', album.id, album.title, 'cover')],
    links: [], statistics: { trackFileCount: album.trackFileCount, trackCount: album.trackCount, totalTrackCount: album.trackCount, sizeOnDisk: album.sizeOnDisk,
      percentOfTracks: album.trackCount ? Math.round((album.trackFileCount / album.trackCount) * 100) : 0 },
    grabbed: false, ...(withArtist ? { artist: artistJson(lib, artist) } : {}), id: album.id,
  };
}

export function lidarr(lib, method, path, query) {
  if (method !== 'GET') return null;
  if (path === '/api/v1/system/status') return status('Lidarr', '3.1.6.5078', lib.now);
  if (path === '/api/v1/artist') return lib.artists.map((a) => artistJson(lib, a));
  const artist = path.match(/^\/api\/v1\/artist\/(\d+)$/);
  if (artist) { const a = lib.artists.find((x) => x.id === Number(artist[1])); return a ? artistJson(lib, a) : raw(404, {}); }
  if (path === '/api/v1/album') return lib.albums.filter((a) => !query.get('artistId') || a.artistId === Number(query.get('artistId'))).map((a) => albumJson(lib, a));
  const album = path.match(/^\/api\/v1\/album\/(\d+)$/);
  if (album) { const a = lib.albums.find((x) => x.id === Number(album[1])); return a ? albumJson(lib, a) : raw(404, {}); }
  if (path === '/api/v1/track') {
    const album = lib.albums.find((a) => a.id === Number(query.get('albumId')));
    return album ? Array.from({ length: album.trackCount }, (_, i) => ({ id: album.id * 100 + i + 1, artistId: album.artistId, albumId: album.id, trackNumber: String(i + 1),
      absoluteTrackNumber: i + 1, title: `Track ${i + 1}`, duration: Math.round(album.duration / album.trackCount), hasFile: album.trackFileCount > 0, mediumNumber: 1, explicit: false, ratings: { votes: 0, value: 0 } })) : [];
  }
  if (path === '/api/v1/calendar') return lib.albums.filter((a) => inRange(a.releaseDate, query)).map((a) => albumJson(lib, a));
  if (path === '/api/v1/history') return page([], query);
  if (path === '/api/v1/queue') return page([], query, 'timeleft');
  if (path === '/api/v1/wanted/missing') return page(lib.albums.filter((a) => !a.trackFileCount).map((a) => albumJson(lib, a)), query, 'releaseDate');
  if (path === '/api/v1/wanted/cutoff') return page([], query, 'releaseDate');
  if (path === '/api/v1/rootfolder') return [{ path: '/media/music', accessible: true, freeSpace: Math.round(3.4 * 1024 * GIB), id: 1 }];
  if (path === '/api/v1/qualityprofile') return [{ id: 1, name: 'Lossless', upgradeAllowed: false, cutoff: 6, items: [], formatItems: [] }];
  if (path === '/api/v1/metadataprofile') return [{ id: 1, name: 'Standard', primaryAlbumTypes: [], secondaryAlbumTypes: [], releaseStatuses: [] }];
  if (path === '/api/v1/tag') return tags();
  if (path === '/api/v1/diskspace') return disks();
  if (path === '/api/v1/health') return [];
  return undefined;
}
