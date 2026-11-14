// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORE_VERSION, sanitizeUiPrefs, useUIStore } from '@/lib/store';
import { UI_PREFS_STORAGE_KEY } from '@/lib/dashboard-theme';

const initial = useUIStore.getState();

async function loadStored(state: Record<string, unknown>, version = STORE_VERSION) {
  localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ state, version }));
  await useUIStore.persist.rehydrate();
  return useUIStore.getState();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  useUIStore.setState(initial, true);
});

describe('stored view, sort and filter preferences', () => {
  // The migration runs only on a version change, so a bad value saved at the
  // current version used to reach the page as is: Movies crashed on 'grid'.
  it('falls back to the default for an unknown view at the current version', async () => {
    const state = await loadStored({ moviesView: 'grid', seriesView: 42, musicView: null, calendarView: 'day' });
    expect(state.moviesView).toBe('posters');
    expect(state.seriesView).toBe('posters');
    expect(state.musicView).toBe('posters');
    expect(state.calendarView).toBe('agenda');
    // The page reads its fields by view: a known view keeps that lookup working.
    expect(state.moviesVisibleFields[state.moviesView]).toEqual(initial.moviesVisibleFields.posters);
  });

  it('keeps known choices', async () => {
    const state = await loadStored({
      moviesView: 'table', seriesView: 'overview', moviesSort: 'year', seriesSortDirection: 'desc',
      torrentsView: 'table', torrentsSortKey: 'ratio', activityTab: 'missing', requestsFilter: 'approved',
    });
    expect(state).toMatchObject({
      moviesView: 'table', seriesView: 'overview', moviesSort: 'year', seriesSortDirection: 'desc',
      torrentsView: 'table', torrentsSortKey: 'ratio', activityTab: 'missing', requestsFilter: 'approved',
    });
  });

  it('replaces an unknown sort or direction on Movies, Series, Music and Torrents', async () => {
    const state = await loadStored({
      moviesSort: 'bogus', seriesSort: '', musicSort: 'title', moviesSortDirection: 'up',
      torrentsSortKey: 'speed', torrentsSortDir: 1, moviesPosterSize: 'huge',
    });
    expect(state).toMatchObject({
      moviesSort: 'title', seriesSort: 'title', musicSort: 'sortName', moviesSortDirection: 'asc',
      torrentsSortKey: 'added_on', torrentsSortDir: 'desc', moviesPosterSize: 'medium',
    });
  });

  it('drops unknown filter entries and a filter that is not a list', async () => {
    const state = await loadStored({
      moviesFilter: ['monitored', 'bogus'], seriesFilter: 'monitored', musicFilter: ['complete'],
      torrentsFilter: ['seeding', 7], requestsTypeFilter: ['tv', 'music'],
    });
    expect(state.moviesFilter).toEqual(['monitored']);
    expect(state.seriesFilter).toEqual([]);
    expect(state.musicFilter).toEqual(['complete']);
    expect(state.torrentsFilter).toEqual(['seeding']);
    expect(state.requestsTypeFilter).toEqual(['tv']);
  });

  it('keeps a value of the right kind, drops one of the wrong kind, and loads no unpersisted keys', async () => {
    const state = await loadStored({
      moviesInstanceFilter: 'abc', calendarShowImages: 'yes', moviesVisibleFields: { posters: 'title' },
      hasHydrated: 'no', setMoviesView: 1,
    });
    expect(state.moviesInstanceFilter).toBe('abc');
    expect(state.calendarShowImages).toBe(true);
    expect(state.moviesVisibleFields).toEqual(initial.moviesVisibleFields);
    expect(typeof state.setMoviesView).toBe('function');
  });

  it('checks values that came through a version migration too', async () => {
    const state = await loadStored({ moviesView: 'grid', moviesSort: 'year' }, STORE_VERSION - 1);
    expect(state.moviesView).toBe('posters');
    expect(state.moviesSort).toBe('year');
  });

  it('sanitizes nothing it was not given', () => {
    expect(sanitizeUiPrefs({ navPosition: 'top' }, initial)).toEqual({ navPosition: 'top' });
    expect(sanitizeUiPrefs('junk', initial)).toEqual({});
  });

  it('a settings import drops an unknown view or sort the same way', () => {
    useUIStore.getState().applyImportedUiPrefs({ moviesView: 'grid', moviesSort: 'year', seriesView: 'table' });
    const state = useUIStore.getState();
    expect(state.moviesView).toBe('posters');
    expect(state.moviesSort).toBe('year');
    expect(state.seriesView).toBe('table');
  });

  it('a settings import may clear a pref whose default is empty', () => {
    useUIStore.setState({ insightsDateFrom: '2026-10-01' });
    useUIStore.getState().applyImportedUiPrefs({ insightsDateFrom: null });
    expect(useUIStore.getState().insightsDateFrom).toBeNull();
  });
});
