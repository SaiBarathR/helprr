// The demo's invented library: shows, films, music, downloads, people and devices, all made
// up here from a fixed seed. Nothing in it comes from a real library, so the demo has no
// recorded data at all. Dates are worked out from "now", so the calendar, the activity
// and "recently added" are always current.

const DAY = 86_400_000;
const HOUR = 3_600_000;

// A small seeded generator: the same library every time.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ['Silent', 'Crimson', 'Hollow', 'Golden', 'Midnight', 'Northern', 'Paper', 'Glass', 'Iron', 'Velvet', 'Distant', 'Electric',
  'Quiet', 'Wild', 'Lost', 'Bright', 'Second', 'Little', 'Broken', 'Hidden', 'Winter', 'Amber', 'Last', 'Open', 'Copper', 'Scarlet'];
const NOUN = ['Harbor', 'Orchard', 'Signal', 'Lantern', 'Meridian', 'Canyon', 'Archive', 'Garden', 'Compass', 'Station', 'River', 'Tower',
  'Voyage', 'Atlas', 'Hours', 'Island', 'Engine', 'Kingdom', 'Letters', 'Shore', 'Circuit', 'Frontier', 'Mirror', 'Lighthouse'];
const FIRST = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Jamie', 'Avery', 'Quinn', 'Rowan', 'Harper', 'Elliot', 'Noa'];
const LAST = ['Rivers', 'Hale', 'Moreau', 'Okafor', 'Lindqvist', 'Tanaka', 'Novak', 'Castillo', 'Brennan', 'Achebe', 'Varga', 'Sato'];
export const OVERVIEWS = [
  'A demo story with invented people and places.', 'Nothing here is real: this is Helprr\'s demo library.',
  'Two friends, one long summer, and a mystery nobody expected.', 'A quiet town keeps a loud secret.',
  'An expedition to the edge of the map.', 'A family business, a stolen recipe, a rival next door.',
  'A lighthouse keeper receives letters from a stranger.', 'A detective with one week to solve one last case.',
];
const NETWORKS = ['Demo One', 'Northwind TV', 'Harbor Pictures', 'Lantern Studios', 'Meridian Media'];
const SHOW_GENRES = [['Drama', 'Mystery'], ['Comedy'], ['Science Fiction', 'Adventure'], ['Animation', 'Comedy'], ['Documentary'], ['Crime', 'Thriller'], ['Fantasy', 'Drama']];
const MOVIE_GENRES = [['Adventure', 'Family'], ['Drama'], ['Comedy', 'Romance'], ['Thriller'], ['Science Fiction'], ['Animation'], ['Mystery', 'Crime'], ['Documentary']];
const MUSIC_GENRES = [['Indie'], ['Electronic'], ['Jazz'], ['Folk'], ['Rock'], ['Ambient']];
export const DEVICES = ['Living Room TV', 'Kitchen Tablet', 'Phone', 'Office PC', 'Travel Tablet'];
export const CLIENTS = ['Jellyfin Web', 'Jellyfin Android', 'Jellyfin iOS', 'Android TV', 'Kodi'];
export const GIB = 1024 ** 3;

