// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canManage: true,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  adjustBadge: vi.fn(),
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => cap !== 'activity.manage' || mocks.canManage,
}));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeActions: () => ({ adjustBadge: mocks.adjustBadge }) }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn().mockResolvedValue(60_000) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
// The detail sheet's content renders only for a selected item, so a pass-through drawer shows it inline.
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Drawer: Pass, DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass };
});

import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import { QueueTab } from '../queue-tab';

const base = { size: 100, sizeleft: 50, trackedDownloadState: 'downloading', statusMessages: [] };
const QUEUE = [
  { ...base, id: 1, title: 'Show.S01E01', source: 'sonarr', instanceId: 'son-1', downloadId: 'a', status: 'downloading' },
  // A season pack: two records of one download.
  { ...base, id: 2, title: 'Show.S02', source: 'sonarr', instanceId: 'son-1', downloadId: 'p', status: 'downloading', seasonNumber: 2, episodeNumber: 1 },
  { ...base, id: 3, title: 'Show.S02', source: 'sonarr', instanceId: 'son-1', downloadId: 'p', status: 'downloading', seasonNumber: 2, episodeNumber: 2 },
  { ...base, id: 4, title: 'Movie.2026', source: 'radarr', instanceId: 'rad-1', downloadId: 'b', status: 'downloading' },
  // Held back by a delay profile: no download yet.
  { ...base, id: 5, title: 'Movie.Delayed', source: 'radarr', instanceId: 'rad-2', downloadId: '', status: 'delay', trackedDownloadState: undefined },
];

const defaultFetch = async (url: string, init?: RequestInit) => {
  void init;
  if (url.startsWith('/api/activity/queue?')) return Response.json({ records: QUEUE, totalRecords: QUEUE.length });
  return Response.json({ success: true });
};
const fetchMock = vi.fn(defaultFetch);

beforeEach(() => {
  mocks.canManage = true;
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
  mocks.toast.warning.mockClear();
  mocks.adjustBadge.mockClear();
  fetchMock.mockClear().mockImplementation(defaultFetch);
  window.sessionStorage.clear();
  resetRouteViewStateForTests();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QueueTab sortBy="title" sortDirection="asc" filterBy={[]} instanceFilter="all" />
    </QueryClientProvider>,
  );
}

const mutations = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

describe('Queue tab: grab now', () => {
  it('sends a delayed release to the download client on its own instance', async () => {
    renderTab();
    await userEvent.click(await screen.findByText('Movie.Delayed'));
    await userEvent.click(screen.getByRole('button', { name: 'Grab now' }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Sent to the download client'));
    const [[url, init]] = mutations();
    expect(url).toBe('/api/activity/queue/5/grab');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ source: 'radarr', instanceId: 'rad-2' });
  });

  it('offers no grab for a download already in the client', async () => {
    renderTab();
    await userEvent.click(await screen.findByText('Movie.2026'));
    expect(screen.queryByRole('button', { name: 'Grab now' })).toBeNull();
  });
});

describe('Queue tab: bulk remove', () => {
  it('puts Select in the task-count row, not a row of its own', async () => {
    renderTab();
    const select = await screen.findByRole('button', { name: /Select/ });
    expect(select.parentElement?.textContent).toMatch(/^\d+ Tasks?Select$/);
    expect(select.className).toContain('touch-target');
  });

  it('removes the selected downloads with one request per instance, a pack with every record', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Select/ }));
    await userEvent.click(screen.getByText('Show.S01E01'));
    await userEvent.click(screen.getByText(/Season 2|Show\.S02/));
    await userEvent.click(screen.getByText('Movie.2026'));
    expect(screen.getByText('3 selected')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Are you sure you want to remove 3 downloads from the queue?')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Removed 3 downloads from queue'));
    const bodies = mutations().map(([url, init]) => {
      expect(url).toBe('/api/activity/queue');
      expect(init?.method).toBe('DELETE');
      return JSON.parse(String(init?.body));
    });
    const options = { removeFromClient: true, changeCategory: false, blocklist: false, skipRedownload: false };
    expect(bodies).toHaveLength(2);
    expect(bodies).toContainEqual({ source: 'sonarr', instanceId: 'son-1', ids: expect.arrayContaining([1, 2, 3]), ...options });
    expect(bodies).toContainEqual({ source: 'radarr', instanceId: 'rad-1', ids: [4], ...options });
    expect(bodies.find((b) => b.source === 'sonarr').ids).toHaveLength(3);
    expect(mocks.adjustBadge).toHaveBeenCalledWith('activity', -4, -0);
  });

  it('says when an instance could not remove its downloads and counts only the instance that did', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/activity/queue?')) return Response.json({ records: QUEUE, totalRecords: QUEUE.length });
      if (init?.method === 'DELETE' && String(init.body).includes('rad-1')) return Response.json({ error: 'no' }, { status: 500 });
      return Response.json({ success: true });
    });
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Select/ }));
    await userEvent.click(screen.getByText('Show.S01E01'));
    await userEvent.click(screen.getByText('Movie.2026'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'Some downloads could not be removed. They may have been partly removed.',
    ));
    expect(mocks.adjustBadge).toHaveBeenCalledTimes(1);
    expect(mocks.adjustBadge).toHaveBeenCalledWith('activity', -1, -0);
  });
});

