// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateInstances } from '@/lib/query-invalidation';
import {
  useConfiguredWidgetServices,
  WidgetAvailabilityProvider,
} from './widget-availability-context';

let root: Root;
let queryClient: QueryClient;

function Probe() {
  const services = [...useConfiguredWidgetServices()].sort();
  return createElement('div', null, services.join(','));
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

describe('WidgetAvailabilityProvider', () => {
  it('uses the fresh server snapshot and refreshes after a connection mutation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ services: ['JELLYFIN', 'QBITTORRENT'] })));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            WidgetAvailabilityProvider,
            { services: ['JELLYFIN'] },
            createElement(Probe),
          ),
        ),
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe('JELLYFIN');

    await act(async () => {
      invalidateInstances(queryClient);
      await vi.waitFor(() =>
        expect(document.body.textContent).toBe('JELLYFIN,QBITTORRENT')
      );
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
