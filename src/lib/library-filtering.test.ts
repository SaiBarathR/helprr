import { describe, expect, it } from 'vitest';
import { prepareMovieRows, deriveMovieBaseRows, searchPreparedRows, preparedItems } from './library-filtering';
import type { RadarrMovieListItem } from '@/types';
describe('large-library search preserves ordering and instance identity', () => {
  it.each([500, 5_000, 20_000])('filters %i prepared rows without re-sorting or rebuilding keys', (count) => {
    const movies = Array.from({ length: count }, (_, index) => ({ id: index % 1000, instanceId: String(Math.floor(index / 1000)), title: `Title ${index}`, sortTitle: String(count - index).padStart(6, '0'), monitored: index % 2 === 0, year: 2026 } as RadarrMovieListItem));
    const start = performance.now();
    const prepared = prepareMovieRows(movies);
    const base = deriveMovieBaseRows(prepared, { filter: ['monitored'], instanceFilter: 'all', sort: 'title', sortDir: 'asc' });
    const preparedMs = performance.now() - start;
    const searchAt = performance.now();
    const result = searchPreparedRows(base, 'TITLE 12');
    const searchMs = performance.now() - searchAt;
    expect(result.every((row) => base.includes(row))).toBe(true);
    expect(preparedItems(result)).toEqual(movies.filter((movie) => movie.monitored && movie.title.toLowerCase().includes('title 12')).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle)));
    expect(new Set(prepared.map((row) => row.key)).size).toBe(count);
    console.info(JSON.stringify({ fixture: 'library', count, preparedMs, searchMs }));
  });
});

import {
  EMPTY_LIBRARY_FACETS,
  deriveMusicBaseRows,
  deriveSeriesBaseRows,
  libraryFacetOptions,
  prepareMusicRows,
  prepareSeriesRows,
  rootFolderOf,
  type LibraryFacetFilters,
} from './library-filtering';
import type { LidarrArtistListItem, SonarrSeriesListItem } from '@/types';

function movie(over: Partial<RadarrMovieListItem>): RadarrMovieListItem {
  return {
    id: 1, title: 'M', sortTitle: 'm', year: 2026, monitored: true, hasFile: false, status: 'released',
    tags: [], genres: [], qualityProfileId: 1, path: '/movies/M (2026)', instanceId: 'a', instanceLabel: 'Radarr A',
    ...over,
  } as RadarrMovieListItem;
}

function series(over: Partial<SonarrSeriesListItem>): SonarrSeriesListItem {
  return {
    id: 1, title: 'S', sortTitle: 's', year: 2026, monitored: true, status: 'continuing', tags: [], genres: [],
    qualityProfileId: 1, path: '/tv/S', instanceId: 'a', instanceLabel: 'Sonarr A',
    statistics: { seasonCount: 1, episodeFileCount: 1, episodeCount: 1, totalEpisodeCount: 1, sizeOnDisk: 0, percentOfEpisodes: 100 },
    ...over,
  } as SonarrSeriesListItem;
}

const facets = (over: Partial<LibraryFacetFilters>): LibraryFacetFilters => ({ ...EMPTY_LIBRARY_FACETS, ...over });
const movieIds = (items: RadarrMovieListItem[], opts: Partial<Parameters<typeof deriveMovieBaseRows>[1]>) =>
  deriveMovieBaseRows(prepareMovieRows(items), { filter: [], instanceFilter: 'all', sort: 'title', sortDir: 'asc', ...opts })
    .map((row) => row.key);

