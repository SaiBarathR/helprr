// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NAV_ORDER,
  NAV_ITEMS,
  getBottomNavLayout,
  getEnabledNavItems,
  navItemAllowed,
  type NavItemId,
} from '@/lib/nav-config';
import { MEMBER_TEMPLATE } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';
import { STORE_VERSION, migrateUiPrefs, useUIStore } from '@/lib/store';
import { THEME_BOOTSTRAP_SCRIPT, UI_PREFS_STORAGE_KEY } from '@/lib/dashboard-theme';

// The order every install had before Dashboard/Movies/Series/Activity became the default tabs.
const PREVIOUS_DEFAULT_ORDER = NAV_ITEMS.map((item) => item.id);

function tabsFor(order: NavItemId[], has: (cap: Capability) => boolean) {
  const allowed = getEnabledNavItems(order, []).filter((item) => navItemAllowed(item, has, null));
  return getBottomNavLayout(allowed).tabs.map((item) => item.id);
}

describe('default phone tabs', () => {
  it('opens a new install on Dashboard, Movies, Series and Activity', () => {
    expect(tabsFor(DEFAULT_NAV_ORDER, () => true)).toEqual(['dashboard', 'movies', 'series', 'activity']);
  });

  it('keeps every nav item exactly once', () => {
    expect([...DEFAULT_NAV_ORDER].sort()).toEqual([...PREVIOUS_DEFAULT_ORDER].sort());
  });

  it('gives a default member the same four tabs', () => {
    expect(tabsFor(DEFAULT_NAV_ORDER, (cap) => MEMBER_TEMPLATE[cap])).toEqual(['dashboard', 'movies', 'series', 'activity']);
  });

  it('fills a slot the user cannot open with the next allowed item', () => {
    const has = (cap: Capability) => cap !== 'movies.view' && cap !== 'activity.view';
    expect(tabsFor(DEFAULT_NAV_ORDER, has)).toEqual(['dashboard', 'series', 'discover', 'anime']);
  });
});

describe('saved navigation survives the new defaults', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    useUIStore.setState(useUIStore.getInitialState());
  });

  it('starts a user with no saved prefs on the new order with the bar at the bottom', () => {
    const state = useUIStore.getInitialState();
    expect(state.navPosition).toBe('bottom');
    expect(state.navOrder).toEqual(DEFAULT_NAV_ORDER);
  });

  it("keeps an existing user's saved order and top position", async () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ state: { navPosition: 'top', navOrder: PREVIOUS_DEFAULT_ORDER, disabledNavItems: [] }, version: STORE_VERSION }),
    );
    await useUIStore.persist.rehydrate();
    const state = useUIStore.getState();
    expect(state.navPosition).toBe('top');
    expect(tabsFor(state.navOrder, () => true)).toEqual(['dashboard', 'discover', 'anime', 'movies']);
  });

  it('still treats a store saved before the position setting existed as top', () => {
    expect(migrateUiPrefs({}, 9).navPosition).toBe('top');
  });
});

describe('pre-paint nav position stamp', () => {
  const run = () => new Function(THEME_BOOTSTRAP_SCRIPT)();

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.navPosition;
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.navPosition;
    vi.unstubAllGlobals();
  });

  it('paints bottom-nav geometry for a new user', () => {
    run();
    expect(document.documentElement.dataset.navPosition).toBe('bottom');
  });

  it('leaves a saved top position alone', () => {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ state: { navPosition: 'top' }, version: STORE_VERSION }));
    run();
    expect(document.documentElement.dataset.navPosition).toBeUndefined();
  });

  it('replays a saved bottom position', () => {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ state: { navPosition: 'bottom' }, version: STORE_VERSION }));
    run();
    expect(document.documentElement.dataset.navPosition).toBe('bottom');
  });
});

describe('nav names', () => {
  // A phone tab may shorten its sidebar name, never rename it (gap plan U11).
  it.each([
    ['notifications', 'Notifications', 'Notifications'],
    ['random', 'Recommendations', 'Recs'],
    ['library-gaps', 'Library Gaps', 'Gaps'],
  ] as const)('%s reads %s / %s', (id, label, shortLabel) => {
    const item = NAV_ITEMS.find((i) => i.id === id)!;
    expect([item.label, item.shortLabel]).toEqual([label, shortLabel]);
  });
});
