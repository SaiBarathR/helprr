// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  push: vi.fn(),
  replace: vi.fn(),
  download: {} as Record<string, unknown>,
  calls: [] as Array<{ url: string; method: string; body: unknown }>,
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'md1' }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => <h1>{title} {subtitle}</h1> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import LinkedDownloadPage from './page';

const now = new Date().toISOString();
function blocked(extra: Record<string, unknown> = {}) {
  return {
    id: 'md1', mode: 'ARR_MANAGED', status: 'BLOCKED', service: 'RADARR', instanceId: 'r1', instanceLabel: 'radarr-4k',
    externalId: 10331, arrItemId: 15, arrItemTitle: 'Night of the Living Dead', createdArrItem: true, targetEpisodeIds: [],
    releaseTitle: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP', source: 'MAGNET', infoHash: 'ABC', torrentName: 'x',
    downloadClientName: 'qBittorrent', lastError: 'Radarr cannot import it: Sample', attempts: 1, createdByUsername: 'admin',
    createdAt: now, updatedAt: now, completedAt: null,
    events: [
      { at: now, status: 'QUEUED', message: 'Radarr grabbed the release.' },
      { at: now, status: 'DOWNLOADING', message: 'Downloading.' },
      { at: now, status: 'BLOCKED', message: 'Radarr cannot import it: Sample' },
    ],
    ...extra,
  };
}