describe('library facet filters', () => {
  // Tag 3 on one Radarr is unrelated to tag 3 on another: the pick names its instance.
  const sameTagIdOnTwoInstances = [
    movie({ id: 10, title: 'A1', sortTitle: 'a1', instanceId: 'a', tags: [3] }),
    movie({ id: 10, title: 'B1', sortTitle: 'b1', instanceId: 'b', tags: [3] }),
    movie({ id: 11, title: 'A2', sortTitle: 'a2', instanceId: 'a', tags: [] }),
  ];

  it('matches a tag only on its own instance', () => {
    expect(movieIds(sameTagIdOnTwoInstances, { facets: facets({ tags: ['a:3'] }) })).toEqual(['a:10']);
    expect(movieIds(sameTagIdOnTwoInstances, { facets: facets({ tags: ['b:3'] }) })).toEqual(['b:10']);
    expect(movieIds(sameTagIdOnTwoInstances, { facets: facets({ tags: ['a:3', 'b:3'] }) })).toEqual(['a:10', 'b:10']);
  });

  it('matches "No tags" to untagged items, alone or with a tag', () => {
    expect(movieIds(sameTagIdOnTwoInstances, { facets: facets({ tags: [''] }) })).toEqual(['a:11']);
    expect(movieIds(sameTagIdOnTwoInstances, { facets: facets({ tags: ['', 'b:3'] }) })).toEqual(['a:11', 'b:10']);
  });

  it('matches a quality profile only on its own instance', () => {
    const items = [
      movie({ id: 1, sortTitle: 'a', instanceId: 'a', qualityProfileId: 4 }),
      movie({ id: 1, sortTitle: 'b', instanceId: 'b', qualityProfileId: 4 }),
      movie({ id: 2, sortTitle: 'c', instanceId: 'a', qualityProfileId: 5 }),
    ];
    expect(movieIds(items, { facets: facets({ qualityProfiles: ['b:4'] }) })).toEqual(['b:1']);
    expect(movieIds(items, { facets: facets({ qualityProfiles: ['a:4', 'a:5'] }) })).toEqual(['a:1', 'a:2']);
  });

  it('matches a root folder from the item, or the folder above its own', () => {
    const items = [
      movie({ id: 1, sortTitle: 'a', rootFolderPath: '/data/movies/', path: '/elsewhere/A' }),
      movie({ id: 2, sortTitle: 'b', rootFolderPath: undefined, path: '/data/movies/B (2020)/' }),
      movie({ id: 3, sortTitle: 'c', rootFolderPath: '/data/4k' }),
      movie({ id: 1, sortTitle: 'd', instanceId: 'b', rootFolderPath: '/data/movies' }),
    ];
    expect(movieIds(items, { facets: facets({ rootFolders: ['a:/data/movies'] }) })).toEqual(['a:1', 'a:2']);
    expect(rootFolderOf({ path: 'D:\\Media\\Movies\\Film (2001)' })).toBe('D:\\Media\\Movies');
    expect(rootFolderOf({ path: undefined })).toBe('');
  });

  it('matches any picked genre, and needs every group and the status filter to match', () => {
    const items = [
      movie({ id: 1, sortTitle: 'a', genres: ['Drama'], tags: [3] }),
      movie({ id: 2, sortTitle: 'b', genres: ['Comedy', 'Drama'], tags: [] }),
      movie({ id: 3, sortTitle: 'c', genres: ['Horror'], tags: [3], monitored: false }),
    ];
    expect(movieIds(items, { facets: facets({ genres: ['Comedy', 'Horror'] }) })).toEqual(['a:2', 'a:3']);
    expect(movieIds(items, { facets: facets({ genres: ['Drama', 'Horror'], tags: ['a:3'] }) })).toEqual(['a:1', 'a:3']);
    expect(movieIds(items, { filter: ['monitored'], facets: facets({ tags: ['a:3'] }) })).toEqual(['a:1']);
  });

  it('filters series and artists by the same facets', () => {
    const shows = [
      series({ id: 1, sortTitle: 'a', instanceId: 'a', tags: [2], genres: ['Anime'] }),
      series({ id: 1, sortTitle: 'b', instanceId: 'b', tags: [2], genres: ['Anime'] }),
    ];
    const seriesKeys = deriveSeriesBaseRows(prepareSeriesRows(shows), {
      filter: [], facets: facets({ tags: ['b:2'], genres: ['Anime'] }), instanceFilter: 'all', sort: 'title', sortDir: 'asc',
    }).map((row) => row.key);
    expect(seriesKeys).toEqual(['b:1']);

    const artists = [
      { id: 1, artistName: 'X', sortName: 'x', instanceId: 'a', tags: [], genres: ['Jazz'], qualityProfileId: 1, path: '/music/X', monitored: true },
      { id: 2, artistName: 'Y', sortName: 'y', instanceId: 'a', tags: [], genres: ['Rock'], qualityProfileId: 2, path: '/music/Y', monitored: true },
    ] as unknown as LidarrArtistListItem[];
    const artistKeys = deriveMusicBaseRows(prepareMusicRows(artists), {
      filter: [], facets: facets({ qualityProfiles: ['a:2'] }), instanceFilter: 'all', sort: 'sortName', sortDir: 'asc',
    }).map((row) => row.key);
    expect(artistKeys).toEqual(['a:2']);
  });
});

