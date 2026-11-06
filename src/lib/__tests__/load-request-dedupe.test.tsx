// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ me: { role: 'admin' } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => mocks.me }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }));

import { ClientLogCapture } from '@/components/client-log-capture';
import { DiscoverLayoutHydrator } from '@/components/discover-layout-hydrator';
import { AnilistStatusPanel } from '@/components/anime/anilist-status-panel';
import { useAnilistContextMenu } from '@/components/anime/anilist-context-menu';
import { TwitchConnectionCard } from '@/components/settings/twitch-connection-card';
import { YoutubeConnectionCard } from '@/components/settings/youtube-connection-card';
import { useDiscoverHome } from '@/app/(app)/discover/_components/use-discover-home';
import { fetchAppSettings, forgetAppSettingsFetch } from '@/lib/app-settings-fetch';
import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useAppSettings } from '@/lib/hooks/use-app-settings';
import { useUIStore } from '@/lib/store';

const LAYOUT = { sections: [{ id: 'trending', type: 'builtin', label: 'Trending', enabled: true }] };
const BODIES: Record<string, unknown> = {
  '/api/settings': { activityRefreshIntervalSecs: 7, logEnabled: true, logClientConsoleEnabled: true },
  '/api/services': [{ type: 'TWITCH', externalUrl: 'client-id', apiKey: '********' }, { type: 'YOUTUBE' }],
  '/api/settings/discover-layout': LAYOUT,
  '/api/anilist/viewer': { configured: true, connected: false, requiresReauth: false },
};

let fetchMock: ReturnType<typeof vi.fn>;
// GETs only, so a settings save is not counted as a read.
const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).split('?')[0] === path && (init?.method ?? 'GET') === 'GET',
  ).length;
let serverSettings: Record<string, unknown>;

let queryClient: QueryClient;
const wrap = (children: ReactNode) =>
  render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);

beforeEach(() => {
  forgetAppSettingsFetch();
  // Only Date is faked, so the reuse windows can be stepped past.
  vi.useFakeTimers({ toFake: ['Date'] });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  serverSettings = { ...(BODIES['/api/settings'] as Record<string, unknown>) };
  // Responses resolve on a later tick, so every consumer mounts while the first request is in flight.
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const path = String(input).split('?')[0];
    if (path === '/api/settings' && init?.method === 'PUT') Object.assign(serverSettings, JSON.parse(String(init.body)));
    const body = path === '/api/settings' ? serverSettings : (BODIES[path] ?? {});
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  queryClient.clear();
});

function SettingsConsumer() {
  const { settings } = useAppSettings();
  return <p>{settings ? `activity ${settings.activityRefreshIntervalSecs}` : 'loading'}</p>;
}

it('loads /api/settings once for the log capture, the settings query and the refresh interval', async () => {
  const interval = getRefreshIntervalMs('activityRefreshIntervalSecs');
  render(<ClientLogCapture />);
  wrap(<SettingsConsumer />);

  expect(await interval).toBe(7000);
  expect(await screen.findByText('activity 7')).toBeTruthy();
  expect(callsTo('/api/settings')).toBe(1);
});

it('does not reuse a failed /api/settings read', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(fetchAppSettings()).rejects.toThrow();
  expect(await getRefreshIntervalMs('activityRefreshIntervalSecs')).toBe(7000);
  expect(callsTo('/api/settings')).toBe(2);
});

