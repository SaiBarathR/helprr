// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearUserScopedBrowserCaches: vi.fn(),
  boundaryListeners: new Set<() => void>(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/query-client', () => ({ getQueryClient: () => ({ clear: vi.fn() }) }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ invalidateExternalUrls: vi.fn() }));
vi.mock('@/lib/client-cache', () => ({
  broadcastAuthenticationBoundary: vi.fn(),
  clearUserScopedBrowserCaches: mocks.clearUserScopedBrowserCaches,
  requestSessionLogout: vi.fn(),
  subscribeToAuthenticationBoundaries: (onBoundary: () => void) => {
    mocks.boundaryListeners.add(onBoundary);
    return () => mocks.boundaryListeners.delete(onBoundary);
  },
}));
import LoginPage from './page';

let root: Root;
let container: HTMLDivElement;
let mounted: boolean;

function meAnswers(response: Promise<Response>) {
  const fetchMock = vi.fn(() => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openLogin() {
  await act(async () => root.render(<LoginPage />));
  mounted = true;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.clearUserScopedBrowserCaches.mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Login page', () => {
  it('clears what an ended session left in this browser once the server confirms it is gone', async () => {
    const fetchMock = meAnswers(Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 })));
    await openLogin();
    expect(fetchMock).toHaveBeenCalledWith('/api/me', { cache: 'no-store' });
    expect(mocks.clearUserScopedBrowserCaches).toHaveBeenCalledTimes(1);
  });

  it('keeps the caches of a visitor who is still signed in', async () => {
    meAnswers(Promise.resolve(Response.json({ id: 'u1' })));
    await openLogin();
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
  });

  it('keeps the caches when it cannot reach the server', async () => {
    meAnswers(Promise.reject(new TypeError('Failed to fetch')));
    await openLogin();
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
  });

  it('still shows the sign-in form when the clear fails', async () => {
    meAnswers(Promise.resolve(new Response(null, { status: 401 })));
    mocks.clearUserScopedBrowserCaches.mockRejectedValue(new Error('Timed out clearing user-scoped caches'));
    await openLogin();
    expect(mocks.clearUserScopedBrowserCaches).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')?.textContent).toContain('Sign In');
  });

  it('does not clear after Login has been left, so a new sign-in keeps its caches', async () => {
    let answer!: (response: Response) => void;
    meAnswers(new Promise<Response>((resolve) => { answer = resolve; }));
    await openLogin();
    act(() => root.unmount());
    mounted = false;
    await act(async () => answer(new Response(null, { status: 401 })));
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
    expect(mocks.boundaryListeners.size).toBe(0);
  });

  it('does not clear on a late answer once another tab has signed in', async () => {
    let answer!: (response: Response) => void;
    meAnswers(new Promise<Response>((resolve) => { answer = resolve; }));
    await openLogin();
    act(() => mocks.boundaryListeners.forEach((listener) => listener()));
    await act(async () => answer(new Response(null, { status: 401 })));
    expect(mocks.clearUserScopedBrowserCaches).not.toHaveBeenCalled();
  });
});