describe('Queue tab: bulk grab', () => {
  // Two more held-back releases, on two instances.
  const WITH_PENDING = [
    ...QUEUE,
    { ...base, id: 6, title: 'Show.Delayed', source: 'sonarr', instanceId: 'son-1', downloadId: '', status: 'delay', trackedDownloadState: undefined },
    { ...base, id: 7, title: 'Movie.NoClient', source: 'radarr', instanceId: 'rad-2', downloadId: '', status: 'downloadClientUnavailable', trackedDownloadState: undefined },
  ];
  function answer(grab: (body: { instanceId: string; ids: number[] }) => Response) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/activity/queue?')) return Response.json({ records: WITH_PENDING, totalRecords: WITH_PENDING.length });
      if (url === '/api/activity/queue/grab') return grab(JSON.parse(String(init?.body)));
      return Response.json({ success: true });
    });
  }
  const grabBodies = () => mutations()
    .filter(([url]) => url === '/api/activity/queue/grab')
    .map(([, init]) => JSON.parse(String(init?.body)));

  it('offers Grab only while the selection holds a pending release', async () => {
    answer(() => Response.json({}));
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Select/ }));
    await userEvent.click(screen.getByText('Movie.2026'));
    expect(screen.queryByRole('button', { name: /^Grab/ })).toBeNull();
    await userEvent.click(screen.getByText('Movie.Delayed'));
    expect(screen.getByRole('button', { name: 'Grab 1 pending release now' })).toBeTruthy();
  });

  it('sends the pending ones, one request per instance, and counts the skipped ones', async () => {
    answer(({ ids }) => Response.json({ grabbed: ids, notGrabbed: [], unknown: [], skipped: [] }));
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Select/ }));
    for (const title of ['Movie.Delayed', 'Movie.NoClient', 'Show.Delayed', 'Movie.2026']) {
      await userEvent.click(screen.getByText(title));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Grab 3 pending releases now' }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(
      'Sent 3 releases to the download client. 1 not pending, skipped.',
    ));
    const bodies = grabBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies).toContainEqual({ source: 'radarr', instanceId: 'rad-2', ids: [5, 7] });
    expect(bodies).toContainEqual({ source: 'sonarr', instanceId: 'son-1', ids: [6] });
    // Nothing was removed on the way.
    expect(mutations().every(([, init]) => init?.method === 'POST')).toBe(true);
    // Done: selection mode ends.
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('says truthfully what each instance did', async () => {
    answer(({ instanceId, ids }) => (instanceId === 'son-1'
      ? Response.json({ error: 'down' }, { status: 502 })
      : Response.json({ grabbed: [ids[0]], notGrabbed: [], unknown: [], skipped: ids.slice(1) })));
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Select/ }));
    for (const title of ['Movie.Delayed', 'Movie.NoClient', 'Show.Delayed']) {
      await userEvent.click(screen.getByText(title));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Grab 3 pending releases now' }));
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Sent 1 of 2 releases. 1 could not be sent. 1 not pending, skipped.',
    ));
  });
});

describe('Queue tab without activity.manage', () => {
  it('offers neither selection nor grab', async () => {
    mocks.canManage = false;
    renderTab();
    await userEvent.click(await screen.findByText('Movie.Delayed'));
    expect(screen.queryByRole('button', { name: /Select/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Grab now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('Queue tab: instance chips', () => {
  it("names a download's instance when its app has several, and keeps the app chip otherwise", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/activity/queue?')) return Response.json({ records: QUEUE, totalRecords: QUEUE.length });
      if (url === '/api/instances') {
        return Response.json([
          { id: 'rad-1', label: 'main', type: 'RADARR' },
          { id: 'rad-2', label: 'radarr-anime', type: 'RADARR' },
          { id: 'son-1', label: 'SONARR', type: 'SONARR' },
        ]);
      }
      return Response.json({ success: true });
    });
    renderTab();
    const card = (title: string) => screen.getByText(title).parentElement as HTMLElement;
    await waitFor(() => expect(within(card('Movie.2026')).getByText('main (Radarr)')).toBeTruthy());
    expect(within(card('Movie.Delayed')).getByText('radarr-anime')).toBeTruthy();
    // Its app's name, written as the instance chips write it (not "sonarr").
    expect(within(card('Show.S01E01')).getByText('Sonarr')).toBeTruthy();
  });
});
