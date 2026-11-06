// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
import { fetchAppSettings } from '@/lib/app-settings-fetch';
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
const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).split('?')[0] === path).length;

let queryClient: QueryClient;
const wrap = (children: ReactNode) =>
  render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Responses resolve on a later tick, so every consumer mounts while the first request is in flight.
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const body = BODIES[String(input).split('?')[0]] ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
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

  // Nothing is kept once the request settles: the next read goes to the server.
  await fetchAppSettings();
  expect(callsTo('/api/settings')).toBe(2);
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
