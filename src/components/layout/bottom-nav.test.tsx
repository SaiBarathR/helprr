// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BADGE_COUNTS, type BadgeCounts } from '@/types/badges';

const mocks = vi.hoisted(() => ({ counts: null as BadgeCounts | null }));

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href, onClick, className }: { children: React.ReactNode; href: string; onClick?: React.MouseEventHandler; className?: string }) => (
    // jsdom cannot navigate, so stop the default after the component's handler.
    <a href={href} className={className} onClick={(event) => { onClick?.(event); event.preventDefault(); }}>{children}</a>
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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.counts = { ...EMPTY_BADGE_COUNTS };
  useSearchPalette.setState({ open: false });
  useUIStore.setState(useUIStore.getInitialState());
});

describe('BottomNav', () => {
  it('shows the default tabs, then More and a visible Search', () => {
    render(<BottomNav />);
    const bar = within(screen.getByRole('navigation'));
    expect(bar.getAllByRole('link').map((link) => link.textContent)).toEqual(['Dashboard', 'Movies', 'Series', 'Activity']);
    expect(bar.getAllByRole('button').map((button) => button.textContent)).toEqual(['More', 'Search']);
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

  it('ends the More list with Customize tabs, linking to the navigation settings', async () => {
    render(<BottomNav />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const customize = await screen.findByRole('link', { name: 'Customize tabs' });
    expect(customize.getAttribute('href')).toBe('/settings/appearance#navigation');
    await userEvent.click(customize);
    expect(screen.queryByRole('link', { name: 'Customize tabs' })).toBeNull();
  });
});
