// @vitest-environment jsdom

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetVisibilityProvider } from './widget-visibility-context';
import { useWidgetData, widgetErrorText, widgetUnavailable } from './use-widget-data';
import { ApiError } from '@/lib/query-fetch';

let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe('useWidgetData visibility', () => {
  it('aborts an obsolete transfer only after its last consumer unmounts', async () => {
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn((received?: AbortSignal) => {
      signal = received;
      return new Promise<string>(() => {});
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Probe() {
      useWidgetData({ fetchFn, refreshInterval: 60_000, cacheKey: 'cancel-transfer' });
      return null;
    }
    const render = (count: number) => root.render(createElement(QueryClientProvider, { client: queryClient },
      Array.from({ length: count }, (_, index) => createElement(Probe, { key: index }))));
    await act(async () => render(2));
    expect(fetchFn).toHaveBeenCalledOnce();
    await act(async () => render(1));
    expect(signal?.aborted).toBe(false);
    await act(async () => render(0));
    expect(signal?.aborted).toBe(true);
    queryClient.clear();
  });

  it('reuses recently loaded dashboard data on return without another download', async () => {
    const fetchFn = vi.fn(async () => 'cached dashboard');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Probe() {
      const result = useWidgetData({ fetchFn, refreshInterval: 60_000, cacheKey: 'return-visit' });
      return createElement('span', null, result.data ?? 'empty');
    }
    const render = (visible: boolean) => root.render(createElement(QueryClientProvider, { client: queryClient }, visible ? createElement(Probe) : null));
    await act(async () => render(true));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => render(false));
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    await act(async () => render(true));
    expect(document.body.textContent).toContain('cached dashboard');
    expect(fetchFn).toHaveBeenCalledOnce();
    await act(async () => render(false));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    await act(async () => render(true));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });

  it('defers the first request, pauses polling offscreen, and retains cached data', async () => {
    const fetchFn = vi.fn(async () => fetchFn.mock.calls.length);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function Probe() {
      const result = useWidgetData({
        fetchFn,
        refreshInterval: 100,
        cacheKey: 'visibility-test',
      });
      return createElement('div', null, result.data ?? 'empty');
    }

    function render(active: boolean) {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          <WidgetVisibilityProvider active={active}>
            <Probe />
          </WidgetVisibilityProvider>,
        ),
      );
    }

    await act(async () => render(false));
    expect(fetchFn).not.toHaveBeenCalled();

    await act(async () => render(true));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('1');

    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);

    await act(async () => render(false));
    const pausedCount = fetchFn.mock.calls.length;
    const cachedText = document.body.textContent;
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(fetchFn).toHaveBeenCalledTimes(pausedCount);
    expect(document.body.textContent).toBe(cachedText);

    await act(async () => render(true));
    expect(fetchFn.mock.calls.length).toBeGreaterThan(pausedCount);
    queryClient.clear();
  });

  it('coalesces closely mounted consumers that share an exact resource key', async () => {
    const fetchFn = vi.fn(async () => 'shared');
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function Probe() {
      const result = useWidgetData({
        fetchFn,
        refreshInterval: 10_000,
        cacheKey: 'shared-resource',
        staleTime: 10_000,
      });
      return createElement('span', null, result.data ?? 'empty');
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe),
        ),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(fetchFn).toHaveBeenCalledOnce();
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe),
          createElement(Probe),
        ),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(document.body.textContent).toBe('sharedshared');
    queryClient.clear();
  });
});

describe('useWidgetData offline', () => {
  it('asks once with no saved copy, then waits for the network instead of polling', async () => {
    // The app retries a failed read once; offline, that retry waits for the network.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } });
    const fetchFn = vi.fn(async () => {
      if (!onlineManager.isOnline()) throw new TypeError('Failed to fetch');
      return 'data';
    });
    function Probe() {
      const { offline, data } = useWidgetData({ fetchFn, refreshInterval: 15_000, cacheKey: 'offline-probe' });
      return `${offline}:${data}`;
    }
    onlineManager.setOnline(false);
    try {
      await act(async () => root.render(
        <QueryClientProvider client={queryClient}>
          <WidgetVisibilityProvider active><Probe /></WidgetVisibilityProvider>
        </QueryClientProvider>,
      ));
      await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(document.body.textContent).toBe('true:null');
    } finally {
      onlineManager.setOnline(true);
    }
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toBe('false:data');
    queryClient.clear();
  });

  it("still asks once while offline, so the worker's saved copy can answer", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchFn = vi.fn(async () => 'saved');
    function Probe() {
      const { offline, data } = useWidgetData({ fetchFn, refreshInterval: 60_000, cacheKey: 'offline-first' });
      return `${offline}:${data}`;
    }
    onlineManager.setOnline(false);
    try {
      await act(async () => root.render(
        <QueryClientProvider client={queryClient}>
          <WidgetVisibilityProvider active><Probe /></WidgetVisibilityProvider>
        </QueryClientProvider>,
      ));
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(document.body.textContent).toBe('false:saved');
    } finally {
      onlineManager.setOnline(true);
    }
    queryClient.clear();
  });
});

describe('widgetUnavailable', () => {
  const base = { isError: false, error: null, fetchStatus: 'idle' as const, data: 'old' };
  it('hides data from before a load that got no answer', () => {
    expect(widgetUnavailable({ ...base, isError: true, error: new TypeError('Failed to fetch') })).toBe('unreachable');
    expect(widgetUnavailable({ ...base, fetchStatus: 'paused' })).toBe('offline');
  });
  it("leaves a server's error answer and a working load to the widget", () => {
    expect(widgetUnavailable({ ...base, isError: true, error: new ApiError(502, 'Bad gateway') })).toBeNull();
    expect(widgetUnavailable(base)).toBeNull();
    expect(widgetUnavailable({ ...base, fetchStatus: 'fetching' })).toBeNull();
  });
});

describe('widgetErrorText', () => {
  it('says the server cannot be reached for a network failure, not the browser words', () => {
    const swError = new TypeError('FetchEvent.respondWith received an error: no-response: no-response :: [{"url":"https://x/api/seerr/requests"}]');
    expect(widgetErrorText(swError)).toBe('Can’t reach Helprr right now.');
    expect(widgetErrorText(new TypeError('Failed to fetch'))).toBe('Can’t reach Helprr right now.');
  });

  it("keeps a server's own message", () => {
    expect(widgetErrorText(new Error('Seerr is not configured'))).toBe('Seerr is not configured');
    expect(widgetErrorText('odd')).toBe('Failed to fetch');
  });
});
