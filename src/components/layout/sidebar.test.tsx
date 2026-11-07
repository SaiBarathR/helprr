// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collapsed: true,
  navOrder: [] as string[],
  disabledNavItems: [] as string[],
  denied: new Set<string>(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href, 'aria-label': label }: { children: React.ReactNode; href: string; 'aria-label'?: string }) => (
    <a href={href} aria-label={label}>{children}</a>
  ),
}));
vi.mock('@/components/layout/navigation-provider', () => ({ usePendingHref: () => null }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => null,
  hasCapability: (_me: unknown, cap: string) => !mocks.denied.has(cap),
}));
vi.mock('@/components/search/search-store', () => ({ useSearchPalette: () => () => {} }));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeCounts: () => ({}) }));
vi.mock('@/components/layout/nav-badge', () => ({ NavBadge: () => null }));
vi.mock('@/lib/store', () => ({
  useUIStore: (select: (s: Record<string, unknown>) => unknown) => select({
    sidebarCollapsed: mocks.collapsed, toggleSidebar: () => {},
    navOrder: mocks.navOrder, disabledNavItems: mocks.disabledNavItems,
  }),
}));
import { TooltipProvider } from '@/components/ui/tooltip';
import { DEFAULT_NAV_ORDER, NAV_ITEMS } from '@/lib/nav-config';
import { Sidebar } from './sidebar';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="root"></div>';
  mocks.navOrder = [...DEFAULT_NAV_ORDER];
  mocks.disabledNavItems = [];
  mocks.denied = new Set();
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<TooltipProvider><Sidebar /></TooltipProvider>));
const nameOf = (el: Element) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
const names = (scope = 'aside') => Array.from(document.querySelectorAll(`${scope} a, ${scope} button`)).map(nameOf);
// The scrolling list after Search: one run of links per group, a divider between runs.
const runsOf = () => Array.from(document.querySelectorAll('aside nav[aria-label="Main"] > div'))
  .map((run) => Array.from(run.querySelectorAll('a')).map(nameOf));
const dividers = () => Array.from(document.querySelectorAll('aside nav[aria-label="Main"] > div > div[aria-hidden]'));
const DEFAULT_RUNS = [
  ['Dashboard'],
  ['Movies', 'TV Series'],
  ['Activity'],
  ['Discover', 'Anime'],
  ['Music', 'Watchlist'],
  ['Requests', 'Recommendations'],
  ['Calendar', 'Library Gaps'],
  ['Torrents', 'Cleanup', 'Prowlarr'],
  ['Watch', 'Jellyfin'],
  ['Insights'],
];

describe('Sidebar names', () => {
  it('names every icon-only control when collapsed', async () => {
    mocks.collapsed = true;
    await render();
    expect(names().every(Boolean)).toBe(true);
    expect(names('aside nav[aria-label="Main"]')[0]).toBe('Search');
    expect(names('aside > div')).toEqual(['Notifications', 'Settings', 'Expand sidebar']);
  });

  it('keeps the visible text as the name when expanded', async () => {
    mocks.collapsed = false;
    await render();
    expect(document.querySelectorAll('aside a[aria-label], aside button[aria-label]')).toHaveLength(0);
    expect(names('aside nav[aria-label="Main"]')[0]).toBe('Search⌘K');
    expect(names('aside > div')).toEqual(['Notifications', 'Settings', 'Collapse']);
  });
});

describe('Sidebar layout', () => {
  it('leaves only Notifications and Settings without a section', () => {
    expect(NAV_ITEMS.filter((item) => !item.group).map((item) => item.id)).toEqual(['notifications', 'settings']);
  });

  it('pins Notifications and Settings below the scrolling list', async () => {
    mocks.collapsed = false;
    await render();
    const main = document.querySelector('aside nav[aria-label="Main"]')!;
    expect(document.querySelectorAll('aside .overflow-y-auto')).toEqual(document.querySelectorAll('aside nav[aria-label="Main"]'));
    expect(main.contains(document.querySelector('aside nav[aria-label="Pinned"]'))).toBe(false);
    const scrollList = names('aside nav[aria-label="Main"]');
    expect(scrollList).not.toContain('Notifications');
    expect(scrollList).not.toContain('Settings');
    expect(names('aside > div')).toEqual(['Notifications', 'Settings', 'Collapse']);
  });

  it('follows the default saved order, with plain dividers where a group ends and no labels', async () => {
    mocks.collapsed = false;
    await render();
    // Twitch and YouTube stay hidden until configured (useMe is null here).
    expect(runsOf()).toEqual(DEFAULT_RUNS);
    expect(dividers()).toHaveLength(DEFAULT_RUNS.length - 1);
    expect(dividers().every((divider) => divider.textContent === '' && divider.classList.contains('border-t'))).toBe(true);
    const main = document.querySelector('aside nav[aria-label="Main"]')!;
    expect(main.querySelector('[role="group"]')).toBeNull();
    // No section labels: the list's text is Search and the links alone.
    expect(main.textContent).toBe(`Search⌘K${DEFAULT_RUNS.flat().join('')}`);
  });

  it('follows a saved order exactly, not a fixed section order', async () => {
    mocks.collapsed = false;
    mocks.navOrder = ['settings', 'jellyfin', 'requests', 'series', 'discover', 'notifications', 'movies', 'jellyfin-library', 'insights'];
    await render();
    expect(runsOf().flat().slice(0, 7)).toEqual(['Jellyfin', 'Requests', 'TV Series', 'Discover', 'Movies', 'Watch', 'Insights']);
    expect(runsOf().slice(0, 6)).toEqual([['Jellyfin'], ['Requests'], ['TV Series'], ['Discover'], ['Movies'], ['Watch']]);
    expect(names('aside > div')).toEqual(['Settings', 'Notifications', 'Collapse']);
    expect(names('aside nav[aria-label="Pinned"]')).toEqual(['Settings', 'Notifications']);
  });

  it('keeps one run when a pinned item sits between two items of the same group', async () => {
    mocks.collapsed = false;
    mocks.navOrder = ['movies', 'notifications', 'series', 'dashboard'];
    await render();
    expect(runsOf().slice(0, 2)).toEqual([['Movies', 'TV Series'], ['Dashboard']]);
  });

  it('leaves hidden and disallowed items out, and drops sections left empty', async () => {
    mocks.collapsed = false;
    mocks.disabledNavItems = ['notifications', 'jellyfin', 'jellyfin-library', 'movies'];
    mocks.denied = new Set(['insights.view', 'cleanup.view']);
    await render();
    const all = names();
    for (const hidden of ['Notifications', 'Jellyfin', 'Watch', 'Movies', 'Insights', 'Cleanup']) {
      expect(all).not.toContain(hidden);
    }
    // Removing Movies leaves TV Series alone in its run; nothing is left empty.
    expect(runsOf()).toEqual([
      ['Dashboard'], ['TV Series'], ['Activity'], ['Discover', 'Anime'], ['Music', 'Watchlist'],
      ['Requests', 'Recommendations'], ['Calendar', 'Library Gaps'], ['Torrents', 'Prowlarr'],
    ]);
    expect(names('aside > div')).toEqual(['Settings', 'Collapse']);
  });

  it('keeps the same runs and dividers when collapsed, and keeps the footer', async () => {
    mocks.collapsed = true;
    await render();
    expect(runsOf()).toEqual(DEFAULT_RUNS);
    expect(dividers()).toHaveLength(DEFAULT_RUNS.length - 1);
    expect(names('aside > div')).toEqual(['Notifications', 'Settings', 'Expand sidebar']);
  });

});
