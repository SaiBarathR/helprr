// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetVisibilityProvider } from './widget-visibility-context';
import { useWidgetData } from './use-widget-data';

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
          createElement(
            WidgetVisibilityProvider,
            { active },
            createElement(Probe),
          ),
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
