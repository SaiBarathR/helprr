// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecItem } from '@/lib/recommendations/rec-types';
import type { RecEventTracker } from './use-rec-events';

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => false }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
vi.mock('@/components/watchlist/watchlist-add-dialog', () => ({ WatchlistAddDialog: () => null }));
import { RecCard } from './rec-card';

const ITEM: RecItem = {
  itemKey: 'tmdb:tv:1', mediaType: 'tv', tmdbId: 1, title: 'Severance', year: 2022, posterUrl: null,
  backdropUrl: null, rating: null, runtimeMin: null, genres: [], overview: null, owned: false,
  href: '/discover/tv/1', source: 'tmdb', reason: null,
};
const tracker = { impression: vi.fn(), event: vi.fn() } as unknown as RecEventTracker;
const touch = { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10 };
const menu = () => screen.queryByRole('menu', { name: 'Actions for Severance' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderCard(onNotInterested = vi.fn()) {
  render(<RecCard item={ITEM} railId="top-picks" position={0} mode="rails" tracker={tracker} onNotInterested={onNotInterested} />);
  return screen.getByRole('link');
}

describe('RecCard actions', () => {
  it('opens its menu on a long press of the card', () => {
    const link = renderCard();
    fireEvent.pointerDown(link, touch);
    act(() => { vi.advanceTimersByTime(800); });
    expect(menu()).not.toBeNull();
  });

  it('opens its menu on a right-click and reaches Not interested', async () => {
    const onNotInterested = vi.fn();
    const link = renderCard(onNotInterested);
    fireEvent.contextMenu(link, { clientX: 10, clientY: 10 });
    const item = screen.getByRole('menuitem', { name: /Not interested/ });
    fireEvent.click(item);
    // The menu runs the action once it has closed.
    await act(async () => {});
    expect(onNotInterested).toHaveBeenCalledWith('tmdb:tv:1');
  });
});
