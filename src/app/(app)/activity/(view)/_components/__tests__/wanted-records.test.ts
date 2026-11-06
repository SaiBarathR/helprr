import { describe, expect, it } from 'vitest';
import {
  isNotReleased,
  searchAllRequests,
  searchAllTargets,
  selectedSearchRequests,
  wantedDate,
  type WantedRecord,
} from '../wanted-records';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const episode = (extra: Partial<WantedRecord> = {}): WantedRecord => ({ id: 1, source: 'sonarr', mediaType: 'episode', ...extra });
const movie = (extra: Partial<WantedRecord> = {}): WantedRecord => ({ id: 2, source: 'radarr', mediaType: 'movie', added: '2026-02-01T00:00:00Z', ...extra });
const album = (extra: Partial<WantedRecord> = {}): WantedRecord => ({ id: 3, source: 'lidarr', mediaType: 'album', ...extra });
const label = (record: WantedRecord) => {
  const d = wantedDate(record, NOW);
  return d && `${d.label} ${d.date.toISOString().slice(0, 10)}`;
};

describe('wantedDate', () => {
  it('names an episode date as aired or airs', () => {
    expect(label(episode({ airDateUtc: '2017-08-23T15:00:00Z' }))).toBe('Aired 2017-08-23');
    expect(label(episode({ airDate: '2026-11-20' }))).toBe('Airs 2026-11-20');
  });

  it('names an album date as released or releases', () => {
    expect(label(album({ releaseDate: '2024-03-01T00:00:00Z' }))).toBe('Released 2024-03-01');
    expect(label(album({ releaseDate: '2027-01-01T00:00:00Z' }))).toBe('Releases 2027-01-01');
  });

  it('shows a released film by its first home release, not the date it was added', () => {
    const out = movie({ isAvailable: true, inCinemas: '2024-05-01T00:00:00Z', digitalRelease: '2024-07-01T00:00:00Z', physicalRelease: '2024-09-01T00:00:00Z' });
    expect(label(out)).toBe('Digital release 2024-07-01');
    expect(label(movie({ isAvailable: true, inCinemas: '2024-05-01T00:00:00Z' }))).toBe('In cinemas 2024-05-01');
  });

  it('shows a film that is not out yet by its next release', () => {
    expect(label(movie({ status: 'announced', inCinemas: '2027-06-10T00:00:00Z', digitalRelease: '2027-09-01T00:00:00Z' })))
      .toBe('In cinemas 2027-06-10');
  });

  it('shows a film in cinemas with a home release still to come by its cinema date', () => {
    expect(label(movie({ isAvailable: false, inCinemas: '2026-07-15T00:00:00Z', digitalRelease: '2026-11-17T00:00:00Z' })))
      .toBe('In cinemas 2026-07-15');
  });

  it('falls back to the added date, labelled, when a film has no release dates', () => {
    expect(label(movie({ status: 'announced', isAvailable: false }))).toBe('Added 2026-02-01');
  });

  it('shows nothing for a record with no usable date', () => {
    expect(wantedDate(episode({ airDateUtc: 'not a date' }), NOW)).toBeNull();
  });
});

