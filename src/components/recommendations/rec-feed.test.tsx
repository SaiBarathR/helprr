// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RecItem } from '@/lib/recommendations/rec-types';
import type { RecEventTracker } from './use-rec-events';

const item: RecItem = {
  itemKey: 'tmdb:tv:1', mediaType: 'tv', tmdbId: 1, title: 'Severance', year: 2022,
  posterUrl: null, backdropUrl: null, rating: null, runtimeMin: null, genres: [],
  overview: null, owned: false, href: '/discover/tv/1', source: 'tmdb', reason: null,
};
const tracker: RecEventTracker = { impression: vi.fn(), event: vi.fn(), flush: vi.fn(async () => {}) };

vi.mock('@/lib/hooks/use-restorable-infinite-query', () => ({
  useRestorableInfiniteQuery: () => ({ data: { pages: [{ items: [item] }] }, hasNextPage: false }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => false }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/watchlist/watchlist-add-dialog', () => ({ WatchlistAddDialog: () => null }));

import { RecFeed } from './rec-feed';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

it('pads the action overlay by only the safe area left uncovered by footer chrome', () => {
  render(<RecFeed tracker={tracker} />);
  const overlay = screen.getByRole('button', { name: 'Not interested' }).closest<HTMLElement>('.pointer-events-none')!;
  // Top nav/no player: adds the inset. Bottom nav or a player: footer-cover
  // already includes it, so max clamps the extra padding to zero.
  expect(overlay.className).toContain('pb-[calc(1.25rem+max(0px,env(safe-area-inset-bottom,0px)-var(--footer-cover,0px)))]');
});

it('also clears the uncovered safe area for the trailer close action', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ youtubeKey: 'trailer' }) })));
  render(<RecFeed tracker={tracker} />);
  fireEvent.click(screen.getByRole('button', { name: 'Watch trailer' }));
  const close = await screen.findByRole('button', { name: 'Close trailer' });
  expect(close.parentElement?.className).toContain('pb-[calc(0.75rem+max(0px,env(safe-area-inset-bottom,0px)-var(--footer-cover,0px)))]');
});