describe('cutoff unmet', () => {
  it('matches monitored movies whose file is below the cutoff, as Radarr’s Wanted list does', () => {
    const items = [
      movie({ id: 1, sortTitle: 'a', hasFile: true, qualityCutoffNotMet: true }),
      movie({ id: 2, sortTitle: 'b', hasFile: true, qualityCutoffNotMet: true, monitored: false }),
      movie({ id: 3, sortTitle: 'c', hasFile: true, qualityCutoffNotMet: false }),
      movie({ id: 4, sortTitle: 'd', hasFile: false }),
    ];
    expect(movieIds(items, { filter: ['cutoffUnmet'] })).toEqual(['a:1']);
    // Status filters still match any one picked: Missing or Cutoff Unmet is "wanted".
    expect(movieIds(items, { filter: ['cutoffUnmet', 'missing'] })).toEqual(['a:1', 'a:4']);
  });

  it('matches series by the keys from Sonarr, on their own instance, and none before they load', () => {
    const shows = [
      series({ id: 5, sortTitle: 'a', instanceId: 'a' }),
      series({ id: 5, sortTitle: 'b', instanceId: 'b' }),
    ];
    const keys = (cutoffUnmetKeys?: ReadonlySet<string>) => deriveSeriesBaseRows(prepareSeriesRows(shows), {
      filter: ['cutoffUnmet'], cutoffUnmetKeys, instanceFilter: 'all', sort: 'title', sortDir: 'asc',
    }).map((row) => row.key);
    expect(keys(new Set(['b:5']))).toEqual(['b:5']);
    expect(keys(undefined)).toEqual([]);
  });
});

describe('facet menu options', () => {
  it('names tags from the items’ own labels and each instance when there are several', () => {
    const items = [
      movie({ id: 1, instanceId: 'a', instanceLabel: 'Radarr A', tags: [3, 4], tagLabels: ['4k', 'kids'], qualityProfileId: 1, qualityProfileName: 'HD' }),
      // One label missing: it can't be told which id it names, so this item names none.
      movie({ id: 2, instanceId: 'b', instanceLabel: 'Radarr B', tags: [3, 9], tagLabels: ['anime'], qualityProfileId: 1, qualityProfileName: 'Any' }),
      movie({ id: 3, instanceId: 'b', instanceLabel: 'Radarr B', tags: [3], tagLabels: ['anime'], genres: ['Drama'] }),
      movie({ id: 4, instanceId: 'b', instanceLabel: 'Radarr B', tags: [] }),
    ];
    const options = libraryFacetOptions(items, facets({ genres: ['Western'] }));
    expect(options.tags).toEqual([
      { value: '', label: 'No tags' },
      { value: 'a:3', label: '4k', hint: 'Radarr A' },
      { value: 'b:3', label: 'anime', hint: 'Radarr B' },
      { value: 'a:4', label: 'kids', hint: 'Radarr A' },
      { value: 'b:9', label: 'Tag 9', hint: 'Radarr B' },
    ]);
    expect(options.qualityProfiles.map((o) => [o.value, o.label, o.hint])).toEqual([
      ['b:1', 'Any', 'Radarr B'],
      ['a:1', 'HD', 'Radarr A'],
    ]);
    // A picked genre no item has stays, so it can be unpicked.
    expect(options.genres.map((o) => o.value)).toEqual(['Drama', 'Western']);
  });

  it('leaves out the instance name with one instance, and the groups no item fills', () => {
    const options = libraryFacetOptions([movie({ tags: [], rootFolderPath: '/data/movies' })], EMPTY_LIBRARY_FACETS);
    expect(options.tags).toEqual([]);
    expect(options.genres).toEqual([]);
    expect(options.rootFolders).toEqual([{ value: 'a:/data/movies', label: '/data/movies', hint: undefined }]);
  });
});
