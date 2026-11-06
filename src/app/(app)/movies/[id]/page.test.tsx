// @vitest-environment jsdom
// The Radarr "monitored" toggle must not look like the watchlist bookmark, and a
// stray unmonitor must be recoverable from its toast (gap plan U7).
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  sent: [] as Array<{ method: string; path: string; body: { monitored: boolean } }>,
  // When set, PUT responses wait for it, so a write can be held in flight.
  gate: null as Promise<void> | null,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '5' }),
  useSearchParams: () => new URLSearchParams('instance=rad-1'),
  usePathname: () => '/movies/5',
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => cap === 'movies.editMonitoring', useMe: () => null }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ useExternalUrls: () => ({}), useExternalUrlResolver: () => () => undefined }));
vi.mock('@/lib/hooks/use-reference-data', () => ({ useQualityProfiles: () => ({ data: [] }), useTags: () => ({ data: [] }) }));
vi.mock('@/components/jellyfin/watch-status-provider', () => ({
  hasWatchLookupIdentity: () => false,
  useWatchLookup: () => () => null,
  useWatchStatus: () => ({ setWatched: vi.fn(), canWrite: false, isWriting: false }),
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
}));
vi.mock('@/components/ui/quick-context-menu', () => ({ QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/media/virtualized-person-rail', () => ({ VirtualizedPersonRail: () => null }));
vi.mock('@/components/media/media-download-progress', () => ({ MediaDownloadProgress: () => null }));
vi.mock('@/components/jellyfin/play-in-helprr-button', () => ({ PlayInHelprrButton: () => null }));
vi.mock('@/components/jellyfin/mark-watched-button', () => ({ MarkWatchedMenuItem: () => null }));
vi.mock('@/components/jellyfin/watch-status-indicator', () => ({ WatchStatusInline: () => null }));
vi.mock('@/components/watchlist/watchlist-add-dialog', () => ({ WatchlistAddDialog: () => null }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertDialog: () => null }));
vi.mock('@/components/media/rename-preview-dialog', () => ({ RenamePreviewDialog: () => null }));

import MovieDetailPage from './page';
import { queryKeys } from '@/lib/query-keys';

const movie = {
  id: 5, title: 'Dune', year: 2021, monitored: true, hasFile: false, status: 'released', runtime: 155,
  qualityProfileId: 1, minimumAvailability: 'released', tags: [], genres: [], images: [], ratings: {}, added: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sent = [];
  mocks.gate = null;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://helprr.test');
    const method = init?.method ?? 'GET';
    if (method === 'PUT' && url.pathname === '/api/radarr/5') {
      const body = JSON.parse(String(init!.body));
      mocks.sent.push({ method, path: `${url.pathname}${url.search}`, body });
      if (mocks.gate) await mocks.gate;
      return Response.json(body);
    }
    if (url.pathname === '/api/radarr/5') return Response.json(movie);
    return Response.json([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><MovieDetailPage /></QueryClientProvider>);
  return user;
}

describe('movie detail monitored toggle', () => {
  it('uses the eye icon, not the watchlist bookmark', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: 'Monitored' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Monitored');
    expect(toggle.querySelector('svg.lucide-eye')).toBeTruthy();
    expect(toggle.querySelector('svg.lucide-bookmark')).toBeNull();
    // The watchlist keeps the bookmark.
    expect(screen.getAllByRole('button', { name: 'Add to watchlist' })[0].querySelector('svg.lucide-bookmark')).toBeTruthy();
  });

  it('offers Undo after unmonitoring, and Undo monitors the movie again', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Monitored' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Unmonitored', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })));
    const toggle = screen.getByRole('button', { name: 'Monitored' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('title')).toBe('Not monitored');
    expect(toggle.querySelector('svg.lucide-eye-off')).toBeTruthy();

    const { action } = mocks.toast.success.mock.calls[0][1] as { action: { onClick: () => void } };
    act(() => action.onClick());
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Now monitored'));
    expect(mocks.sent.map((s) => s.body.monitored)).toEqual([false, true]);
    expect(mocks.sent[1].path).toBe('/api/radarr/5?instanceId=rad-1');
    expect(screen.getByRole('button', { name: 'Monitored' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('runs an Undo tapped mid-write after that write, so the Undo wins', async () => {
    const user = renderPage();
    const toggle = await screen.findByRole('button', { name: 'Monitored' });
    await user.click(toggle); // unmonitor → toast with Undo
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Unmonitored', expect.anything()));
    const { action } = mocks.toast.success.mock.calls[0][1] as { action: { onClick: () => void } };
    await user.click(toggle); // monitor again
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));

    let release!: () => void;
    mocks.gate = new Promise((resolve) => { release = resolve; });
    await user.click(toggle); // unmonitor, held in flight
    await waitFor(() => expect(mocks.sent).toHaveLength(3));
    act(() => action.onClick()); // the first toast's Undo, tapped while that write is pending
    await act(async () => { await Promise.resolve(); });
    expect(mocks.sent).toHaveLength(3); // waits its turn instead of racing

    mocks.gate = null;
    act(() => release());
    await waitFor(() => expect(mocks.sent).toHaveLength(4));
    expect(mocks.sent.map((s) => s.body.monitored)).toEqual([false, true, false, true]);
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
  });

  it('flips only this instance\'s movie in the cached library list', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(queryKeys.library('radarr'), [
      { id: 5, instanceId: 'rad-1', title: 'Dune', monitored: true },
      { id: 5, instanceId: 'rad-2', title: 'Alien', monitored: true },
    ]);
    const user = renderPage(client);
    await user.click(await screen.findByRole('button', { name: 'Monitored' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Unmonitored', expect.anything()));
    expect(client.getQueryData<Array<{ instanceId: string; monitored: boolean }>>(queryKeys.library('radarr'))!
      .map((m) => [m.instanceId, m.monitored])).toEqual([['rad-1', false], ['rad-2', true]]);
  });
});
