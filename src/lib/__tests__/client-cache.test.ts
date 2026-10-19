import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastAuthenticationBoundary,
  clearUserScopedBrowserCaches,
  endSessionInThisBrowser,
  requestSessionLogout,
  subscribeToAuthenticationBoundaries,
  subscribeToSessionEnd,
} from '@/lib/client-cache';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('client authentication cache boundaries', () => {
  it('awaits deletion of every user-scoped PWA cache', async () => {
    const deleteCache = vi.fn<CacheStorage['delete']>(async () => true);
    vi.stubGlobal('window', {
      caches: { delete: deleteCache },
    });

    await clearUserScopedBrowserCaches();

    expect(deleteCache.mock.calls.map(([name]) => name)).toEqual([
      'pages',
      'api-readonly',
      'api-images',
    ]);
  });

  it('fences the worker before deleting the caches itself, and waits for its answer', async () => {
    const order: string[] = [];
    let replyPort: MessagePort | null = null;
    const postMessage = vi.fn((message: { type: string }, transfer: Transferable[]) => {
      order.push(message.type);
      replyPort = transfer[0] as MessagePort;
    });
    vi.stubGlobal('window', {
      caches: { delete: vi.fn(async (name: string) => { order.push(`delete ${name}`); return true; }) },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage } } });

    const clearing = clearUserScopedBrowserCaches();
    await vi.waitFor(() => expect(replyPort).not.toBeNull());
    expect(order).toEqual(['helprr-fence-user-caches']);
    replyPort!.postMessage({ ok: true });
    await clearing;

    expect(order).toEqual(['helprr-fence-user-caches', 'delete pages', 'delete api-readonly', 'delete api-images']);
  });

  it('still clears when the worker does not answer the fence', async () => {
    vi.useFakeTimers();
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal('window', {
      caches: { delete: deleteCache },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage: vi.fn() } } });

    const clearing = clearUserScopedBrowserCaches();
    await vi.advanceTimersByTimeAsync(1_000);
    await clearing;
    expect(deleteCache).toHaveBeenCalledTimes(3);
  });

  it('fails closed when direct Cache Storage deletion stalls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      caches: { delete: vi.fn(() => new Promise<boolean>(() => undefined)) },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('navigator', {});

    const clearing = clearUserScopedBrowserCaches();
    const assertion = expect(clearing).rejects.toThrow(
      'Timed out clearing user-scoped caches',
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('waits for the service worker to acknowledge cache deletion', async () => {
    let replyPort: MessagePort | null = null;
    const postMessage = vi.fn((
      _message: unknown,
      transfer: Transferable[],
    ) => {
      replyPort = transfer[0] as MessagePort;
    });
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: { postMessage } },
    });

    let finished = false;
    const clearing = clearUserScopedBrowserCaches().then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(replyPort).not.toBeNull());
    expect(finished).toBe(false);
    replyPort!.postMessage({ ok: true });
    await clearing;

    expect(finished).toBe(true);
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('rejects a negative service-worker acknowledgement', async () => {
    let replyPort: MessagePort | null = null;
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {
          postMessage: (_message: unknown, transfer: Transferable[]) => {
            replyPort = transfer[0] as MessagePort;
          },
        },
      },
    });

    const clearing = clearUserScopedBrowserCaches();
    await vi.waitFor(() => expect(replyPort).not.toBeNull());
    replyPort!.postMessage({ ok: false });

    await expect(clearing).rejects.toThrow(
      'Service worker failed to clear user-scoped caches',
    );
  });

  it('fails closed when the service worker does not acknowledge in time', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {
          postMessage: vi.fn(),
        },
      },
    });

    const clearing = clearUserScopedBrowserCaches();
    const assertion = expect(clearing).rejects.toThrow(
      'Timed out clearing user-scoped caches',
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('reports whether the bounded session logout succeeds', async () => {
    const fetchLogout = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', fetchLogout);

    await expect(requestSessionLogout()).resolves.toBe('success');
    await expect(requestSessionLogout()).resolves.toBe('failed');
    expect(fetchLogout).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      signal: expect.any(AbortSignal),
    });
  });

  it('aborts a stalled session logout after the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn((_input, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }));

    const logout = requestSessionLogout();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(logout).resolves.toBe('indeterminate');
    expect(signal?.aborted).toBe(true);
  });

  it('treats a network failure as an indeterminate logout', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));

    await expect(requestSessionLogout()).resolves.toBe('indeterminate');
  });

  it('falls back when BroadcastChannel cannot be constructed', () => {
    const setItem = vi.fn();
    class BrokenBroadcastChannel {
      constructor() {
        throw new Error('BroadcastChannel unavailable');
      }
    }
    vi.stubGlobal('window', { localStorage: { setItem } });
    vi.stubGlobal('BroadcastChannel', BrokenBroadcastChannel);
    vi.stubGlobal('crypto', {});

    expect(() => broadcastAuthenticationBoundary()).not.toThrow();
    expect(setItem).toHaveBeenCalledWith(
      'helprr:authentication-boundary',
      expect.stringContaining('helprr-authentication-boundary'),
    );
  });

  it('publishes to both transports and deduplicates received boundaries', () => {
    type Listener = (event: MessageEvent<unknown>) => void;
    const listeners: { channel?: Listener; storage?: (event: StorageEvent) => void } = {};
    const channelPostMessage = vi.fn();
    const setItem = vi.fn();
    class FakeBroadcastChannel {
      constructor(name: string) {
        expect(name).toBe('helprr-authentication-boundary');
      }
      addEventListener(_type: string, next: Listener) {
        listeners.channel = next;
      }
      removeEventListener() {}
      postMessage(message: unknown) {
        channelPostMessage(message);
      }
    }
    vi.stubGlobal('window', {
      localStorage: { setItem },
      addEventListener: (_type: string, next: (event: StorageEvent) => void) => {
        listeners.storage = next;
      },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const onBoundary = vi.fn();

    const unsubscribe = subscribeToAuthenticationBoundaries(onBoundary);
    broadcastAuthenticationBoundary();
    expect(onBoundary).not.toHaveBeenCalled();
    expect(channelPostMessage).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledOnce();

    const first = {
      type: 'helprr-authentication-boundary',
      id: 'boundary-1',
    };
    listeners.channel?.(new MessageEvent('message', {
      data: first,
    }));
    listeners.storage?.({
      key: 'helprr:authentication-boundary',
      newValue: JSON.stringify(first),
    } as StorageEvent);
    expect(onBoundary).toHaveBeenCalledOnce();
    listeners.storage?.({
      key: 'helprr:authentication-boundary',
      newValue: JSON.stringify({ ...first, id: 'boundary-2' }),
    } as StorageEvent);
    expect(onBoundary).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe('ending this browser session', () => {
  function stubWindow() {
    const setItem = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('window', { localStorage: { setItem }, location: { replace } });
    return { setItem, replace };
  }

  it('tells other tabs and hands over to the app shell', () => {
    const { setItem, replace } = stubWindow();
    const onSessionEnd = vi.fn();
    const unsubscribe = subscribeToSessionEnd(onSessionEnd);

    endSessionInThisBrowser();
    unsubscribe();

    expect(setItem).toHaveBeenCalledWith('helprr:authentication-boundary', expect.any(String));
    expect(onSessionEnd).toHaveBeenCalledOnce();
    // The app shell navigates once the caches are clear, not before.
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes to Login directly when no app shell is listening', () => {
    const { replace } = stubWindow();

    endSessionInThisBrowser();

    expect(replace).toHaveBeenCalledWith('/login');
  });
});
