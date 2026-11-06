// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn().mockResolvedValue(60_000) }));
// The sheet's content renders only for a selected event, so a pass-through drawer shows whether it opened.
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Drawer: Pass, DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass };
});

import { FailedImportsTab } from '../failed-imports-tab';

const DAY = 24 * 60 * 60 * 1000;
const failure = (id: number, title: string, ageMs: number, extra: Record<string, unknown> = {}) => ({
  id, sourceTitle: title, eventType: 'downloadFailed', date: new Date(Date.now() - ageMs).toISOString(),
  quality: { quality: { name: 'WEBDL-1080p' } }, data: {}, source: 'sonarr', instanceId: 'son-1', ...extra,
});

let historyRecords: { source: string; instanceId: string }[] = [];
let historyPartial = false;
let downSource: string | null = null;
let instances: unknown = {};
// Scoped by ?source / ?instanceId, as the history route is.
const fetchMock = vi.fn(async (url: string) => {
  if (url === '/api/instances') return Response.json(instances);
  if (url.startsWith('/api/activity/history?')) {
    const params = new URL(url, 'http://x').searchParams;
    if (downSource && params.get('source') === downSource) return Response.json({ error: 'Failed to fetch history' }, { status: 502 });
    const records = historyRecords.filter((r) => (!params.has('source') || r.source === params.get('source'))
      && (!params.has('instanceId') || r.instanceId === params.get('instanceId')));
    return Response.json({ records, partial: historyPartial });
  }
  if (url.startsWith('/api/activity/queue?')) return Response.json({ records: [] });
  return Response.json({});
});

beforeEach(() => {
  mocks.search = new URLSearchParams();
  historyRecords = [];
  historyPartial = false;
  downSource = null;
  instances = {};
  fetchMock.mockClear();
  window.history.replaceState(null, '', '/activity');
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const historyRequests = () => fetchMock.mock.calls
  .map(([u]) => String(u))
  .filter((u) => u.startsWith('/api/activity/history?'))
  .map((u) => Object.fromEntries(new URL(u, 'http://x').searchParams));

function renderTab(props: { filterBy?: string[]; instanceFilter?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FailedImportsTab filterBy={props.filterBy ?? []} instanceFilter={props.instanceFilter ?? 'all'} />
    </QueryClientProvider>,
  );
}

describe('Needs import tab: Recent failures', () => {
  it('lists the last week of failed downloads above the imports that need a hand', async () => {
    historyRecords = [
      failure(1, 'Kusuriya.no.Hitorigoto.S03E06.1080p-SubsPlease', DAY),
      failure(2, 'Old.Show.S01E01', 8 * DAY),
    ];
    renderTab();

    expect(await screen.findByText('Kusuriya.no.Hitorigoto.S03E06.1080p-SubsPlease')).toBeTruthy();
    expect(screen.getByText('FAILED')).toBeTruthy();
    expect(screen.queryByText('Old.Show.S01E01')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Recent failures', 'Needs import']);
    expect(await screen.findByText('Nothing needs a manual import')).toBeTruthy();
    expect(historyRequests().every((q) => q.eventType === 'failed')).toBe(true);
  });

  it('says so when nothing failed in the last week', async () => {
    renderTab();
    expect(await screen.findByText('No failed downloads in the last 7 days')).toBeTruthy();
  });

  it('opens the same detail sheet as History when a failure is tapped', async () => {
    historyRecords = [failure(1, 'Some.Movie.2026', DAY, { source: 'radarr', instanceId: 'rad-1' })];
    renderTab();
    await userEvent.click(await screen.findByText('Some.Movie.2026'));
    expect(screen.getByText('Information')).toBeTruthy();
  });

  it('opens the failure a push points at with ?focus=<downloadId>, once', async () => {
    mocks.search = new URLSearchParams('tab=failed&source=sonarr&focus=HASH2');
    window.history.replaceState(null, '', '/activity?tab=failed&source=sonarr&focus=HASH2');
    historyRecords = [
      failure(1, 'First.Release', DAY, { downloadId: 'HASH1' }),
      failure(2, 'Pushed.Release', DAY, { downloadId: 'HASH2' }),
    ];
    renderTab({ filterBy: ['sonarr'] });

    await waitFor(() => expect(screen.getByText('Information')).toBeTruthy());
    // The sheet's title is the pushed release, which now shows in the row and the sheet.
    expect(screen.getAllByText('Pushed.Release')).toHaveLength(2);
    expect(screen.getAllByText('First.Release')).toHaveLength(1);
    // Handled: coming back to the tab must not open it again.
    expect(window.location.search).toBe('?tab=failed&source=sonarr');
  });

  it('opens nothing when the pushed failure is not listed', async () => {
    mocks.search = new URLSearchParams('tab=failed&source=sonarr&focus=GONE');
    window.history.replaceState(null, '', '/activity?tab=failed&source=sonarr&focus=GONE');
    historyRecords = [failure(1, 'Other.Release', DAY, { downloadId: 'HASH1' })];
    renderTab({ filterBy: ['sonarr'] });
    await screen.findByText('Other.Release');
    await waitFor(() => expect(window.location.search).toBe('?tab=failed&source=sonarr'));
    expect(screen.queryByText('Information')).toBeNull();
  });

  it("still lists one app's failures when another app is down", async () => {
    downSource = 'radarr';
    historyRecords = [failure(1, 'Show.S01E01', DAY)];
    renderTab();
    expect(await screen.findByText('Show.S01E01')).toBeTruthy();
    expect(screen.getByText(/this list may be incomplete/)).toBeTruthy();
  });

  it('says Lidarr is left out of the unfiltered list when it is set up', async () => {
    instances = [{ id: 'lid-1', label: 'main', type: 'LIDARR' }];
    renderTab();
    expect(await screen.findByText('Lidarr failures show when Lidarr is chosen in the filter.')).toBeTruthy();
  });

  it('asks Sonarr and Radarr by default, and Lidarr or one instance only when chosen', async () => {
    const { unmount } = renderTab();
    await screen.findByText('No failed downloads in the last 7 days');
    expect(historyRequests().map((q) => q.source)).toEqual(['sonarr', 'radarr']);
    unmount();

    fetchMock.mockClear();
    const lidarr = renderTab({ filterBy: ['lidarr'] });
    await screen.findByText('No failed downloads in the last 7 days');
    expect(historyRequests().map((q) => q.source)).toEqual(['lidarr']);
    lidarr.unmount();

    fetchMock.mockClear();
    renderTab({ instanceFilter: 'lid-1' });
    await screen.findByText('No failed downloads in the last 7 days');
    expect(historyRequests()).toEqual([{ page: '1', pageSize: '50', eventType: 'failed', instanceId: 'lid-1' }]);
  });

  it('says the list may be incomplete when an instance could not be read', async () => {
    historyPartial = true;
    renderTab();
    expect(await screen.findByText(/this list may be incomplete/)).toBeTruthy();
  });
});
