// @vitest-environment jsdom
// The movie page's next actions (Play, searches, files) render right under the hero,
// ahead of the facts, overview and Cast & Crew rails, so phones reach them without scrolling.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inJellyfin: true,
  movie: {} as Record<string, unknown>,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '5' }),
  useSearchParams: () => new URLSearchParams('instance=rad-1'),
  usePathname: () => '/movies/5',
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true, useMe: () => ({ role: 'admin' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/hooks/use-external-urls', () => ({
  useExternalUrls: () => ({}),
  useExternalUrlResolver: () => () => 'https://radarr.example',
}));
vi.mock('@/lib/hooks/use-reference-data', () => ({
  useQualityProfiles: () => ({ data: [{ id: 4, name: 'HD-1080p' }] }),
  useTags: () => ({ data: [] }),
}));
vi.mock('@/components/jellyfin/watch-status-provider', () => ({
  hasWatchLookupIdentity: () => true,
  useWatchLookup: () => () => null,
  useWatchStatus: () => ({ setWatched: vi.fn(), canWrite: false, isWriting: false }),
}));
vi.mock('@/components/media/virtualized-person-rail', () => ({
  VirtualizedPersonRail: ({ title }: { title: string }) => <section aria-label={title} />,
}));
vi.mock('@/components/discover/discover-video-rail', () => ({ DiscoverVideoRail: () => null }));
vi.mock('@/components/discover/discover-media-rail', () => ({ DiscoverMediaRail: () => null }));
vi.mock('@/components/discover/discover-watch-providers', () => ({ DiscoverWatchProvidersSection: () => null }));
vi.mock('@/components/media/media-download-progress', () => ({ MediaDownloadProgress: () => null }));
vi.mock('@/components/jellyfin/mark-watched-button', () => ({ MarkWatchedMenuItem: () => null }));
vi.mock('@/components/jellyfin/watch-status-indicator', () => ({ WatchStatusInline: () => null }));
vi.mock('@/components/watchlist/watchlist-add-dialog', () => ({ WatchlistAddDialog: () => null }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertDialog: () => null }));
vi.mock('@/components/media/rename-preview-dialog', () => ({ RenamePreviewDialog: () => null }));

import MovieDetailPage from './page';

const credit = (id: number, type: 'cast' | 'crew') => ({
  id, type, personName: `Person ${id}`, personTmdbId: id, character: 'Someone', job: 'Director', order: id, images: [],
});

function movie(hasFile: boolean) {
  return {
    id: 5, title: 'Arrival', year: 2016, runtime: 116, certification: 'PG-13', tmdbId: 329865, imdbId: 'tt2543164',
    hasFile, monitored: true, status: 'released', minimumAvailability: 'released', qualityProfileId: 4, tags: [],
    path: '/movies/Arrival (2016)', sizeOnDisk: hasFile ? 4_000_000_000 : 0, genres: ['Drama'], studio: 'Lava Bear',
    overview: 'A linguist works with the military to communicate with alien lifeforms.',
    images: [], ratings: {}, added: '2024-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const { pathname } = new URL(String(input), 'http://helprr.test');
    if (pathname === '/api/radarr/5') return Response.json(mocks.movie);
    if (pathname === '/api/radarr/credit') return Response.json([credit(1, 'cast'), credit(2, 'crew')]);
    // The Play button renders only once Jellyfin has the title.
    if (pathname === '/api/jellyfin/lookup') return Response.json(mocks.inJellyfin ? { itemId: 'jf-5' } : {});
    return Response.json({}, { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MovieDetailPage /></QueryClientProvider>);
}

const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('movie detail action order', () => {
  it('puts Play ahead of the overview and Cast & Crew for a downloaded movie', async () => {
    mocks.movie = movie(true);
    mocks.inJellyfin = true;
    renderPage();
    const cast = await screen.findByRole('region', { name: 'Cast' });
    const play = await screen.findByRole('link', { name: 'Play' });
    const overview = screen.getByText(/A linguist works/);
    expect(precedes(play, screen.getByText('STATUS'))).toBe(true);
    expect(precedes(play, overview)).toBe(true);
    expect(precedes(play, cast)).toBe(true);
    expect(precedes(screen.getByRole('button', { name: /Files & information/ }), cast)).toBe(true);
  });

  it('puts the searches ahead of the overview and Cast & Crew for a missing movie', async () => {
    mocks.movie = movie(false);
    mocks.inJellyfin = false;
    renderPage();
    const cast = await screen.findByRole('region', { name: 'Cast' });
    expect(screen.queryByRole('link', { name: 'Play' })).toBeNull();
    const overview = screen.getByText(/A linguist works/);
    for (const name of ['Automatic', 'Interactive']) {
      const button = screen.getByRole('button', { name });
      expect(precedes(button, screen.getByText('STATUS'))).toBe(true);
      expect(precedes(button, overview)).toBe(true);
      expect(precedes(button, cast)).toBe(true);
    }
  });
});