// Shaped like real Radarr /api/v3/wanted/missing rows. With minimum availability
// "announced" Radarr reports isAvailable: true for films years from release.
describe('isNotReleased', () => {
  it('holds a future film back even when Radarr counts it as available', () => {
    const secretWars = movie({ title: 'Avengers: Secret Wars', year: 2027, status: 'announced', isAvailable: true, inCinemas: '2027-12-15T00:00:00Z' });
    expect(isNotReleased(secretWars, NOW)).toBe(true);
  });

  it('holds back a future film Radarr counts as unavailable', () => {
    expect(isNotReleased(movie({ status: 'announced', isAvailable: false, inCinemas: '2027-06-16T00:00:00Z' }), NOW)).toBe(true);
  });

  it('lists a film that is already in cinemas, whatever Radarr says about availability', () => {
    expect(isNotReleased(movie({ status: 'inCinemas', isAvailable: true, inCinemas: '2026-08-07T00:00:00Z' }), NOW)).toBe(false);
    expect(isNotReleased(movie({ status: 'inCinemas', isAvailable: false, inCinemas: '2026-07-15T00:00:00Z', digitalRelease: '2026-11-17T00:00:00Z' }), NOW)).toBe(false);
  });

  it('holds back an announced film with no dates, but not a released or unknown one', () => {
    expect(isNotReleased(movie({ status: 'announced', isAvailable: true }), NOW)).toBe(true);
    expect(isNotReleased(movie({ status: 'tba' }), NOW)).toBe(true);
    expect(isNotReleased(movie({ status: 'released', isAvailable: true }), NOW)).toBe(false);
    expect(isNotReleased(movie(), NOW)).toBe(false);
  });

  it('never holds back episodes or albums', () => {
    expect(isNotReleased(episode({ airDateUtc: '2027-01-01T00:00:00Z' }), NOW)).toBe(false);
    expect(isNotReleased(album({ releaseDate: '2027-01-01T00:00:00Z' }), NOW)).toBe(false);
  });
});

describe('search requests', () => {
  it('sends one item search per app and instance, with that instance in the URL', () => {
    const requests = selectedSearchRequests([
      episode({ id: 11, instanceId: 'son-1' }),
      episode({ id: 12, instanceId: 'son-2' }),
      episode({ id: 13, instanceId: 'son-1' }),
      movie({ id: 21, instanceId: 'rad-1' }),
      album({ id: 31, instanceId: 'lid-1' }),
    ]);
    expect(requests).toEqual([
      { url: '/api/sonarr/command?instanceId=son-1', body: { name: 'EpisodeSearch', episodeIds: [11, 13] }, count: 2 },
      { url: '/api/sonarr/command?instanceId=son-2', body: { name: 'EpisodeSearch', episodeIds: [12] }, count: 1 },
      { url: '/api/radarr/command?instanceId=rad-1', body: { name: 'MoviesSearch', movieIds: [21] }, count: 1 },
      { url: '/api/lidarr/command?instanceId=lid-1', body: { name: 'AlbumSearch', albumIds: [31] }, count: 1 },
    ]);
  });

  const instances = [
    { id: 'son-1', source: 'sonarr' as const },
    { id: 'son-2', source: 'sonarr' as const },
    { id: 'rad-1', source: 'radarr' as const },
    { id: 'lid-1', source: 'lidarr' as const },
  ];

  it('searches all on exactly the instances the filters cover', () => {
    expect(searchAllTargets(instances, [], 'all')).toEqual(instances);
    expect(searchAllTargets(instances, ['sonarr'], 'all').map((i) => i.id)).toEqual(['son-1', 'son-2']);
    expect(searchAllTargets(instances, [], 'rad-1').map((i) => i.id)).toEqual(['rad-1']);
    expect(searchAllTargets(instances, ['sonarr'], 'rad-1')).toEqual([]);
  });

  it('uses each app\'s Missing or Cutoff Unmet command per instance', () => {
    expect(searchAllRequests('missing', instances).map((r) => [r.url, r.body.name])).toEqual([
      ['/api/sonarr/command?instanceId=son-1', 'MissingEpisodeSearch'],
      ['/api/sonarr/command?instanceId=son-2', 'MissingEpisodeSearch'],
      ['/api/radarr/command?instanceId=rad-1', 'MissingMoviesSearch'],
      ['/api/lidarr/command?instanceId=lid-1', 'MissingAlbumSearch'],
    ]);
    expect(searchAllRequests('cutoff', instances).map((r) => r.body)).toEqual([
      { name: 'CutoffUnmetEpisodeSearch' },
      { name: 'CutoffUnmetEpisodeSearch' },
      { name: 'CutoffUnmetMoviesSearch' },
      { name: 'CutoffUnmetAlbumSearch' },
    ]);
  });
});
