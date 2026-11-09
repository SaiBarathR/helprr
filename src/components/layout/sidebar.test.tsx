// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collapsed: true,
  navOrder: [] as string[],
  disabledNavItems: [] as string[],
  denied: new Set<string>(),
  counts: {} as Record<string, { total: number; attention: number }>,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href, className, 'aria-label': label }: { children: React.ReactNode; href: string; className?: string; 'aria-label'?: string }) => (
    <a href={href} className={className} aria-label={label}>{children}</a>
  ),
}));
vi.mock('@/components/layout/navigation-provider', () => ({ usePendingHref: () => null }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => null,
  hasCapability: (_me: unknown, cap: string) => !mocks.denied.has(cap),
}));
vi.mock('@/components/search/search-store', () => ({ useSearchPalette: () => () => {} }));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeCounts: () => mocks.counts }));
vi.mock('@/components/layout/nav-badge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/layout/nav-badge')>()),
  NavBadge: () => null,
}));
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
  mocks.counts = {};
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<TooltipProvider><Sidebar /></TooltipProvider>));
const nameOf = (el: Element) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
const names = (scope = 'aside') => Array.from(document.querySelectorAll(`${scope} a, ${scope} button`)).map(nameOf);
// The scrolling list after Search: the phone's four tabs, a divider, then the rest.
const runsOf = () => Array.from(document.querySelectorAll('aside nav[aria-label="Main"] > div'))
  .map((run) => Array.from(run.querySelectorAll('a')).map(nameOf));
const dividers = () => Array.from(document.querySelectorAll('aside nav[aria-label="Main"] > div > div[aria-hidden]'));
const DEFAULT_RUNS = [
  ['Dashboard', 'Movies', 'TV Series', 'Activity'],
  ['Discover', 'Anime', 'Music', 'Watchlist', 'Requests', 'For You', 'Calendar', 'Library Gaps',
    'Torrents', 'Cleanup', 'Prowlarr', 'Watch', 'Jellyfin', 'Insights'],
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

  it.each([true, false])('reads a count after its label, saying what it counts (collapsed: %s)', async (collapsed) => {
    mocks.collapsed = collapsed;
    mocks.counts = {
      notifications: { total: 44, attention: 44 },
      activity: { total: 3, attention: 0 },
      downloads: { total: 2, attention: 0 },
      requests: { total: 1, attention: 1 },
    };
    await render();
    const label = (href: string) => document.querySelector(`aside a[href="${href}"]`)!.getAttribute('aria-label');
    expect(label('/notifications')).toBe('Notifications, 44 unread');
    expect(label('/activity')).toBe('Activity, 3 in queue');
    expect(label('/torrents')).toBe('Torrents, 2 items');
    expect(label('/requests')).toBe('Requests, 1 item');
    // Without a count an expanded item keeps its visible text as its name.
    expect(label('/movies')).toBe(collapsed ? 'Movies' : null);
  });
});

describe('Sidebar active item', () => {
  it('in dark Liquid Glass tints only the icon, keeping the label the primary text colour', async () => {
    mocks.collapsed = false;
    await render();
    const active = document.querySelector('aside a[href="/dashboard"]')!;
    expect([...active.classList]).toEqual(expect.arrayContaining(['text-[color:var(--hpr-tab-label,var(--primary))]', '[html[data-glass][data-scheme=dark]_&]:text-foreground']));
    expect(active.querySelector('svg')!.classList).toContain('text-primary');
    expect(document.querySelector('aside a[href="/movies"] svg')!.classList).not.toContain('text-primary');
  });
});

describe('Sidebar layout', () => {
  it('pins only Notifications and Settings to the footer', () => {
    expect(NAV_ITEMS.filter((item) => item.sidebarFooter).map((item) => item.id)).toEqual(['notifications', 'settings']);
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

  it('follows the default saved order, with one plain divider after the phone tabs and no labels', async () => {
    mocks.collapsed = false;
    await render();
    // Twitch and YouTube stay hidden until configured (useMe is null here).
    expect(runsOf()).toEqual(DEFAULT_RUNS);
    expect(dividers()).toHaveLength(1);
    expect(dividers().every((divider) => divider.textContent === '' && divider.classList.contains('border-t'))).toBe(true);
    const main = document.querySelector('aside nav[aria-label="Main"]')!;
    expect(main.querySelector('[role="group"]')).toBeNull();
    // No section labels: the list's text is Search and the links alone.
    expect(main.textContent).toBe(`Search⌘K${DEFAULT_RUNS.flat().join('')}`);
  });

  it('follows a saved order exactly, dividing after the four phone tabs', async () => {
    mocks.collapsed = false;
    mocks.navOrder = ['jellyfin', 'requests', 'series', 'discover', 'movies', 'jellyfin-library', 'insights'];
    await render();
    expect(runsOf()[0]).toEqual(['Jellyfin', 'Requests', 'TV Series', 'Discover']);
    expect(runsOf()[1].slice(0, 3)).toEqual(['Movies', 'Watch', 'Insights']);
    expect(dividers()).toHaveLength(1);
  });

  it('leaves a pinned phone tab in the footer and divides after the other tabs', async () => {
    mocks.collapsed = false;
    mocks.navOrder = ['settings', 'jellyfin', 'requests', 'notifications', 'series', 'discover'];
    await render();
    // The phone tabs are Settings, Jellyfin, Requests and Notifications.
    expect(runsOf()[0]).toEqual(['Jellyfin', 'Requests']);
    expect(runsOf()[1].slice(0, 2)).toEqual(['TV Series', 'Discover']);
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
    // Without Movies the next allowed item takes the fourth phone tab.
    expect(runsOf()).toEqual([
      ['Dashboard', 'TV Series', 'Activity', 'Discover'],
      ['Anime', 'Music', 'Watchlist', 'Requests', 'For You', 'Calendar', 'Library Gaps', 'Torrents', 'Prowlarr'],
    ]);
    expect(names('aside > div')).toEqual(['Settings', 'Collapse']);
  });

  it('keeps the same runs and dividers when collapsed, and keeps the footer', async () => {
    mocks.collapsed = true;
    await render();
    expect(runsOf()).toEqual(DEFAULT_RUNS);
    expect(dividers()).toHaveLength(1);
    expect(names('aside > div')).toEqual(['Notifications', 'Settings', 'Expand sidebar']);
  });

  it('keeps 36px rows on short desktop windows and 44px touch targets in the rail, Collapse included', async () => {
    mocks.collapsed = true;
    await render();
    const links = Array.from(document.querySelectorAll('aside a'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.className).toContain('py-2');
      expect(link.className).not.toContain('max-height');
      expect(link.className).toContain('pointer-coarse:min-h-11');
    }
    expect(document.querySelector('aside nav[aria-label="Main"] button')!.className).toContain('pointer-coarse:min-h-11');
    expect(document.querySelector('button[aria-label="Expand sidebar"]')!.className).toContain('pointer-coarse:h-11');
  });

});
