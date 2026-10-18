// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverDetail } from '@/types';

const mocks = vi.hoisted(() => ({ canAdd: true }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ role: 'member', seerrConfigured: false, capabilities: {} }),
  hasCapability: (_me: unknown, cap: string) => (cap === 'movies.add' || cap === 'series.add' ? mocks.canAdd : false),
}));
vi.mock('@/components/seerr/requested-media-provider', () => ({ useRequestedMedia: () => ({ isRequested: () => false }) }));
vi.mock('@/components/watchlist/watchlist-button', () => ({ WatchlistButton: () => null }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertButton: () => null }));
vi.mock('@/components/discover/request-media-button', () => ({ RequestMediaButton: () => null }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { DiscoverAddButton, useDiscoverAddController } from './discover-add-button';

const INSTANCES = [
  { id: 'rad-a', label: 'RADARR', type: 'RADARR' },
  { id: 'rad-b', label: 'radarr-anime', type: 'RADARR' },
  { id: 'son-a', label: 'SONARR', type: 'SONARR' },
];

function movie(held: Array<{ instanceId: string; instanceLabel: string; id: number }>): DiscoverDetail {
  return {
    mediaType: 'movie', tmdbId: 389, title: '12 Angry Men', year: 1957, posterPath: null, overview: '', rating: 8,
    addTarget: { exists: true, service: 'radarr', id: held[0]?.id, instanceId: held[0]?.instanceId },
    library: { instances: held },
  } as unknown as DiscoverDetail;
}

function Harness({ detail }: { detail: DiscoverDetail }) {
  const controller = useDiscoverAddController(detail);
  return <DiscoverAddButton detail={detail} controller={controller} />;
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
async function render(detail: DiscoverDetail, instances = INSTANCES) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(instances)));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}><Harness detail={detail} /></QueryClientProvider>));
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}
const links = () => [...container.querySelectorAll('a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.canAdd = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('DiscoverAddButton across instances', () => {
  it('offers the one instance that lacks the title, preselected on the add page', async () => {
    await render(movie([{ instanceId: 'rad-a', instanceLabel: 'RADARR', id: 7 }]));
    expect(links()).toContainEqual(['Add to radarr-anime', '/movies/add?term=12+Angry+Men&tmdbId=389&instance=rad-b']);
    expect(container.textContent).toContain('Open in Radarr');
  });

  it('lists several missing instances under "Add to another"', async () => {
    await render(movie([{ instanceId: 'rad-a', instanceLabel: 'RADARR', id: 7 }]), [...INSTANCES, { id: 'rad-c', label: 'radarr-4k', type: 'RADARR' }]);
    expect(container.textContent).toContain('Add to another');
    expect(container.textContent).not.toContain('Add to radarr-anime');
  });

  it('offers nothing to add when every instance holds the title', async () => {
    await render(movie([
      { instanceId: 'rad-a', instanceLabel: 'RADARR', id: 7 },
      { instanceId: 'rad-b', instanceLabel: 'radarr-anime', id: 3 },
    ]));
    expect(container.textContent).not.toMatch(/Add to/);
  });

  it('offers nothing, and asks for nothing, without the add capability', async () => {
    mocks.canAdd = false;
    await render(movie([{ instanceId: 'rad-a', instanceLabel: 'RADARR', id: 7 }]));
    expect(container.textContent).not.toMatch(/Add to/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers nothing when the holder\'s instance is unknown', async () => {
    await render(movie([{ instanceId: '', instanceLabel: '', id: 7 }]));
    expect(container.textContent).not.toMatch(/Add to/);
  });

  it('carries the series ids and the instance for a show', async () => {
    const show = {
      ...movie([{ instanceId: 'son-a', instanceLabel: 'SONARR', id: 4 }]),
      mediaType: 'tv', tvdbId: 81189, title: 'Breaking Bad',
      addTarget: { exists: true, service: 'sonarr', id: 4, instanceId: 'son-a' },
    } as unknown as DiscoverDetail;
    await render(show, [...INSTANCES, { id: 'son-b', label: 'sonarr-anime', type: 'SONARR' }]);
    expect(links()).toContainEqual(['Add to sonarr-anime', '/series/add?term=Breaking+Bad&tmdbId=389&tvdbId=81189&seriesType=standard&instance=son-b']);
  });
});
