// @vitest-environment jsdom

import {
  act,
  createElement,
  StrictMode,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  clearBrowserCaches: vi.fn(),
  clearQueryClient: vi.fn(),
  invalidateQueries: vi.fn(),
  invalidateExternalUrls: vi.fn(),
  subscribe: vi.fn(),
  subscribeSessionEnd: vi.fn(),
  holdLoginRedirect: vi.fn(),
  routerRefresh: vi.fn(),
  refreshAfterReconnect: vi.fn(async () => {}),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock('@/lib/reconnect-queries', () => ({ refreshAfterReconnect: mocks.refreshAfterReconnect }));

vi.mock('@tanstack/react-query', () => ({
  QueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtools: () => null,
}));
vi.mock('@/lib/query-client', () => ({
  holdLoginRedirect: mocks.holdLoginRedirect,
  getQueryClient: () => ({
    cancelQueries: mocks.cancelQueries,
    clear: mocks.clearQueryClient,
    invalidateQueries: mocks.invalidateQueries,
  }),
}));
vi.mock('@/lib/hooks/use-external-urls', () => ({
  invalidateExternalUrls: mocks.invalidateExternalUrls,
}));
vi.mock('@/lib/client-cache', () => ({
  clearUserScopedBrowserCaches: mocks.clearBrowserCaches,
  subscribeToAuthenticationBoundaries: mocks.subscribe,
  subscribeToSessionEnd: mocks.subscribeSessionEnd,
}));

import { QueryProvider } from '@/components/query-provider';

let root: Root;
let boundaryCallback: (() => void) | undefined;
let sessionEndCallback: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  boundaryCallback = undefined;
  sessionEndCallback = undefined;
  mocks.subscribe.mockImplementation((callback: () => void) => {
    boundaryCallback = callback;
    return vi.fn();
  });
  mocks.subscribeSessionEnd.mockImplementation((callback: () => void) => {
    sessionEndCallback = callback;
    return vi.fn();
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('QueryProvider service-worker synchronization', () => {
  it('invalidates only the notification device list and removes its listener', async () => {
    let messageListener: ((event: MessageEvent<unknown>) => void) | undefined;
    const serviceWorker = {
      addEventListener: vi.fn((
        type: string,
        listener: (event: MessageEvent<unknown>) => void,
      ) => {
        if (type === 'message') messageListener = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('navigator', { serviceWorker });

    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Content'));
    });
    await act(async () => {
      messageListener?.(new MessageEvent('message', {
        data: { type: 'helprr-notification-subscriptions-changed' },
      }));
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['notifications', 'subscriptions'],
      exact: true,
    });

    await act(async () => root.unmount());
    expect(serviceWorker.removeEventListener).toHaveBeenCalledWith(
      'message',
      messageListener,
    );
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById('root')!);
  });
});

describe('QueryProvider authentication boundaries', () => {
  it('commits the neutral screen before clearing persistent caches', async () => {
    let privateTreePresentWhenClearStarted: boolean | undefined;
    let boundaryScreenPresentWhenClearStarted: boolean | undefined;
    mocks.clearBrowserCaches.mockImplementation(() => {
      privateTreePresentWhenClearStarted = Boolean(
        document.querySelector('[data-private-content]'),
      );
      boundaryScreenPresentWhenClearStarted = document.body.textContent?.includes(
        'Securing this browser session',
      );
      return new Promise<void>(() => undefined);
    });

    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            QueryProvider,
            null,
            createElement('div', { 'data-private-content': true }, 'Private content'),
          ),
        ),
      );
    });
    expect(document.body.textContent).toContain('Private content');

    await act(async () => boundaryCallback?.());

    expect(mocks.clearQueryClient).toHaveBeenCalledOnce();
    expect(mocks.invalidateExternalUrls).toHaveBeenCalledOnce();
    expect(mocks.clearBrowserCaches).toHaveBeenCalledOnce();
    expect(privateTreePresentWhenClearStarted).toBe(false);
    expect(boundaryScreenPresentWhenClearStarted).toBe(true);
  });

  it('reloads after another tab\'s boundary once the caches are clear', async () => {
    const reload = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, replace });
    mocks.clearBrowserCaches.mockResolvedValue(undefined);

    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Private content'));
    });
    await act(async () => boundaryCallback?.());

    expect(mocks.holdLoginRedirect).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it('ends this tab\'s own session behind the whole-app screen, then opens Login', async () => {
    const order: string[] = [];
    const replace = vi.fn(() => order.push('replace /login'));
    vi.stubGlobal('location', { ...window.location, reload: vi.fn(), replace });
    mocks.holdLoginRedirect.mockImplementation(() => order.push('hold login redirect'));
    mocks.clearQueryClient.mockImplementation(() => order.push('clear query client'));
    mocks.clearBrowserCaches.mockImplementation(async () => {
      order.push(document.querySelector('[data-private-content]') ? 'clear with app mounted' : 'clear behind screen');
    });

    await act(async () => {
      root.render(createElement(
        QueryProvider,
        null,
        createElement('div', { 'data-private-content': true }, 'Private content'),
      ));
    });
    await act(async () => sessionEndCallback?.());

    expect(order).toEqual(['hold login redirect', 'clear query client', 'clear behind screen', 'replace /login']);
    expect(mocks.invalidateExternalUrls).toHaveBeenCalledOnce();
  });

  it('stays on the error screen without navigating when the clear fails', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: vi.fn(), replace });
    mocks.clearBrowserCaches.mockRejectedValue(new Error('cache delete timed out'));

    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Private content'));
    });
    await act(async () => sessionEndCallback?.());

    expect(replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Browser data could not be cleared');
    expect(document.body.textContent).not.toContain('Private content');
  });
});

describe('QueryProvider reconnect', () => {
  it('refreshes the server-rendered layout and the queries when the browser comes back online', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"status":"ok"}', { status: 200 })));
    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Content'));
    });
    expect(mocks.routerRefresh).not.toHaveBeenCalled();

    await act(async () => { window.dispatchEvent(new Event('online')); });

    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.refreshAfterReconnect).toHaveBeenCalledTimes(1);
  });

  it('leaves the layout alone while the server does not answer, since a failed refresh would reload the page', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Content'));
    });

    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    expect(mocks.refreshAfterReconnect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('refreshes the layout and the queries once a retry finds the server', async () => {
    vi.useFakeTimers();
    let reachable = false;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (!reachable) throw new TypeError('Failed to fetch');
      return new Response('{"status":"ok"}', { status: 200 });
    }));
    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Content'));
    });

    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(mocks.refreshAfterReconnect).not.toHaveBeenCalled();
    reachable = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.refreshAfterReconnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('treats a health check that hangs as unanswered, and tries again on the next return to the page', async () => {
    vi.useFakeTimers();
    // A request that never answers, until it is aborted.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Content'));
    });

    await act(async () => { window.dispatchEvent(new Event('online')); });
    // 5 s probe timeout, 5 s before the retry, 5 s retry timeout.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not refresh once signing out has begun, even when the health check answers after', async () => {
    mocks.clearBrowserCaches.mockReturnValue(new Promise(() => {}));
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
    await act(async () => {
      root.render(createElement(QueryProvider, null, 'Content'));
    });

    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => { sessionEndCallback?.(); });
    await act(async () => {
      answer(new Response('{"status":"ok"}', { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    expect(mocks.refreshAfterReconnect).not.toHaveBeenCalled();
  });
});
