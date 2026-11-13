// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canManage: true, canMusic: true, search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search, usePathname: () => '/activity/blocklist' }));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  canGoBackInApp: () => false,
}));
vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useCan: (cap: string) => (cap === 'activity.manage' ? mocks.canManage : cap === 'music.view' ? mocks.canMusic : true),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import BlocklistPage from './page';

const ENTRIES = [
  { id: 11, sourceTitle: 'Show.S01E01.1080p-GRP', date: '2026-11-04T10:00:00Z', indexer: 'Nyaa', protocol: 'torrent', message: 'Download failed', source: 'sonarr', instanceId: 'son-1', instanceLabel: 'main', series: { id: 3, title: 'Show' } },
  { id: 12, sourceTitle: 'Show.S01E02.1080p-GRP', date: '2026-11-03T10:00:00Z', indexer: 'Nyaa', protocol: 'torrent', source: 'sonarr', instanceId: 'son-1', instanceLabel: 'main' },
  { id: 4, sourceTitle: 'Movie.2026.2160p-GRP', date: '2026-11-02T10:00:00Z', indexer: 'Other', protocol: 'usenet', source: 'radarr', instanceId: 'rad-1', instanceLabel: 'main' },
];

let deletes: Array<Record<string, unknown>>;

beforeEach(() => {
  mocks.canManage = true;
  mocks.canMusic = true;
  deletes = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE' && url === '/api/activity/blocklist') {
      deletes.push(JSON.parse(String(init.body)));
      return Response.json({ success: true });
    }
    if (url.startsWith('/api/activity/blocklist?')) return Response.json({ records: ENTRIES, hasMore: false });
    if (url === '/api/instances') return Response.json([]);
    return Response.json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><BlocklistPage /></QueryClientProvider>);
}

describe('Blocklist page', () => {
  it('lists each entry with its release, indexer and protocol, and opens its message', async () => {
    renderPage();
    expect(await screen.findByText('Show.S01E01.1080p-GRP')).toBeTruthy();
    expect(screen.getByText('Movie.2026.2160p-GRP')).toBeTruthy();
    expect(screen.getByText('usenet')).toBeTruthy();
    expect(screen.getAllByText('Nyaa')).toHaveLength(2);

    await userEvent.click(screen.getByText('Show.S01E01.1080p-GRP'));
    expect(await screen.findByText('Download failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove from blocklist' })).toBeTruthy();
  });

  it('removes a selection only after confirming, one request per instance', async () => {
    renderPage();
    await screen.findByText('Show.S01E01.1080p-GRP');
    await userEvent.click(screen.getByRole('button', { name: 'Select entries' }));
    await userEvent.click(screen.getByText('Show.S01E01.1080p-GRP'));
    await userEvent.click(screen.getByText('Show.S01E02.1080p-GRP'));
    await userEvent.click(screen.getByText('Movie.2026.2160p-GRP'));
    expect(screen.getByText('3 selected')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove 3 entries from the blocklist?')).toBeTruthy();
    expect(deletes).toEqual([]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deletes).toHaveLength(2));
    expect(deletes).toEqual(expect.arrayContaining([
      { source: 'sonarr', instanceId: 'son-1', ids: [11, 12] },
      { source: 'radarr', instanceId: 'rad-1', ids: [4] },
    ]));
  });

  it('shows an entry once when a later page repeats it', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      const page = new URL(String(url), 'http://localhost').searchParams.get('page');
      if (String(url).startsWith('/api/activity/blocklist?')) {
        return Response.json(page === '1' ? { records: ENTRIES.slice(0, 2), hasMore: true } : { records: ENTRIES.slice(1), hasMore: false });
      }
      return Response.json([]);
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Movie.2026.2160p-GRP')).toBeTruthy();
    expect(screen.getAllByText('Show.S01E02.1080p-GRP')).toHaveLength(1);
  });

  it('shows no remove or select actions to a member without activity.manage', async () => {
    mocks.canManage = false;
    renderPage();
    await userEvent.click(await screen.findByText('Show.S01E01.1080p-GRP'));
    expect(await screen.findByText('Download failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove from blocklist' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select entries' })).toBeNull();
  });

  it('offers Lidarr instances only with music.view, which the server checks too', async () => {
    const instances = [
      { id: 'son-1', label: 'main', type: 'SONARR' },
      { id: 'rad-1', label: 'main', type: 'RADARR' },
      { id: 'lid-1', label: 'main', type: 'LIDARR' },
    ];
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url) === '/api/instances' ? Response.json(instances) : Response.json({ records: ENTRIES, hasMore: false }));

    for (const canMusic of [true, false]) {
      mocks.canMusic = canMusic;
      const { unmount } = renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Instance: All instances' }));
      expect(await screen.findByText('main (Radarr)')).toBeTruthy();
      expect(screen.queryByText('main (Lidarr)') != null).toBe(canMusic);
      unmount();
    }
  });
});
