// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BADGE_COUNTS, type BadgeCounts } from '@/types/badges';

const mocks = vi.hoisted(() => ({ counts: null as BadgeCounts | null }));

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href, onClick, className, 'aria-label': ariaLabel }: { children: React.ReactNode; href: string; onClick?: React.MouseEventHandler; className?: string; 'aria-label'?: string }) => (
    // jsdom cannot navigate, so stop the default after the component's handler.
    <a href={href} aria-label={ariaLabel} className={className} onClick={(event) => { onClick?.(event); event.preventDefault(); }}>{children}</a>
  ),
}));
vi.mock('@/components/layout/navigation-provider', () => ({ usePendingHref: () => null }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ role: 'admin', capabilities: {} }),
  hasCapability: () => true,
}));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeCounts: () => mocks.counts }));

import { BottomNav } from './bottom-nav';
import { useSearchPalette } from '@/components/search/search-store';
import { useUIStore } from '@/lib/store';

// jsdom has no pointer capture, which the drawer asks for on a press inside it.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // The tab bar only shows below md, so the More menu is the phone drawer.
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  mocks.counts = { ...EMPTY_BADGE_COUNTS };
  useSearchPalette.setState({ open: false });
  useUIStore.setState(useUIStore.getInitialState());
});

describe('BottomNav', () => {
  // The four tabs and More fill the bar; Search sits beside them.
  const slots = () => {
    const search = within(screen.getByRole('navigation')).getByRole('button', { name: 'Search' });
    return Array.from(search.previousElementSibling!.children).map((slot) => slot.textContent);
  };

  it('shows the default tabs and More in five slots, with Search beside them', () => {
    render(<BottomNav />);
    const bar = within(screen.getByRole('navigation'));
    expect(bar.getAllByRole('link').map((link) => link.textContent)).toEqual(['Dashboard', 'Movies', 'Series', 'Activity']);
    expect(slots()).toEqual(['Dashboard', 'Movies', 'Series', 'Activity', 'More']);
    const search = bar.getByRole('button', { name: 'Search' });
    // A tab-like slot with its label; at the bottom globals.css makes it round and hides the label.
    expect(search.textContent).toBe('Search');
    expect(search.querySelector('.app-tab-search-label')!.textContent).toBe('Search');
    // The same slot classes as an idle tab.
    expect([...search.classList]).toEqual(expect.arrayContaining(
      [...bar.getByRole('link', { name: 'Movies' }).classList].filter((name) => !['touch-manipulation', 'active:opacity-70'].includes(name)),
    ));
    // Last in the bar, so it sits at its right (bottom-right with the nav at the bottom).
    expect(search.parentElement!.lastElementChild).toBe(search);
    // At the bottom, globals.css floats the tabs and Search as two surfaces; at the
    // top the tab group gives way so Search is one more slot (floating-tab-bar.test.ts).
    expect([...search.previousElementSibling!.classList]).toEqual(expect.arrayContaining(['app-tab-surface', 'app-tab-group']));
    expect([...search.classList]).toEqual(expect.arrayContaining(['app-tab-search', 'app-tab-surface']));
  });

  it("under Liquid Glass tints only the active tab's icon, keeping its label the primary text colour", () => {
    render(<BottomNav />);
    const active = within(screen.getByRole('navigation')).getByRole('link', { name: 'Dashboard' });
    // Other themes tint the label through --hpr-tab-label; Glass (either scheme) turns it to the text colour.
    expect([...active.classList]).toEqual(expect.arrayContaining(['text-[color:var(--hpr-tab-label,var(--primary))]', '[html[data-glass]_&]:text-foreground']));
    expect(active.querySelector('svg')!.classList).toContain('text-primary');
    const idle = within(screen.getByRole('navigation')).getByRole('link', { name: 'Movies' });
    expect(idle.classList).toContain('text-muted-foreground');
    expect(idle.querySelector('svg')!.classList).not.toContain('text-primary');
  });

  it("keeps an existing user's saved tabs in the four tab slots", () => {
    useUIStore.setState({ navOrder: ['discover', 'anime', 'movies', 'torrents', 'dashboard'] });
    render(<BottomNav />);
    expect(slots()).toEqual(['Discover', 'Anime', 'Movies', 'Torrents', 'More']);
  });

  it('opens global search from the tab bar', async () => {
    render(<BottomNav />);
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(useSearchPalette.getState().open).toBe(true);
  });

  it('counts the hidden items on More instead of a bare dot', () => {
    mocks.counts = { ...EMPTY_BADGE_COUNTS, notifications: { total: 3, attention: 3 }, requests: { total: 2, attention: 2 } };
    render(<BottomNav />);
    expect(screen.getByRole('button', { name: /More/ }).textContent).toBe('5More');
  });

  it("overlaps only its icon's top-right corner, ringed in the bar's colour", () => {
    mocks.counts = { ...EMPTY_BADGE_COUNTS, notifications: { total: 44, attention: 44 } };
    render(<BottomNav />);
    const badge = within(screen.getByRole('button', { name: /More/ })).getByText('44');
    // Its left edge 4px inside the icon's right edge, 5px above the icon (the
    // bar's 14px inner padding keeps a 99+ on the last slot inside the pill).
    expect([...badge.classList]).toEqual(expect.arrayContaining(['absolute', 'left-[calc(100%-4px)]', '-top-[5px]', 'h-4', 'ring-2', 'ring-background', '[html[data-glass]_&]:ring-[color:var(--hpr-glass-bg)]']));
    expect(badge.parentElement!.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: /More/ }).parentElement!.classList).toContain('px-3.5');
  });

  it('names a tab with a count label first, then the count, for screen readers', () => {
    mocks.counts = { ...EMPTY_BADGE_COUNTS, notifications: { total: 59, attention: 59 }, activity: { total: 3, attention: 0 } };
    render(<BottomNav />);
    const bar = within(screen.getByRole('navigation'));
    expect(bar.getByRole('button', { name: 'More, 59 unread' })).toBeTruthy();
    expect(bar.getByRole('link', { name: 'Activity, 3 in queue' })).toBeTruthy();
    // Tabs without a count keep their plain label.
    expect(bar.getByRole('link', { name: 'Movies' })).toBeTruthy();
    expect(bar.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('names More sheet rows with a count the same way', async () => {
    mocks.counts = { ...EMPTY_BADGE_COUNTS, notifications: { total: 44, attention: 44 }, requests: { total: 2, attention: 2 }, downloads: { total: 1, attention: 0 } };
    render(<BottomNav />);
    await userEvent.click(screen.getByRole('button', { name: /^More/ }));
    const sheet = within(await screen.findByRole('dialog', { name: 'More' }));
    expect(sheet.getByRole('link', { name: 'Notifications, 44 unread' })).toBeTruthy();
    expect(sheet.getByRole('link', { name: 'Requests, 2 items' })).toBeTruthy();
    expect(sheet.getByRole('link', { name: 'Torrents, 1 item' })).toBeTruthy();
    expect(sheet.getByRole('link', { name: 'Discover' })).toBeTruthy();
  });

  it('caps the spoken count the way the badge shows it', () => {
    mocks.counts = { ...EMPTY_BADGE_COUNTS, notifications: { total: 140, attention: 140 } };
    render(<BottomNav />);
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: 'More, 99+ unread' })).toBeTruthy();
  });

  it('does not count the same downloads twice when Activity and Torrents are both in More', () => {
    useUIStore.setState({ navOrder: ['dashboard', 'discover', 'anime', 'movies', 'activity', 'torrents'] });
    mocks.counts = { ...EMPTY_BADGE_COUNTS, activity: { total: 3, attention: 0 }, downloads: { total: 4, attention: 0 } };
    render(<BottomNav />);
    expect(screen.getByRole('button', { name: /More/ }).textContent).toBe('4More');
  });

  it('places itself by CSS, so the first paint follows the pre-paint position stamp', () => {
    useUIStore.setState({ navPosition: 'top' });
    render(<BottomNav />);
    const bar = screen.getByRole('navigation');
    expect(bar.classList).toContain('app-tab-bar');
    expect([...bar.classList].some((name) => /^(fixed|sticky)$/.test(name))).toBe(false);
  });

  it('opens More as a titled bottom sheet whose items navigate and close it', async () => {
    render(<BottomNav />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(sheet.getAttribute('data-vaul-drawer-direction')).toBe('bottom');
    const discover = within(sheet).getByRole('link', { name: 'Discover' });
    expect(discover.getAttribute('href')).toBe('/discover');
    await userEvent.click(discover);
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
  });

  it('ends the More list with Customize tabs, linking to the navigation settings', async () => {
    render(<BottomNav />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const customize = await within(await screen.findByRole('dialog', { name: 'More' })).findByRole('link', { name: 'Customize tabs' });
    expect(customize.getAttribute('href')).toBe('/settings/appearance#navigation');
    await userEvent.click(customize);
    expect(screen.queryByRole('link', { name: 'Customize tabs' })).toBeNull();
  });
});
