// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionProvider, type MePayload } from '@/components/permission-provider';
import {
  RequestedMediaProvider,
  useRequestedMedia,
} from '@/components/seerr/requested-media-provider';
import {
  WatchStatusProvider,
  useWatchLookup,
  useWatchMapReady,
  useWatchStatus,
} from '@/components/jellyfin/watch-status-provider';
import {
  useDataDemand,
  useDataDemandRegistry,
  type RegisterDataDemand,
} from '@/lib/hooks/use-data-demand';

const me: MePayload = {
  id: 'user-1',
  name: 'Admin',
  role: 'admin',
  template: 'admin',
  capabilities: {},
  seerrConfigured: true,
  tmdbConfigured: true,
  seerrUserId: 'seerr-1',
  jellyfinLinked: true,
  customHeadersEnabled: false,
};

let root: Root;
let queryClient: QueryClient;

function AppProviders({ children }: { children: React.ReactNode }) {
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      PermissionProvider,
      { value: me },
      createElement(
        RequestedMediaProvider,
        null,
        createElement(WatchStatusProvider, null, children),
      ),
    ),
  );
}

function DataConsumer({
  watch,
  requests,
}: {
  watch: boolean;
  requests: boolean;
}) {
  const lookup = useWatchLookup(watch);
  const watchReady = useWatchMapReady(watch);
  const { setWatched } = useWatchStatus();
  const requestedMedia = useRequestedMedia(requests);
  const status = lookup({ kind: 'movie', tmdbId: 1 });

  return createElement(
    'div',
    null,
    createElement(
      'span',
      { 'data-watch': true },
      watchReady ? (status?.played ? 'watched' : 'unwatched') : 'loading',
    ),
    createElement(
      'span',
      { 'data-request': true },
      requestedMedia.isRequested('movie', 1) ? 'requested' : 'available',
    ),
    createElement('button', {
      'data-watch-button': true,
      onClick: () => status && setWatched({
          jellyfinItemId: status.jellyfinItemId,
          played: true,
        }),
    }),
    createElement('button', {
      'data-request-button': true,
      onClick: () => requestedMedia.markRequested('movie', 1),
    }),
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe('app-shell data providers', () => {
  it('makes no shell data requests without eligible consumers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            AppProviders,
            null,
            createElement(DataConsumer, { watch: false, requests: false }),
          ),
        ),
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-watch]')?.textContent).toBe('unwatched');
  });

  it('loads demanded data once and preserves optimistic updates', async () => {
    let resolveWatchWrite: ((response: Response) => void) | undefined;
    const watchWrite = new Promise<Response>((resolve) => {
      resolveWatchWrite = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') return watchWrite;
      if (url.includes('/api/jellyfin/watch-status')) {
        return new Response(JSON.stringify({
          linked: true,
          keys: { 'movie:tmdb:1': 0 },
          items: [{
            kind: 'movie',
            jellyfinItemId: 'movie-1',
            played: false,
            playedPercentage: 0,
          }],
        }));
      }
      return new Response(JSON.stringify({ results: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            AppProviders,
            null,
            createElement(DataConsumer, { watch: true, requests: true }),
          ),
        ),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-watch]')?.textContent).toBe('unwatched');
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
    });

    await act(async () => {
      (document.querySelector('[data-watch-button]') as HTMLButtonElement).click();
      (document.querySelector('[data-request-button]') as HTMLButtonElement).click();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-watch]')?.textContent).toBe('watched');
        expect(document.querySelector('[data-request]')?.textContent).toBe('requested');
      });
    });
    await act(async () => {
      resolveWatchWrite?.(new Response(null, { status: 200 }));
    });
  });
});

function DemandConsumer({
  enabled,
  register,
}: {
  enabled: boolean;
  register: RegisterDataDemand;
}) {
  useDataDemand(register, enabled);
  return null;
}

function DemandRegistryProbe({ consumers }: { consumers: number }) {
  const { hasDemand, registerDemand } = useDataDemandRegistry();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-demand': true }, String(hasDemand)),
    ...Array.from({ length: consumers }, (_, index) => createElement(
      DemandConsumer,
      { key: index, enabled: true, register: registerDemand },
    )),
  );
}

describe('data demand registry', () => {
  it('survives Strict Mode and stays active until the final consumer leaves', async () => {
    const render = async (consumers: number) => {
      await act(async () => {
        root.render(
          createElement(
            StrictMode,
            null,
            createElement(DemandRegistryProbe, { consumers }),
          ),
        );
      });
      await act(async () => {
        await vi.waitFor(() => {
          expect(document.querySelector('[data-demand]')?.textContent)
            .toBe(consumers > 0 ? 'true' : 'false');
        });
      });
    };

    await render(2);
    await render(1);
    await render(0);
  });
});
