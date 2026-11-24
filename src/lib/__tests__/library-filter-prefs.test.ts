// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORE_VERSION, migrateUiPrefs, useUIStore } from '@/lib/store';
import { UI_PREFS_STORAGE_KEY } from '@/lib/dashboard-theme';
import { UI_PREF_CATEGORY_FIELDS } from '@/lib/settings-export';

const initial = useUIStore.getState();

async function loadStored(state: Record<string, unknown>, version: number) {
  localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ state, version }));
  await useUIStore.persist.rehydrate();
  return useUIStore.getState();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  useUIStore.setState(initial, true);
});

describe('library facet and saved filter preferences', () => {
  it('upgrades a version 56 store with empty facets and no saved filters, keeping the rest', async () => {
    expect(STORE_VERSION).toBe(57);
    const state = await loadStored({ moviesFilter: ['missing'], seriesSort: 'year' }, 56);
    expect(state.moviesFilter).toEqual(['missing']);
    expect(state.seriesSort).toBe('year');
    for (const page of ['movies', 'series', 'music'] as const) {
      expect(state[`${page}FacetFilter`]).toEqual({ tags: [], qualityProfiles: [], rootFolders: [], genres: [] });
      expect(state[`${page}SavedFilters`]).toEqual([]);
    }
    // The migration adds nothing, so a partial settings import gains no fields it never exported.
    const migrated = migrateUiPrefs({ navPosition: 'top' }, 56);
    for (const key of ['moviesFacetFilter', 'moviesSavedFilters', 'seriesFacetFilter', 'seriesSavedFilters', 'musicFacetFilter', 'musicSavedFilters']) {
      expect(migrated).not.toHaveProperty(key);
    }
  });

  it('keeps the new Cutoff Unmet status and drops malformed facets and saved filters', async () => {
    const state = await loadStored({
      moviesFilter: ['cutoffUnmet', 'bogus'],
      seriesFilter: ['cutoffUnmet'],
      moviesFacetFilter: { tags: ['a:3', 7], genres: ['Drama'] },
      seriesFacetFilter: 'junk',
      musicSavedFilters: [{ id: 'm', name: 'Jazz', status: ['cutoffUnmet', 'missing'], facets: { genres: ['Jazz'] } }],
      seriesSavedFilters: { not: 'a list' },
    }, STORE_VERSION);
    expect(state.moviesFilter).toEqual(['cutoffUnmet']);
    expect(state.seriesFilter).toEqual(['cutoffUnmet']);
    expect(state.moviesFacetFilter).toEqual({ tags: ['a:3'], qualityProfiles: [], rootFolders: [], genres: ['Drama'] });
    expect(state.seriesFacetFilter).toEqual(initial.seriesFacetFilter);
    // Music has no Cutoff Unmet filter, so a saved one loses that status.
    expect(state.musicSavedFilters).toEqual([{
      id: 'm', name: 'Jazz', status: ['missing'],
      facets: { tags: [], qualityProfiles: [], rootFolders: [], genres: ['Jazz'] }, instance: 'all', watch: 'all',
    }]);
    expect(state.seriesSavedFilters).toEqual([]);
  });

  it('travels in the settings export with the other library view prefs, and imports checked', () => {
    for (const key of ['moviesFacetFilter', 'moviesSavedFilters', 'seriesFacetFilter', 'seriesSavedFilters', 'musicFacetFilter', 'musicSavedFilters']) {
      expect(UI_PREF_CATEGORY_FIELDS.mediaViews).toContain(key);
    }
    useUIStore.getState().applyImportedUiPrefs({
      moviesSavedFilters: [{ id: 'x', name: 'Imported', status: ['hasFile'], instance: 'abc' }, { name: 'no id' }],
      moviesFacetFilter: ['wrong shape'],
    });
    const state = useUIStore.getState();
    expect(state.moviesSavedFilters.map((f) => [f.id, f.name, f.status, f.instance])).toEqual([['x', 'Imported', ['hasFile'], 'abc']]);
    expect(state.moviesFacetFilter).toEqual(initial.moviesFacetFilter);
  });
});
