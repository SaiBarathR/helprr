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

  it('keeps the torrents table columns it knows, and defaults a missing or unusable choice', async () => {
    expect((await loadStored({})).torrentsTableColumns).toEqual(initial.torrentsTableColumns);
    expect((await loadStored({ torrentsTableColumns: ['tags', 'magnet_uri', 'state', 3] })).torrentsTableColumns).toEqual(['tags', 'state']);
    useUIStore.setState(initial, true);
    expect((await loadStored({ torrentsTableColumns: 'tags' })).torrentsTableColumns).toEqual(initial.torrentsTableColumns);
    // Every column hidden is a choice: the table still shows Name.
    expect((await loadStored({ torrentsTableColumns: [] })).torrentsTableColumns).toEqual([]);
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

  it('keeps the new status filters, and the category, tag and tracker picks as names only', async () => {
    const state = await loadStored({
      torrentsFilter: ['stalled', 'errored', 'running', 'inactive', 'checking', 'moving'],
      torrentsCategoryFilter: ['anime', '', 3, null],
      torrentsTagFilter: 'hevc',
      torrentsTrackerFilter: [{ host: 'x' }, 'tracker.invalid'],
    });
    expect(state.torrentsFilter).toEqual(['stalled', 'errored', 'running', 'inactive', 'checking', 'moving']);
    expect(state.torrentsCategoryFilter).toEqual(['anime', '']);
    expect(state.torrentsTagFilter).toEqual([]);
    expect(state.torrentsTrackerFilter).toEqual(['tracker.invalid']);
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

  // An unknown glass mode has no palette: with Liquid Glass on, the theme threw on every page.
  it('falls back to the default for a bad glass mode, out-of-range numbers and bad skip lengths', async () => {
    const state = await loadStored({
      liquidGlass: true, glassMode: 'bogus', glassIntensity: 'max', calendarImageOpacity: 900,
      playerSkipBackSeconds: 7, playerSkipForwardSeconds: '30', discoverContentType: 'anime',
    });
    expect(state.liquidGlass).toBe(true);
    expect(state.glassMode).toBe(initial.glassMode);
    expect(state.glassIntensity).toBe(initial.glassIntensity);
    expect(state.calendarImageOpacity).toBe(initial.calendarImageOpacity);
    expect(state.playerSkipBackSeconds).toBe(initial.playerSkipBackSeconds);
    expect(state.playerSkipForwardSeconds).toBe(initial.playerSkipForwardSeconds);
    expect(state.discoverContentType).toBe('all');
  });

  it('keeps a known glass mode and in-range numbers, rounded', async () => {
    const state = await loadStored({ glassMode: 'dark', glassIntensity: 42.6, calendarImageOpacity: 0, playerSkipBackSeconds: 30 });
    expect(state).toMatchObject({ glassMode: 'dark', glassIntensity: 43, calendarImageOpacity: 0, playerSkipBackSeconds: 30 });
  });

  it('reconciles a stored nav order and Discover layout, and drops ones of the wrong shape', async () => {
    let state = await loadStored({ navOrder: ['settings', 'gone-page', 'movies'], discoverLayout: { sections: 'abc' } });
    expect(state.navOrder.slice(0, 2)).toEqual(['settings', 'movies']);
    expect(state.navOrder).not.toContain('gone-page');
    expect(state.navOrder).toHaveLength(initial.navOrder.length);
    expect(state.discoverLayout).toBeNull();

    useUIStore.setState(initial, true);
    state = await loadStored({ discoverLayout: { sections: [null, 'x', { id: 'trending', type: 'builtin', enabled: false }] } });
    expect(state.discoverLayout?.sections[0]).toMatchObject({ id: 'trending', enabled: false });
    expect(state.discoverLayout?.sections.every((section) => typeof section === 'object' && section !== null)).toBe(true);
  });

  // Empty by default, but Insights reads them as date keys: a number crashed it on every visit.
  it('keeps only real date keys for the Insights range, and typed values for other empty defaults', async () => {
    let state = await loadStored({
      insightsDateFrom: 5, insightsDateTo: 'abc', requestsUserFilter: 'me', dashboardFg: 7, dashboardFgMute: '#aabbcc',
    });
    expect(state.insightsDateFrom).toBeNull();
    expect(state.insightsDateTo).toBeNull();
    expect(state.requestsUserFilter).toBeNull();
    expect(state.dashboardFg).toBeUndefined();
    expect(state.dashboardFgMute).toBe('#aabbcc');

    useUIStore.setState(initial, true);
    state = await loadStored({ insightsDateFrom: ' 2026-10-01 ', insightsDateTo: '2026-02-30', requestsUserFilter: 12 });
    expect(state.insightsDateFrom).toBe('2026-10-01');
    expect(state.insightsDateTo).toBeNull();
    expect(state.requestsUserFilter).toBe(12);
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

  it('a settings import drops a bad glass mode, an out-of-range number and a bad skip length', () => {
    useUIStore.getState().applyImportedUiPrefs({ glassMode: 'bogus', calendarImageOpacity: -5, glassIntensity: 70, playerSkipBackSeconds: 7 });
    const state = useUIStore.getState();
    expect(state.glassMode).toBe(initial.glassMode);
    expect(state.calendarImageOpacity).toBe(initial.calendarImageOpacity);
    expect(state.glassIntensity).toBe(70);
    expect(state.playerSkipBackSeconds).toBe(initial.playerSkipBackSeconds);
  });

  it('a settings import keeps only real date keys for the Insights range', () => {
    useUIStore.setState({ insightsDateFrom: '2026-09-01', insightsDateTo: '2026-09-30' });
    useUIStore.getState().applyImportedUiPrefs({ insightsDateFrom: 5, insightsDateTo: 'abc' });
    expect(useUIStore.getState()).toMatchObject({ insightsDateFrom: '2026-09-01', insightsDateTo: '2026-09-30' });
    useUIStore.getState().applyImportedUiPrefs({ insightsDateFrom: '2026-10-01', insightsDateTo: null, requestsUserFilter: -1 });
    expect(useUIStore.getState()).toMatchObject({ insightsDateFrom: '2026-10-01', insightsDateTo: null, requestsUserFilter: null });
  });

  it('a settings import may clear a pref whose default is empty', () => {
    useUIStore.setState({ insightsDateFrom: '2026-10-01' });
    useUIStore.getState().applyImportedUiPrefs({ insightsDateFrom: null });
    expect(useUIStore.getState().insightsDateFrom).toBeNull();
  });
});
