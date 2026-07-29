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
  clearBrowserCaches: vi.fn(),
  clearQueryClient: vi.fn(),
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
  getQueryClient: () => ({ clear: mocks.clearQueryClient }),
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
