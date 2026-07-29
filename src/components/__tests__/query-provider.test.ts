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
}));

vi.mock('@tanstack/react-query', () => ({
  QueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtools: () => null,
}));
vi.mock('@/lib/query-client', () => ({
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
}));

import { QueryProvider } from '@/components/query-provider';

let root: Root;
let boundaryCallback: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  boundaryCallback = undefined;
  mocks.subscribe.mockImplementation((callback: () => void) => {
    boundaryCallback = callback;
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
});