beforeEach(() => {
  mocks.caps = new Set(['activity.manage', 'torrents.add', 'torrents.delete', 'movies.add', 'movies.delete']);
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.calls = [];
  mocks.download = blocked();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return new Response(JSON.stringify({ download: mocks.download }));
    mocks.calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(method === 'POST' ? { ok: true, message: 'Cancelled.' } : { ok: true }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><LinkedDownloadPage /></QueryClientProvider>);
}

describe('a linked download', () => {
  it('shows progress and size from the existing workflow request', async () => {
    mocks.download = blocked({ status: 'DOWNLOADING', progress: { fraction: 0.5, size: 1024 * 1024 } });
    renderPage();
    expect(await screen.findByText('50% · 512 KB of 1 MB')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('wraps the step labels and checkmarks within their mobile grid columns', async () => {
    renderPage();
    const pipeline = await screen.findByRole('list', { name: 'Progress' });
    const label = within(pipeline).getByText('Downloading');
    expect(label.parentElement?.classList.contains('flex-wrap')).toBe(true);
    expect(label.classList.contains('truncate')).toBe(false);
    expect(label.closest('li')?.classList.contains('min-w-0')).toBe(true);
  });

  it('says what went wrong, how far it got, and what to do', async () => {
    renderPage();
    expect((await screen.findAllByText('Needs attention')).length).toBe(2);
    expect(screen.getAllByText('Radarr cannot import it: Sample').length).toBeGreaterThan(0);
    expect(screen.getByText(/Fix it in Radarr/)).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual(['Sent', 'Downloading', 'Importing', 'Imported']);
    expect(screen.getByRole('button', { name: /Open movie/ })).toBeTruthy();
    expect(screen.getByText('Added to the library by this download')).toBeTruthy();
  });

  it.each(['RADARR', 'SONARR'])('shows a title removed by cancel and offers a fresh send by external id for %s', async (service) => {
    const message = 'Cancelled: Night of the Living Dead, which this download had added, was removed.';
    mocks.caps.add('series.add');
    mocks.download = blocked({
      service, status: 'CANCELLED', arrItemId: null, completedAt: now, lastError: null,
      events: [{ at: now, status: 'CANCELLED', message }],
    });
    const { unmount } = renderPage();
    expect(await screen.findByText('Added by this download, no longer in the library')).toBeTruthy();
    expect(screen.queryByText('Added to the library by this download')).toBeNull();
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open movie|Open series/ })).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Send again' }));
    const href = new URL(mocks.push.mock.calls[0][0], 'http://x');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      linkService: service, linkInstance: 'r1', linkExternalId: '10331', linkTitle: 'Night of the Living Dead',
      linkRelease: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP',
    });
    expect(mocks.calls).toEqual([]);

    unmount();
    mocks.download = { ...mocks.download, arrItemId: 15 };
    renderPage();
    expect(await screen.findByText('Added to the library by this download')).toBeTruthy();
    expect(screen.queryByText('Added by this download, no longer in the library')).toBeNull();
  });

  it('cancels with the choices made, enumerating what each one changes', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Cancel download/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete the torrent and its downloaded data from qBittorrent.')).toBeTruthy();
    expect(within(dialog).getByText('Remove Night of the Living Dead from radarr-4k, only if it still has no files.')).toBeTruthy();

    await user.click(within(dialog).getByRole('checkbox', { name: /Blocklist this release/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Remove Night of the Living Dead/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel download' }));

    await waitFor(() => expect(mocks.calls).toEqual([{ url: '/api/manual-downloads/md1/cancel', method: 'POST', body: { removeFromClient: true, blocklist: true, removeTitle: false } }]));
  });

  it('offers only what the user may do', async () => {
    mocks.caps = new Set(['activity.manage']);
    mocks.download = blocked({ createdArrItem: false });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Cancel download/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('checkbox', { name: /Delete the torrent/ })).toBeNull();
    expect(within(dialog).queryByRole('checkbox', { name: /Remove Night of the Living Dead/ })).toBeNull();
    expect(within(dialog).getByText('Leave the torrent in qBittorrent.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send again/ })).toBeNull();
  });

  it('is read-only without activity.manage', async () => {
    mocks.caps = new Set();
    renderPage();
    await screen.findAllByText('Needs attention');
    expect(screen.queryByRole('button', { name: /Cancel download/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Unlink/ })).toBeNull();
  });

  it('offers "Send again" only to someone who may send that release to that library', async () => {
    mocks.download = blocked({ status: 'FAILED', completedAt: now });
    for (const missing of ['movies.add', 'activity.manage', 'torrents.add']) {
      mocks.caps = new Set(['activity.manage', 'torrents.add', 'movies.add', 'series.add']);
      mocks.caps.delete(missing);
      const { unmount } = renderPage();
      await screen.findAllByText('Failed');
      expect(screen.queryByRole('button', { name: /Send again/ }), missing).toBeNull();
      unmount();
    }
  });

  it('offers to send a failed one again with its title and release name, and unlinks', async () => {
    mocks.download = blocked({ status: 'FAILED', lastError: 'Radarr turned the release down: Unknown is not wanted.', completedAt: now });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Send again/ }));
    const href = new URL(mocks.push.mock.calls[0][0], 'http://x');
    expect(href.pathname).toBe('/torrents/add');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      linkService: 'RADARR', linkInstance: 'r1', linkExternalId: '10331', linkTitle: 'Night of the Living Dead',
      linkRelease: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-GRP',
    });
    expect(screen.queryByRole('button', { name: /Cancel download/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Unlink/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/torrents/linked'));
    expect(mocks.calls).toEqual([{ url: '/api/manual-downloads/md1', method: 'DELETE', body: undefined }]);
  });

  it('offers a fallback download waiting on the user its files, a scan, and a cancel without Arr\'s queue', async () => {
    mocks.download = blocked({
      mode: 'QBIT_REVIEWED', status: 'NEEDS_MAPPING', lastError: 'Confirm what the files are. random.mkv: Unknown Movie.',
      files: [
        { id: 'f0', fileIndex: 0, path: 'Film/random.mkv', size: 1000, selected: true, decision: 'PENDING', episodeIds: [], scanned: true, arr: { movie: null, series: null, episodes: [], quality: 'HDTV-720p', languages: [], releaseGroup: null, rejections: ['Unknown Movie'] } },
        { id: 'f1', fileIndex: 1, path: 'Film/skip.mkv', size: 10, selected: false, decision: 'PENDING', episodeIds: [], scanned: false, arr: null },
      ],
    });
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByText('Files: 1 of 2 chosen')).toBeTruthy();
    expect(screen.getByText(/is not sure what some files are/)).toBeTruthy();
    expect(screen.getByText('What to confirm')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Map files/ }));
    expect(mocks.push).toHaveBeenCalledWith('/torrents/linked/md1/map');

    await user.click(screen.getByRole('button', { name: /Scan again/ }));
    await waitFor(() => expect(mocks.calls).toEqual([{ url: '/api/manual-downloads/md1/rescan', method: 'POST', body: undefined }]));

    await user.click(screen.getByRole('button', { name: /Cancel download/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('checkbox', { name: /Blocklist/ })).toBeNull();
    expect(within(dialog).queryByText(/queue/)).toBeNull();
  });
});
