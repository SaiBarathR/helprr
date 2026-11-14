// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
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

describe('nav capability gates', () => {
  const libraryGaps = NAV_ITEMS.find((item) => item.id === 'library-gaps')!;

  // /api/library-gaps needs both libraries; the page would only show a load failure.
  it('shows Library Gaps only with both series.view and movies.view', () => {
    expect(navItemAllowed(libraryGaps, () => true, null)).toBe(true);
    expect(navItemAllowed(libraryGaps, (cap) => cap !== 'series.view', null)).toBe(false);
    expect(navItemAllowed(libraryGaps, (cap) => cap !== 'movies.view', null)).toBe(false);
  });

  it('gives every item but Settings a capability gate', () => {
    const ungated = NAV_ITEMS.filter((item) => !item.requiredCapability && !item.requiredAnyCapability);
    expect(ungated.map((item) => item.id)).toEqual(['settings']);
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

// globals.css lowers the top nav out of the band iOS blurs in a Home Screen app.
describe('pre-paint iOS Home Screen app stamp', () => {
  const run = () => new Function(THEME_BOOTSTRAP_SCRIPT)();
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)';
  const stamped = () => document.documentElement.hasAttribute('data-ios-app');

  function device(userAgent: string, { standalone, displayStandalone }: { standalone?: boolean; displayStandalone: boolean }) {
    vi.stubGlobal('navigator', { ...navigator, userAgent, standalone });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' ? displayStandalone : false }));
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-ios-app');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks the Home Screen app on an iPhone', () => {
    device(iPhone, { standalone: true, displayStandalone: true });
    run();
    expect(stamped()).toBe(true);
  });

  it('marks it from display-mode alone too', () => {
    device(iPhone, { displayStandalone: true });
    run();
    expect(stamped()).toBe(true);
  });

  it('leaves a Safari tab, an installed Android app and the desktop unmarked', () => {
    device(iPhone, { standalone: false, displayStandalone: false });
    run();
    expect(stamped()).toBe(false);
    device('Mozilla/5.0 (Linux; Android 16; Pixel 9) Chrome/145.0 Mobile', { displayStandalone: true });
    run();
    expect(stamped()).toBe(false);
    device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', { displayStandalone: true });
    run();
    expect(stamped()).toBe(false);
  });

  // An iPad's Home Screen app has the blur too (iPad mini: soft icons at 38.75 pt).
  it('marks an iPad Home Screen app, also when iPadOS asks for the desktop site as a Mac', () => {
    device('Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X)', { standalone: true, displayStandalone: true });
    run();
    expect(stamped()).toBe(true);
    document.documentElement.removeAttribute('data-ios-app');
    device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', { standalone: true, displayStandalone: true });
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', maxTouchPoints: 5 });
    run();
    expect(stamped()).toBe(true);
  });

  it('leaves an iPad Safari tab and a Mac without touch unmarked', () => {
    device('Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X)', { standalone: false, displayStandalone: false });
    run();
    expect(stamped()).toBe(false);
    // A Mac web app (Add to Dock) is standalone, but has no touch.
    device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', { displayStandalone: true });
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', maxTouchPoints: 0 });
    run();
    expect(stamped()).toBe(false);
  });

  it('marks it even where localStorage throws', () => {
    device(iPhone, { standalone: true, displayStandalone: true });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    run();
    expect(stamped()).toBe(true);
  });
});

describe('nav names', () => {
  // A phone tab may shorten its sidebar name, never rename it (gap plan U11).
  it.each([
    ['notifications', 'Notifications', 'Notifications'],
    ['random', 'For You', 'For You'],
    ['library-gaps', 'Library Gaps', 'Gaps'],
  ] as const)('%s reads %s / %s', (id, label, shortLabel) => {
    const item = NAV_ITEMS.find((i) => i.id === id)!;
    expect([item.label, item.shortLabel]).toEqual([label, shortLabel]);
  });
});

// The rule the stamp feeds (globals.css), read as text: jsdom applies no media queries.
describe('top nav drop below the iOS blur', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const at = css.indexOf('--top-nav-drop: 27px');
  const media = css.slice(css.lastIndexOf('@media', at), css.indexOf('{', css.lastIndexOf('@media', at)));
  const selector = css.slice(css.indexOf('{', css.lastIndexOf('@media', at)) + 1, css.lastIndexOf('{', at)).trim();

  it('applies only to a window narrow enough for the top bar, in portrait (an iPad mini, Split View, Slide Over)', () => {
    expect(at).toBeGreaterThan(0);
    expect(media).toContain('(max-width: 767.98px)');
    expect(media).toContain('(orientation: portrait)');
  });

  it('needs the iOS app stamp, the nav at the top, and no cinematic skin', () => {
    expect(selector).toContain('[data-ios-app]');
    expect(selector).toContain(':not([data-nav-position="bottom"])');
    expect(selector).toContain(":not([data-watch-skin='cinematic']:has(.hpr-watch))");
  });

  it('moves the bar, the header offset sticky toolbars use, and nothing when unset', () => {
    expect(css).toContain('padding-top: calc(env(safe-area-inset-top, 0px) + var(--top-nav-drop, 0px));');
    expect(css).toContain('--header-height: calc(env(safe-area-inset-top, 0px) + var(--top-nav-drop, 0px) + 3rem);');
  });
});
