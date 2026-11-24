// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORE_VERSION, useUIStore } from '@/lib/store';
import { UI_PREFS_STORAGE_KEY } from '@/lib/dashboard-theme';
import { UI_PREF_CATEGORY_FIELDS } from '@/lib/settings-export';
import { DEFAULT_PROWLARR_INDEXER_VIEW } from '@/lib/prowlarr-indexer-view';
import { applyIndexerView, isIndexerFailing } from '@/app/(app)/prowlarr/indexer-list';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';

const initial = useUIStore.getState();

async function loadStored(state: Record<string, unknown>) {
  localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ state, version: STORE_VERSION }));
  await useUIStore.persist.rehydrate();
  return useUIStore.getState();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  useUIStore.setState(initial, true);
});

describe('the Prowlarr indexer view preference', () => {
  it('starts as every indexer by name', () => {
    expect(initial.prowlarrIndexerView).toEqual(DEFAULT_PROWLARR_INDEXER_VIEW);
  });

  it('is saved, and exported with the Prowlarr settings', async () => {
    useUIStore.getState().setProwlarrIndexerView({ state: 'disabled', tags: [3] });
    const stored = JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? '{}');
    expect(stored.state.prowlarrIndexerView).toMatchObject({ state: 'disabled', tags: [3], sort: 'name' });
    expect(UI_PREF_CATEGORY_FIELDS.prowlarr).toEqual(['prowlarrIndexerView']);
  });

  it('keeps the known parts of a stored view and drops the rest', async () => {
    const state = await loadStored({
      prowlarrIndexerView: {
        search: 'nyaa', sort: 'bogus', state: 'enabled', failing: 'yes',
        protocols: ['torrent', 4], privacy: 'private', tags: [3, -1, '2', 1.5], appProfiles: [2],
      },
    });
    expect(state.prowlarrIndexerView).toEqual({
      search: 'nyaa', sort: 'name', sortDirection: 'asc', state: 'enabled', failing: false,
      protocols: ['torrent'], privacy: [], tags: [3], appProfiles: [2],
    });
  });

  it('falls back to the default for a stored value that is not a view', async () => {
    const state = await loadStored({ prowlarrIndexerView: ['name'] });
    expect(state.prowlarrIndexerView).toEqual(DEFAULT_PROWLARR_INDEXER_VIEW);
  });
});

const indexer = (id: number, name: string, extra: Partial<ProwlarrIndexerSummary> = {}): ProwlarrIndexerSummary => ({
  id, name, enable: true, protocol: 'torrent', privacy: 'public', priority: 25, implementationName: name, tags: [], categories: [], ...extra,
});

describe('applyIndexerView', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');

  it('counts a blocked indexer, or one with failures not yet earned back, as failing', () => {
    expect(isIndexerFailing(1, [{ indexerId: 1, disabledTill: '2026-11-25T13:00:00Z' }], now)).toBe(true);
    expect(isIndexerFailing(1, [{ providerId: 1, escalationLevel: 1 }], now)).toBe(true);
    expect(isIndexerFailing(1, [{ indexerId: 1, escalationLevel: 0, disabledTill: '2026-11-25T11:00:00Z' }], now)).toBe(false);
    expect(isIndexerFailing(1, [{ indexerId: 2, escalationLevel: 3 }], now)).toBe(false);
  });

  it('sorts privacy most open first and puts an indexer with no added date last when newest first', () => {
    const list = [
      indexer(1, 'b', { privacy: 'private', added: '2026-01-01T00:00:00Z' }),
      indexer(2, 'a', { privacy: 'semiPrivate' }),
      indexer(3, 'c', { privacy: 'public', added: '2025-01-01T00:00:00Z' }),
    ];
    expect(applyIndexerView(list, [], { ...DEFAULT_PROWLARR_INDEXER_VIEW, sort: 'privacy' }).map((i) => i.id)).toEqual([3, 2, 1]);
    expect(applyIndexerView(list, [], { ...DEFAULT_PROWLARR_INDEXER_VIEW, sort: 'added', sortDirection: 'desc' }).map((i) => i.id)).toEqual([1, 3, 2]);
  });

  it('breaks a tie by name A–Z whatever the direction', () => {
    const list = [indexer(1, 'b'), indexer(2, 'a'), indexer(3, 'c', { priority: 1 })];
    expect(applyIndexerView(list, [], { ...DEFAULT_PROWLARR_INDEXER_VIEW, sort: 'priority', sortDirection: 'desc' }).map((i) => i.name))
      .toEqual(['a', 'b', 'c']);
    expect(applyIndexerView(list, [], { ...DEFAULT_PROWLARR_INDEXER_VIEW, sortDirection: 'desc' }).map((i) => i.name))
      .toEqual(['c', 'b', 'a']);
  });

  it('keeps an indexer with no app profile out of an app profile filter', () => {
    const list = [indexer(1, 'a', { appProfileId: 2 }), indexer(2, 'b')];
    expect(applyIndexerView(list, [], { ...DEFAULT_PROWLARR_INDEXER_VIEW, appProfiles: [2] }).map((i) => i.id)).toEqual([1]);
  });
});