it('reuses a just-finished /api/settings read for a later consumer, and reads again after a save or a few seconds', async () => {
  // The layout's log capture loads first and its request finishes...
  render(<ClientLogCapture />);
  await waitFor(() => expect(callsTo('/api/settings')).toBe(1));
  await fetchAppSettings();

  // ...then the page's readers mount: they reuse that answer.
  expect(await getRefreshIntervalMs('activityRefreshIntervalSecs')).toBe(7000);
  wrap(<SettingsConsumer />);
  expect(await screen.findByText('activity 7')).toBeTruthy();
  expect(callsTo('/api/settings')).toBe(1);

  // A save is visible to the very next read.
  const { result } = renderHook(() => useAppSettings(), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  await act(async () => {
    await result.current.update({ activityRefreshIntervalSecs: 9 }, { toast: false });
  });
  expect(await getRefreshIntervalMs('activityRefreshIntervalSecs')).toBe(9000);
  expect(callsTo('/api/settings')).toBe(2);

  // Reused for a few seconds only.
  expect(await getRefreshIntervalMs('activityRefreshIntervalSecs')).toBe(9000);
  expect(callsTo('/api/settings')).toBe(2);
  vi.setSystemTime(Date.now() + 3_001);
  await fetchAppSettings();
  expect(callsTo('/api/settings')).toBe(3);
});

it('loads /api/services once for the Instances list and both connection cards', async () => {
  function InstancesList() {
    // Mirrors the Instances page query.
    const { data } = useQueryInstances();
    return <p>{data ? `${data.length} connections` : 'loading'}</p>;
  }
  wrap(<><InstancesList /><TwitchConnectionCard /><YoutubeConnectionCard /></>);

  expect(await screen.findByText('2 connections')).toBeTruthy();
  await waitFor(() => expect(screen.getAllByText('Connected')).toHaveLength(2));
  expect(callsTo('/api/services')).toBe(1);
});

it('loads the Discover layout once for the app hydrator and the Discover home', async () => {
  useUIStore.getState().setDiscoverLayout(null);
  function DiscoverHome() {
    const { layoutConfig } = useDiscoverHome('all', 10);
    return <p>{layoutConfig ? 'layout ready' : 'loading'}</p>;
  }
  wrap(<><DiscoverLayoutHydrator /><DiscoverHome /></>);

  expect(await screen.findByText('layout ready')).toBeTruthy();
  await waitFor(() => expect(useUIStore.getState().discoverLayout?.sections[0]?.id).toBe('trending'));
  expect(callsTo('/api/settings/discover-layout')).toBe(1);
});

it('reuses the hydrator\'s just-finished Discover layout for the Discover home, and refetches on a later open', async () => {
  useUIStore.getState().setDiscoverLayout(null);
  function DiscoverHome() {
    const { layoutConfig } = useDiscoverHome('all', 10);
    return <p>{layoutConfig ? 'layout ready' : 'loading'}</p>;
  }
  wrap(<DiscoverLayoutHydrator />);
  await waitFor(() => expect(useUIStore.getState().discoverLayout?.sections[0]?.id).toBe('trending'));

  // Opened on the same load, after the hydrator's request finished.
  const first = wrap(<DiscoverHome />);
  expect(await screen.findByText('layout ready')).toBeTruthy();
  expect(callsTo('/api/settings/discover-layout')).toBe(1);
  first.unmount();

  // A later open reads the layout again (it can change on another device).
  vi.setSystemTime(Date.now() + 5_001);
  wrap(<DiscoverHome />);
  await waitFor(() => expect(callsTo('/api/settings/discover-layout')).toBe(2));
});

it('loads the AniList viewer once for the status panel and the context menu', async () => {
  function ContextMenu() {
    useAnilistContextMenu();
    return null;
  }
  wrap(<><ContextMenu /><AnilistStatusPanel mediaId={1} mediaTitle="Show" mediaType="ANIME" /></>);

  // Not connected: the panel links to settings once the viewer has loaded.
  expect(await screen.findByRole('link')).toBeTruthy();
  expect(callsTo('/api/anilist/viewer')).toBe(1);
});

// The Instances page's own query, copied so the test does not render the page.
function useQueryInstances() {
  return useQuery({
    queryKey: queryKeys.instances(),
    queryFn: jsonFetcher<Array<{ type: string }>>('/api/services'),
    select: ensureArray,
  });
}
