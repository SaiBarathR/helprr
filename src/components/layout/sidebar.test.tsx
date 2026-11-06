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
const sectionsOf = () => Array.from(document.querySelectorAll('aside nav[aria-label="Main"] [role="group"]'))
  .map((group) => [group.getAttribute('aria-label'), ...Array.from(group.querySelectorAll('a')).map(nameOf)]);
const DEFAULT_SECTIONS = [
  ['Overview', 'Dashboard', 'Insights'],
  ['Library', 'Movies', 'TV Series', 'Music', 'Watchlist', 'Calendar', 'Library Gaps'],
  ['Downloads', 'Activity', 'Torrents', 'Cleanup', 'Prowlarr'],
  ['Discover', 'Discover', 'Anime', 'Requests', 'Recommendations'],
  ['Media server', 'Watch', 'Jellyfin'],
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

  it('groups the default order under section labels', async () => {
    mocks.collapsed = false;
    await render();
    // Twitch and YouTube stay hidden until configured (useMe is null here).
    expect(sectionsOf()).toEqual(DEFAULT_SECTIONS);
    expect(Array.from(document.querySelectorAll('aside nav[aria-label="Main"] [role="group"] > div')).map((el) => el.textContent))
      .toEqual(DEFAULT_SECTIONS.map(([label]) => label));
  });

  it('keeps a saved order inside each section and orders sections by their first item', async () => {
    mocks.collapsed = false;
    mocks.navOrder = ['settings', 'jellyfin', 'requests', 'series', 'discover', 'notifications', 'movies', 'jellyfin-library'];
    await render();
    expect(sectionsOf().slice(0, 3)).toEqual([
      ['Media server', 'Jellyfin', 'Watch'],
      ['Discover', 'Requests', 'Discover', 'Anime', 'Recommendations'],
      ['Library', 'TV Series', 'Movies', 'Music', 'Watchlist', 'Calendar', 'Library Gaps'],
    ]);
    expect(names('aside > div')).toEqual(['Settings', 'Notifications', 'Collapse']);
    expect(names('aside nav[aria-label="Pinned"]')).toEqual(['Settings', 'Notifications']);
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
    expect(sectionsOf().map(([label]) => label)).toEqual(['Overview', 'Library', 'Downloads', 'Discover']);
    expect(names('aside > div')).toEqual(['Settings', 'Collapse']);
  });

  it('swaps labels for dividers when collapsed and keeps the footer', async () => {
    mocks.collapsed = true;
    await render();
    const groups = Array.from(document.querySelectorAll('aside nav[aria-label="Main"] [role="group"]'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(DEFAULT_SECTIONS.map(([label]) => label));
    expect(groups.map((g) => g.querySelector('.border-t') !== null)).toEqual([false, true, true, true, true]);
    expect(document.querySelector('aside nav[aria-label="Main"]')?.textContent).not.toContain('Library');
    expect(names('aside > div')).toEqual(['Notifications', 'Settings', 'Expand sidebar']);
  });
});
