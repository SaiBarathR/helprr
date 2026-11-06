// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canManage: true,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => cap !== 'activity.manage' || mocks.canManage,
}));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeActions: () => ({ adjustBadge: vi.fn() }) }));
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

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  void init;
  if (url.startsWith('/api/activity/queue?')) return Response.json({ records: QUEUE, totalRecords: QUEUE.length });
  return Response.json({ success: true });
});

beforeEach(() => {
  mocks.canManage = true;
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
  fetchMock.mockClear();
  window.sessionStorage.clear();
  resetRouteViewStateForTests();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QueueTab sortBy="title" sortDirection="asc" filterBy={[]} instanceFilter="all" onCountChange={() => {}} />
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
  });

  it('says when an instance could not remove its downloads', async () => {
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
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Some downloads could not be removed'));
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