export function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function buildLibrary(now = Date.now()) {
  const rand = mulberry32(20261105);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const titles = [];
  for (const noun of NOUN) for (const adj of ADJ) titles.push(`The ${adj} ${noun}`);
  // Shuffle once, then take titles in order: every title in the demo is different.
  for (let i = titles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [titles[i], titles[j]] = [titles[j], titles[i]];
  }
  let nextTitle = 0;
  const title = () => titles[nextTitle++];
  const today = Math.floor(now / DAY) * DAY;
  // Air dates are pinned to the week, not the day: an episode keeps its date all week, so
  // Helprr does not see last week's imports as new each midnight.
  const weekIndex = Math.floor(now / (7 * DAY));
  const week = weekIndex * 7 * DAY;

  // ---- shows ------------------------------------------------------------------------
  const series = [];
  const episodes = [];
  for (let id = 1; id <= 18; id++) {
    const name = title();
    const continuing = id <= 7;
    const seasonCount = between(1, 4);
    const perSeason = Array.from({ length: seasonCount }, () => between(6, 12));
    const weekly = 7 * DAY;
    const total = perSeason.reduce((a, b) => a + b, 0);
    // A continuing show is part-way through its run, one episode further each week, so
    // each week brings a new episode. After its last one it starts over (every 7 to 31
    // weeks for this seed), and Helprr announces those episodes again. The seven
    // continuing shows air on seven different weekdays, so one is always on today.
    const aired = continuing ? 1 + ((weekIndex + id * 3) % (total - 1)) : total;
    const firstAired = continuing ? week - aired * weekly + ((id - 1) % 7) * DAY : week - (300 + between(0, 2500)) * DAY;
    const airHour = between(17, 22);
    const show = {
      id, title: name, sortTitle: name.toLowerCase().replace(/^the /, ''), status: continuing ? 'continuing' : 'ended', ended: !continuing,
      overview: pick(OVERVIEWS), network: pick(NETWORKS), airTime: `${airHour}:${pick(['00', '30'])}`, year: new Date(firstAired).getUTCFullYear(),
      runtime: pick([25, 30, 45, 60]), genres: pick(SHOW_GENRES), certification: pick(['TV-PG', 'TV-14', 'TV-MA']),
      seriesType: id === 4 || id === 11 ? 'anime' : 'standard', tvdbId: 900000 + id, tmdbId: 90000000 + id, tvMazeId: 0, tvRageId: 0,
      imdbId: `tt99${String(id).padStart(6, '0')}`, firstAired: iso(firstAired), added: iso(firstAired + 30 * DAY),
      ratings: { votes: between(80, 9000), value: Math.round((6 + rand() * 3) * 10) / 10 }, seasonCount, qualityProfileId: 1,
      path: `/media/tv/${name}`, rootFolderPath: '/media/tv', tags: id % 5 === 0 ? [1] : [], monitored: true, seasons: [],
    };
    series.push(show);
    let number = 0;
    perSeason.forEach((count, s) => {
      for (let e = 1; e <= count; e++) {
        const airMs = firstAired + number * weekly + airHour * HOUR;
        number++;
        const hasAired = airMs < now;
        // Always drawn, so the library is the same whatever the time it is built.
        const missing = rand() <= 0.08;
        episodes.push({
          id: id * 1000 + number, seriesId: id, seasonNumber: s + 1, episodeNumber: e, absoluteEpisodeNumber: number,
          title: `Episode ${e}`, airDate: iso(airMs).slice(0, 10), airDateUtc: iso(airMs), runtime: show.runtime,
          hasFile: hasAired && !missing, monitored: true, size: Math.round((0.4 + rand() * 2.4) * GIB),
        });
      }
    });
    show.seasons = perSeason.map((count, s) => {
      const list = episodes.filter((ep) => ep.seriesId === id && ep.seasonNumber === s + 1);
      const files = list.filter((ep) => ep.hasFile);
      const airedCount = list.filter((ep) => Date.parse(ep.airDateUtc) < now).length;
      return {
        seasonNumber: s + 1, monitored: true,
        statistics: { episodeFileCount: files.length, episodeCount: airedCount, totalEpisodeCount: count,
          sizeOnDisk: files.reduce((sum, ep) => sum + ep.size, 0), releaseGroups: ['DEMO'], percentOfEpisodes: airedCount ? Math.round((files.length / airedCount) * 100) : 0 },
      };
    });
    const mine = episodes.filter((ep) => ep.seriesId === id);
    const airedEps = mine.filter((ep) => Date.parse(ep.airDateUtc) < now);
    show.lastAired = airedEps.length ? airedEps.at(-1).airDateUtc : show.firstAired;
    show.previousAiring = show.lastAired;
    const next = mine.find((ep) => Date.parse(ep.airDateUtc) >= now);
    if (next) show.nextAiring = next.airDateUtc;
    const files = mine.filter((ep) => ep.hasFile);
    show.statistics = { seasonCount, episodeFileCount: files.length, episodeCount: airedEps.length, totalEpisodeCount: mine.length,
      sizeOnDisk: files.reduce((sum, ep) => sum + ep.size, 0), releaseGroups: ['DEMO'], percentOfEpisodes: airedEps.length ? Math.round((files.length / airedEps.length) * 100) : 0 };
  }

  // ---- films ------------------------------------------------------------------------
  const movies = [];
  for (let id = 1; id <= 36; id++) {
    const name = title();
    // A few are still to come, so the calendar and "wanted" have films too. Their dates
    // hold for the week rather than moving on each day.
    const upcoming = id > 32;
    const release = upcoming ? week + between(10, 40) * DAY : today - between(60, 4000) * DAY;
    const hasFile = !upcoming && rand() > 0.12;
    movies.push({
      id, title: name, originalTitle: name, sortTitle: name.toLowerCase().replace(/^the /, ''), year: new Date(release).getUTCFullYear(),
      overview: pick(OVERVIEWS), studio: pick(NETWORKS), runtime: between(84, 158), genres: pick(MOVIE_GENRES),
      certification: pick(['PG', 'PG-13', 'R', '12A']), tmdbId: 91000000 + id, imdbId: `tt98${String(id).padStart(6, '0')}`,
      inCinemas: iso(release), digitalRelease: iso(release + 75 * DAY), physicalRelease: iso(release + 110 * DAY), releaseDate: iso(release + 75 * DAY),
      added: iso(upcoming ? today - between(2, 20) * DAY : Math.min(release + between(80, 400) * DAY, today - between(1, 30) * DAY)), hasFile, monitored: true,
      status: upcoming ? 'announced' : 'released', isAvailable: !upcoming, qualityProfileId: 1, popularity: Math.round(rand() * 200 * 10) / 10,
      ratings: { imdb: { votes: between(500, 90000), value: Math.round((5.5 + rand() * 3.5) * 10) / 10, type: 'user' },
        tmdb: { votes: between(100, 20000), value: Math.round((5.5 + rand() * 3.5) * 10) / 10, type: 'user' } },
      size: hasFile ? Math.round((2 + rand() * 18) * GIB) : 0, path: `/media/movies/${name} (${new Date(release).getUTCFullYear()})`,
      rootFolderPath: '/media/movies', collectionId: id <= 6 ? Math.ceil(id / 3) : null, tags: [],
    });
  }
  const collections = [1, 2].map((id) => ({ id, title: `The ${pick(NOUN)} Collection`, tmdbId: 92000000 + id, movieIds: movies.filter((m) => m.collectionId === id).map((m) => m.id) }));
  // Each film's cast has its own seed: the same names on every call, in Radarr and Jellyfin.
  const cast = (movieId) => {
    const castRand = mulberry32(movieId * 7919);
    const name = () => `${FIRST[Math.floor(castRand() * FIRST.length)]} ${LAST[Math.floor(castRand() * LAST.length)]}`;
    return Array.from({ length: 6 }, (_, i) => ({ id: movieId * 100 + i, name: name(), character: name(), order: i, tmdbId: 93000000 + movieId * 100 + i }));
  };

  // ---- music ------------------------------------------------------------------------
  const artists = [];
  const albums = [];
  for (let id = 1; id <= 6; id++) {
    const name = `${pick(ADJ)} ${pick(NOUN)}s`;
    artists.push({ id, name, genres: pick(MUSIC_GENRES), overview: pick(OVERVIEWS), added: iso(today - between(30, 900) * DAY), path: `/media/music/${name}`, foreignArtistId: `demo-artist-${id}` });
    const count = between(2, 5);
    for (let a = 1; a <= count; a++) {
      const albumId = id * 100 + a;
      const tracks = between(8, 14);
      const release = today - between(100, 6000) * DAY;
      const hasFiles = rand() > 0.2;
      albums.push({ id: albumId, artistId: id, title: `${pick(ADJ)} ${pick(NOUN)}`, albumType: a === 1 && count > 3 ? 'EP' : 'Album',
        releaseDate: iso(release), trackCount: tracks, trackFileCount: hasFiles ? tracks : 0, sizeOnDisk: hasFiles ? Math.round(tracks * 9 * 1024 ** 2) : 0,
        duration: tracks * between(180, 260) * 1000, genres: artists.at(-1).genres, foreignAlbumId: `demo-album-${albumId}` });
    }
  }

  // ---- downloads and history ---------------------------------------------------------
  // Each event's date and id come from its episode or film, never from the clock or its
  // place in a list, so a rebuild repeats the same events and Helprr sends nothing twice.
  // An episode shows up once it has been grabbed and imported (two hours after airing).
  const recentEpisodes = episodes
    .filter((ep) => ep.hasFile && Date.parse(ep.airDateUtc) + 2 * HOUR < now && now - Date.parse(ep.airDateUtc) < 10 * DAY)
    .sort((a, b) => Date.parse(a.airDateUtc) - Date.parse(b.airDateUtc))
    .slice(-6);
  const history = recentEpisodes.flatMap((ep) => {
    const grabbed = Date.parse(ep.airDateUtc) + HOUR;
    const show = series.find((s) => s.id === ep.seriesId);
    const release = `${show.title.replace(/ /g, '.')}.S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}.1080p.WEB-DL-DEMO`;
    return [
      { id: ep.id * 2, kind: 'episode', eventType: 'grabbed', date: iso(grabbed), item: ep, show, release, downloadId: hex(`grab${ep.id}`, 40).toUpperCase() },
      { id: ep.id * 2 + 1, kind: 'episode', eventType: 'downloadFolderImported', date: iso(grabbed + 40 * 60_000), item: ep, show, release, downloadId: hex(`grab${ep.id}`, 40).toUpperCase() },
    ];
  });
  // One film imported each day, the last three days shown. Each import belongs to its day
  // (its id and date never change), so a new day brings one new import and no repeat of an
  // old one. The films take turns, so the same film comes round again every ~29 days.
  const owned = movies.filter((m) => m.hasFile);
  const recentMovies = owned.slice(0, 2);
  const day = Math.floor(now / DAY);
  for (let d = day; d > day - 3; d--) {
    const movie = owned[d % owned.length];
    history.push({ id: 6000 + d, kind: 'movie', eventType: 'downloadFolderImported', date: iso(d * DAY - 6 * HOUR), item: movie,
      release: `${movie.title.replace(/ /g, '.')}.${movie.year}.2160p.WEB-DL-DEMO`, downloadId: hex(`movie${d}`, 40).toUpperCase() });
  }
  history.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const downloading = series.find((s) => s.status === 'continuing');
  const queuedEpisode = episodes.find((ep) => ep.seriesId === downloading.id && !ep.hasFile && Date.parse(ep.airDateUtc) < now)
    ?? episodes.find((ep) => ep.seriesId === downloading.id);
  const torrents = [
    { hash: hex('torrent1', 40), name: `${downloading.title.replace(/ /g, '.')}.S${String(queuedEpisode.seasonNumber).padStart(2, '0')}E${String(queuedEpisode.episodeNumber).padStart(2, '0')}.1080p.WEB-DL-DEMO`, size: Math.round(1.6 * GIB), progress: 0.42,
      state: 'downloading', dlspeed: 6_400_000, upspeed: 120_000, category: 'tv', added_on: Math.floor((now - 25 * 60_000) / 1000), eta: 900, episode: queuedEpisode, show: downloading },
    ...recentMovies.slice(0, 2).map((movie, i) => ({ hash: hex(`seed${i}`, 40), name: `${movie.title.replace(/ /g, '.')}.${movie.year}.2160p.WEB-DL-DEMO`, size: movie.size,
      progress: 1, state: 'uploading', dlspeed: 0, upspeed: 40_000 + i * 90_000, category: 'movies', added_on: Math.floor((now - (5 + i * 20) * HOUR) / 1000), eta: 8640000 })),
  ];

  // ---- people and devices ------------------------------------------------------------
  const users = ['Alex Rivers', 'Sam Okafor', 'Jordan Hale', 'Riley Tanaka'].map((name, i) => ({ id: hex(`user${i}`, 32), name, admin: i === 0, email: `${name.split(' ')[0].toLowerCase()}@example.com` }));
  const devices = DEVICES.map((name, i) => ({ id: hex(`device${i}`, 32), name, client: CLIENTS[i % CLIENTS.length], userId: users[i % users.length].id, lastSeen: iso(now - (i * 7 + 1) * HOUR) }));

  return { now, today, series, episodes, movies, collections, cast, artists, albums, history, torrents, users, devices, rand };
}

// Deterministic hex ids (Jellyfin item ids, torrent hashes): invented, not hashes of anything real.
export function hex(seed, length) {
  let out = '';
  let state = 0;
  for (const char of String(seed)) state = (state * 31 + char.charCodeAt(0)) >>> 0;
  const rand = mulberry32(state || 1);
  while (out.length < length) out += Math.floor(rand() * 16).toString(16);
  return out;
}
