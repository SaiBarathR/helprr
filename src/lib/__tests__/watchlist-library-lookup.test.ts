import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/service-helpers', () => ({ getRadarrClients: vi.fn(), getSonarrClients: vi.fn() }));

import { resolveHrefFromLookups, type LibraryHrefLookups } from '@/lib/watchlist-library-lookup';

function lookups(): LibraryHrefLookups {
  return {
    radarrByTmdbId: new Map([[98, { id: 83, instanceId: 'main' }]]),
    sonarrByTvdbId: new Map(),
    sonarrByTmdbId: new Map(),
    // Radarr id 83 is Gladiator on the main instance and The General on the second.
    radarrById: new Map([[83, [{ instanceId: 'main', title: 'Gladiator' }, { instanceId: 'anime', title: 'The General' }]]]),
    sonarrById: new Map([[12, [{ instanceId: 'anime', title: 'Frieren' }]]]),
  };
}

describe('resolveHrefFromLookups', () => {
  it('sends a title saved from a library page to the instance that has it under that title', () => {
    expect(resolveHrefFromLookups('RADARR', '83', 'movie', lookups(), 'The General')).toBe('/movies/83?instance=anime');
    expect(resolveHrefFromLookups('RADARR', '83', 'movie', lookups(), 'Gladiator')).toBe('/movies/83?instance=main');
  });

  it('uses the only instance with that id, else the default one', () => {
    expect(resolveHrefFromLookups('SONARR', '12', 'series', lookups(), 'Renamed since')).toBe('/series/12?instance=anime');
    expect(resolveHrefFromLookups('RADARR', '83', 'movie', lookups(), 'Retitled')).toBe('/movies/83?instance=main');
  });

  it('keeps the plain link when the id is in no library, and TMDB links unchanged', () => {
    expect(resolveHrefFromLookups('RADARR', '999', 'movie', lookups(), 'Gone')).toBe('/movies/999');
    expect(resolveHrefFromLookups('TMDB', '98', 'movie', lookups())).toBe('/movies/83?instance=main');
    expect(resolveHrefFromLookups('RADARR', '83', 'movie', null, 'The General')).toBe('/movies/83');
  });
});
