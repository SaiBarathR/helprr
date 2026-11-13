// @vitest-environment jsdom
// The artist badge counts only the albums already out, and keeps that through a
// failed background refetch rather than fall back to Lidarr's totals.
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ albumsFail: false }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '2' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/music/2',
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => false, useMe: () => ({}) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ useExternalUrls: () => ({}), useExternalUrlResolver: () => () => undefined }));
vi.mock('@/lib/hooks/use-reference-data', () => ({
  useQualityProfiles: () => ({ data: [] }), useMetadataProfiles: () => ({ data: [] }), useTags: () => ({ data: [] }),
}));
vi.mock('@/components/ui/quick-context-menu', () => ({ QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertDialog: () => null }));
vi.mock('@/components/media/rename-preview-dialog', () => ({ RenamePreviewDialog: () => null }));

import ArtistDetailPage from './page';

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();
// Lidarr's own totals count the album ahead's tracks as missing.
const artist = {
  id: 2, artistName: 'QA Future Artist', status: 'continuing', artistType: 'Group', monitored: true, tags: [], images: [], genres: [], links: [],
  qualityProfileId: 1, metadataProfileId: 1, ratings: { votes: 0, value: 0 }, overview: '', path: '/music/x',
  statistics: { albumCount: 1, trackFileCount: 0, trackCount: 1, totalTrackCount: 1, sizeOnDisk: 0, percentOfTracks: 0 },
};
let albums: unknown[];

beforeEach(() => {
  mocks.albumsFail = false;
  albums = [{ id: 10, artistId: 2, title: 'Debut Ahead', albumType: 'Album', releaseDate: day(30), monitored: true, images: [], secondaryTypes: [], statistics: { trackFileCount: 0, totalTrackCount: 1, sizeOnDisk: 0 } }];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(String(input), 'http://helprr.test');
    if (url.pathname === '/api/lidarr/2/albums') return mocks.albumsFail ? new Response('down', { status: 503 }) : Response.json(albums);
    if (url.pathname === '/api/lidarr/2') return Response.json(artist);
    return Response.json([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ArtistDetailPage /></QueryClientProvider>);
  return client;
}

describe('artist badge', () => {
  it('says an artist with nothing out yet is not released, though Lidarr counts its tracks as missing', async () => {
    renderPage();
    expect(await screen.findByText('Not released yet')).toBeTruthy();
    expect(screen.queryByText('Missing tracks')).toBeNull();
  });

  it('keeps that through a failed background refetch of the albums', async () => {
    const client = renderPage();
    await screen.findByText('Not released yet');
    mocks.albumsFail = true;
    await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll().some((q) => q.state.status === 'error')).toBe(true));
    expect(screen.getByText('Not released yet')).toBeTruthy();
    expect(screen.queryByText('Missing tracks')).toBeNull();
  });

  it('is Missing tracks when a released album lacks tracks', async () => {
    albums = [...albums, { id: 7, artistId: 2, title: 'Out', albumType: 'Album', releaseDate: day(-100), monitored: true, images: [], secondaryTypes: [], statistics: { trackFileCount: 0, totalTrackCount: 3, sizeOnDisk: 0 } }];
    renderPage();
    expect(await screen.findByText('Missing tracks')).toBeTruthy();
  });
});
