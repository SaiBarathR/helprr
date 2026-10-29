// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NOTIFICATION_SUBSCRIPTIONS_CHANGED,
  type NotificationDeviceSummary,
} from '@/lib/notification-subscriptions';

const mocks = vi.hoisted(() => ({
  queryClient: {},
  syncRegistered: vi.fn(),
  syncRemoved: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mocks.queryClient,
}));
vi.mock('@/hooks/use-is-standalone', () => ({
  useIsStandalone: () => false,
}));
vi.mock('@/lib/notification-subscription-cache', () => ({
  syncRegisteredNotificationDevice: mocks.syncRegistered,
  syncRemovedNotificationDevices: mocks.syncRemoved,
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement('a', null, children),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { usePushNotifications } from './use-push-notifications';
import { PushReenableBanner } from '@/components/notifications/push-reenable-banner';

const savedDevice: NotificationDeviceSummary = {
  id: 'device-1',
  endpoint: 'https://push.example/new',
  deviceName: null,
  consecutiveFailures: 0,
  lastFailedAt: null,
  lastSucceededAt: null,
  createdAt: '2026-07-29T00:00:00.000Z',
};

const newSubscription = {
  endpoint: savedDevice.endpoint,
  options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
  toJSON: () => ({
    keys: {
      p256dh: 'p256dh-secret',
      auth: 'auth-secret',
    },
  }),
  unsubscribe: vi.fn(async () => true),
} as unknown as PushSubscription;

let root: Root;
let latest: ReturnType<typeof usePushNotifications>;
let getSubscription: ReturnType<typeof vi.fn>;
let subscribeBrowser: ReturnType<typeof vi.fn>;

function captureLatest(value: ReturnType<typeof usePushNotifications>) {
  latest = value;
}

function Harness() {
  const value = usePushNotifications();
  useEffect(() => captureLatest(value), [value]);
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.syncRegistered.mockResolvedValue(undefined);
  mocks.syncRemoved.mockResolvedValue(undefined);
  getSubscription = vi.fn().mockResolvedValue(null);
  subscribeBrowser = vi.fn().mockResolvedValue(newSubscription);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription,
          subscribe: subscribeBrowser,
        },
      }),
    },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    permission: 'granted',
    requestPermission: vi.fn(async () => 'granted'),
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/push/public-key') {
      return jsonResponse({ publicKey: 'AQID' });
    }
    if (url === '/api/push/subscribe') {
      return jsonResponse(savedDevice);
    }
    if (url === '/api/notifications/subscription/check') {
      return jsonResponse({ exists: true });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await vi.waitFor(() => expect(latest.loading).toBe(false));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function remount(withBanner = false) {
  await act(async () => root.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(createElement('div', null,
      createElement(Harness),
      withBanner ? createElement(PushReenableBanner) : null,
    ));
  });
}

function oldSubscription() {
  const sub = {
    ...newSubscription,
    endpoint: 'https://push.example/old',
    options: { applicationServerKey: new Uint8Array([9]).buffer },
    unsubscribe: vi.fn(async () => {
      getSubscription.mockResolvedValue(null);
      return true;
    }),
  } as unknown as PushSubscription;
  getSubscription.mockResolvedValue(sub);
  subscribeBrowser.mockImplementation(async () => {
    getSubscription.mockResolvedValue(newSubscription);
    return newSubscription;
  });
  return sub;
}

describe('usePushNotifications cache synchronization', () => {
  it('patches and invalidates only after the server confirms subscribe', async () => {
    let result: Awaited<ReturnType<typeof latest.subscribe>> | undefined;
    await act(async () => {
      result = await latest.subscribe();
    });

    expect(result).toEqual({ success: true });
    expect(mocks.syncRegistered).toHaveBeenCalledWith(mocks.queryClient, savedDevice);
  });

  it('does not synchronize a registration rejected by the server', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/push/public-key') {
        return jsonResponse({ publicKey: 'AQID' });
      }
      return jsonResponse({ error: 'failed' }, 500);
    });

    let result: Awaited<ReturnType<typeof latest.subscribe>> | undefined;
    await act(async () => {
      result = await latest.subscribe();
    });

    expect(result?.success).toBe(false);
    expect(mocks.syncRegistered).not.toHaveBeenCalled();
  });

  it('sends the old endpoint when foreground registration rotates VAPID keys', async () => {
    const oldSubscription = {
      ...newSubscription,
      endpoint: 'https://push.example/old',
      options: { applicationServerKey: new Uint8Array([9]).buffer },
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    getSubscription.mockResolvedValue(oldSubscription);

    await act(async () => {
      await latest.subscribe();
    });

    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      endpoint: savedDevice.endpoint,
      oldEndpoint: 'https://push.example/old',
    });
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(mocks.syncRemoved).not.toHaveBeenCalled();
  });

  it('removes a confirmed unsubscribe by endpoint', async () => {
    getSubscription.mockResolvedValue(newSubscription);

    let result: Awaited<ReturnType<typeof latest.unsubscribe>> | undefined;
    await act(async () => {
      result = await latest.unsubscribe();
    });

    expect(result).toEqual({ success: true });
    expect(mocks.syncRemoved).toHaveBeenCalledOnce();
    const matches = mocks.syncRemoved.mock.calls[0]?.[1] as
      | ((device: NotificationDeviceSummary) => boolean)
      | undefined;
    expect(matches?.(savedDevice)).toBe(true);
  });

  it('does not synchronize an unsubscribe rejected by the server', async () => {
    await act(async () => {
      await latest.subscribe();
    });
    expect(latest.isSubscribed).toBe(true);
    getSubscription.mockResolvedValue(newSubscription);
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/push/subscribe' && init?.method === 'DELETE') {
        return jsonResponse({ error: 'failed' }, 500);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    let result: Awaited<ReturnType<typeof latest.unsubscribe>> | undefined;
    await act(async () => {
      result = await latest.unsubscribe();
    });

    expect(result?.success).toBe(false);
    expect(mocks.syncRemoved).not.toHaveBeenCalled();
    expect(latest.isSubscribed).toBe(false);
    expect(latest.subscriptionEndpoint).toBeNull();
    expect(localStorage.getItem('helprr-push-enabled')).toBeNull();
  });

  it('synchronizes silent re-registration of a missing server row', async () => {
    await act(async () => root.unmount());
    getSubscription.mockResolvedValue(newSubscription);
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/push/public-key') {
        return jsonResponse({ publicKey: 'AQID' });
      }
      if (String(input) === '/api/notifications/subscription/check') {
        return jsonResponse({ exists: false });
      }
      if (String(input) === '/api/push/subscribe') {
        return jsonResponse(savedDevice);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    mocks.syncRegistered.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById('root')!);

    await act(async () => {
      root.render(createElement(Harness));
    });
    await vi.waitFor(() => expect(mocks.syncRegistered).toHaveBeenCalledWith(
      mocks.queryClient,
      savedDevice,
    ));

    expect(latest.wasReregistered).toBe(true);
  });

  it('refreshes the current endpoint after service-worker rotation', async () => {
    const rotatedEndpoint = 'https://push.example/rotated';
    getSubscription.mockResolvedValue({
      ...newSubscription,
      endpoint: rotatedEndpoint,
    } as unknown as PushSubscription);

    act(() => window.dispatchEvent(new Event(NOTIFICATION_SUBSCRIPTIONS_CHANGED)));

    await vi.waitFor(() => expect(latest.subscriptionEndpoint).toBe(rotatedEndpoint));
    expect(latest.isSubscribed).toBe(true);
  });
});

describe('VAPID key rotation recovery', () => {
  it.each([true, false])('replaces the old key instead of re-registering it (server row exists: %s)', async (exists) => {
    const old = oldSubscription();
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/notifications/subscription/check') {
        return jsonResponse({ exists });
      }
      return fetchDefault(input, init);
    });

    await remount(true);

    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(subscribeBrowser).toHaveBeenCalledExactlyOnceWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]).buffer,
    });
    const mutations = vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/push/subscribe');
    expect(mutations.map(([, init]) => init?.method)).toEqual(['POST']);
    expect(JSON.parse(String(mutations[0][1]?.body))).toMatchObject({
      endpoint: newSubscription.endpoint,
      oldEndpoint: old.endpoint,
    });
    expect(mocks.syncRemoved).not.toHaveBeenCalled();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(latest.isSubscribed).toBe(true);
    expect(latest.subscriptionEndpoint).toBe(newSubscription.endpoint);
    expect(latest.wasReregistered).toBe(false);
    expect(latest.needsReenable).toBe(false);
    expect(screen.queryByText(/re-registered/)).toBeNull();
  });

  it('shows a re-enable banner when automatic replacement needs a gesture and recovers in one tap', async () => {
    oldSubscription();
    subscribeBrowser.mockRejectedValueOnce(new DOMException('User gesture required', 'NotAllowedError'));

    await remount(true);

    expect(latest.isSubscribed).toBe(false);
    expect(latest.needsReenable).toBe(true);
    expect(screen.getByText('Notifications stopped on this device')).toBeDefined();
    expect(screen.getByText(/Turn notifications on again on this device/)).toBeDefined();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Re-enable' }));
    await vi.waitFor(() => expect(screen.queryByText('Notifications stopped on this device')).toBeNull());
    expect(subscribeBrowser).toHaveBeenCalledTimes(2);
    expect(mocks.syncRegistered).toHaveBeenCalledWith(mocks.queryClient, savedDevice);
  });

  it.each(['subscribe', 'server', 'network'] as const)('keeps the old endpoint for a later Enable after %s fails', async (step) => {
    const old = oldSubscription();
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    if (step === 'subscribe') {
      subscribeBrowser.mockRejectedValueOnce(new DOMException('User gesture required', 'NotAllowedError'));
    } else {
      vi.mocked(fetch).mockImplementation(async (input, init) => {
        if (String(input) === '/api/push/subscribe') {
          if (step === 'network') throw new TypeError('Failed to fetch');
          return jsonResponse({}, 500);
        }
        return fetchDefault(input, init);
      });
    }

    await remount();

    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(latest.isSubscribed).toBe(false);
    vi.mocked(fetch).mockImplementation(fetchDefault);
    vi.mocked(fetch).mockClear();
    // A new hook instance must recover using storage, not the failed task's locals.
    await remount();
    await act(async () => { await latest.subscribe(); });

    const post = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/push/subscribe');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ oldEndpoint: old.endpoint });
    expect(latest.isSubscribed).toBe(true);
    expect(localStorage.getItem('helprr-push-old-endpoint')).toBeNull();

    vi.mocked(fetch).mockClear();
    await act(async () => { await latest.subscribe(); });
    const nextPost = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/push/subscribe');
    expect(JSON.parse(String(nextPost?.[1]?.body))).not.toHaveProperty('oldEndpoint');
  });

  it('takes over the old row on app reopen after saving the new subscription failed', async () => {
    const old = oldSubscription();
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/push/subscribe') return jsonResponse({}, 500);
      return fetchDefault(input, init);
    });
    await remount();
    expect(latest.isSubscribed).toBe(false);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/notifications/subscription/check') return jsonResponse({ exists: false });
      return fetchDefault(input, init);
    });
    vi.mocked(fetch).mockClear();

    await remount();

    const post = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/push/subscribe');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ oldEndpoint: old.endpoint });
    expect(latest.isSubscribed).toBe(true);
    expect(localStorage.getItem('helprr-push-old-endpoint')).toBeNull();
  });

  it('keeps the toggle enabled and the banner hidden during an event-triggered replacement', async () => {
    getSubscription.mockResolvedValue(newSubscription);
    await remount(true);
    expect(latest.isSubscribed).toBe(true);
    oldSubscription();
    let finishReplacement!: (sub: PushSubscription) => void;
    subscribeBrowser.mockImplementation(() => new Promise<PushSubscription>((resolve) => { finishReplacement = resolve; }));

    await act(async () => window.dispatchEvent(new Event(NOTIFICATION_SUBSCRIPTIONS_CHANGED)));

    expect(subscribeBrowser).toHaveBeenCalledOnce();
    expect(latest.loading).toBe(false);
    expect(latest.isSubscribed).toBe(true);
    expect(latest.subscriptionEndpoint).toBe(newSubscription.endpoint);
    expect(latest.needsReenable).toBe(false);
    expect(screen.queryByText('Notifications stopped on this device')).toBeNull();
    getSubscription.mockResolvedValue(newSubscription);
    await act(async () => finishReplacement(newSubscription));
    expect(latest.isSubscribed).toBe(true);
    expect(latest.error).toBeNull();
  });

  it('leaves a failed replacement disabled and never registers the stale endpoint', async () => {
    const old = oldSubscription();
    vi.mocked(old.unsubscribe).mockRejectedValue(new Error('Could not unsubscribe'));
    await remount();

    expect(latest.loading).toBe(false);
    expect(latest.isSubscribed).toBe(false);
    expect(latest.subscriptionEndpoint).toBeNull();
    expect(latest.needsReenable).toBe(true);
    expect(latest.wasReregistered).toBe(false);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/push/subscribe')).toHaveLength(0);
  });

  it('requires re-enable instead of restoring a mismatched key without granted permission', async () => {
    oldSubscription();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
    await remount();

    expect(latest.isSubscribed).toBe(false);
    expect(latest.needsReenable).toBe(true);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(subscribeBrowser).not.toHaveBeenCalled();
    expect(mocks.syncRegistered).not.toHaveBeenCalled();
  });

  it('migrates the old device row without a DELETE that could strand the replacement', async () => {
    const old = oldSubscription();
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'DELETE') return jsonResponse({}, 503);
      return fetchDefault(input, init);
    });

    let result: Awaited<ReturnType<typeof latest.subscribe>> | undefined;
    await act(async () => { result = await latest.subscribe(); });

    expect(result).toEqual({ success: true });
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    const mutations = vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/push/subscribe');
    expect(mutations.map(([, init]) => init?.method)).toEqual(['POST']);
    expect(JSON.parse(String(mutations[0][1]?.body))).toMatchObject({
      endpoint: newSubscription.endpoint,
      oldEndpoint: old.endpoint,
    });
  });

  it.each(['unsubscribe', 'subscribe'] as const)('does not retry a replacement after browser %s fails', async (step) => {
    const old = oldSubscription();
    if (step === 'unsubscribe') vi.mocked(old.unsubscribe).mockRejectedValue(new Error('Could not unsubscribe'));
    else subscribeBrowser.mockRejectedValue(new DOMException('User gesture required', 'NotAllowedError'));
    vi.useFakeTimers();

    await remount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/notifications/subscription/check')).toHaveLength(1);
    expect(subscribeBrowser).toHaveBeenCalledTimes(step === 'subscribe' ? 1 : 0);
    expect(latest.isSubscribed).toBe(false);
    expect(latest.needsReenable).toBe(true);
  });

  it.each(['subscribe', 'unsubscribe'] as const)('clears another hook’s re-registration banner after %s', async (action) => {
    getSubscription.mockResolvedValue(newSubscription);
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/notifications/subscription/check') return jsonResponse({ exists: false });
      return fetchDefault(input, init);
    });
    await remount(true);
    expect(screen.getByText('Notifications were re-registered for this device.')).toBeDefined();

    await act(async () => { await latest[action](); });

    expect(latest.wasReregistered).toBe(false);
    expect(screen.queryByText(/re-registered/)).toBeNull();
    expect(screen.queryByText('Notifications stopped on this device')).toBeNull();
  });

  it('settles startup after five seconds when getSubscription never resolves', async () => {
    let resolveSubscription!: (sub: PushSubscription) => void;
    getSubscription.mockImplementation(() => new Promise<PushSubscription>((resolve) => { resolveSubscription = resolve; }));
    vi.useFakeTimers();
    await remount();
    expect(latest.loading).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(latest.loading).toBe(false);
    expect(latest.isSubscribed).toBe(false);
    expect(latest.error).toContain('not responding');
    await act(async () => resolveSubscription(newSubscription));
    expect(latest.isSubscribed).toBe(false);
    expect(mocks.syncRegistered).not.toHaveBeenCalled();
  });

  it('cancels a pending reconciliation retry when notifications are disabled', async () => {
    getSubscription.mockResolvedValue(newSubscription);
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/notifications/subscription/check') return jsonResponse({}, 503);
      return fetchDefault(input, init);
    });
    vi.useFakeTimers();
    await remount();
    await act(async () => { await latest.unsubscribe(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/notifications/subscription/check')).toHaveLength(1);
    expect(latest.isSubscribed).toBe(false);
    expect(latest.needsReenable).toBe(false);
  });

  it.each([
    ['/api/notifications/subscription/check', false],
    ['/api/notifications/subscription/check', true],
    ['/api/push/public-key', false],
    ['/api/push/public-key', true],
  ])('keeps a browser subscription enabled when %s fails (network rejection: %s)', async (url, rejects) => {
    getSubscription.mockResolvedValue(newSubscription);
    localStorage.setItem('helprr-push-enabled', '1');
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === url) {
        if (rejects) throw new TypeError('Failed to fetch');
        return jsonResponse({}, 503);
      }
      return fetchDefault(input, init);
    });
    vi.useFakeTimers();

    await remount(true);

    expect(latest.loading).toBe(false);
    expect(latest.isSubscribed).toBe(true);
    expect(latest.subscriptionEndpoint).toBe(newSubscription.endpoint);
    expect(latest.needsReenable).toBe(false);
    expect(latest.error).toBeNull();
    expect(screen.queryByText('Notifications stopped on this device')).toBeNull();
    expect(subscribeBrowser).not.toHaveBeenCalled();
    vi.mocked(fetch).mockImplementation(fetchDefault);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(latest.isSubscribed).toBe(true);
    expect(latest.error).toBeNull();
  });

  it.each([false, true])('keeps a public-key failure on the reconciliation retry quiet (network rejection: %s)', async (rejects) => {
    getSubscription.mockResolvedValue(newSubscription);
    const fetchDefault = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 503));
    vi.useFakeTimers();
    await remount();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input) === '/api/push/public-key') {
        if (rejects) throw new TypeError('Failed to fetch');
        return jsonResponse({}, 503);
      }
      return fetchDefault(input, init);
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(latest.isSubscribed).toBe(true);
    expect(latest.needsReenable).toBe(false);
    expect(latest.error).toBeNull();
  });

  it.each([true, false])('clears the re-enable nudge for a revoked subscription (remembered opt-in: %s)', async (remembered) => {
    const old = oldSubscription();
    if (remembered) localStorage.setItem('helprr-push-enabled', '1');
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ revoked: true }));

    await remount(true);

    expect(old.unsubscribe).toHaveBeenCalled();
    expect(latest.isSubscribed).toBe(false);
    expect(latest.subscriptionEndpoint).toBeNull();
    expect(latest.needsReenable).toBe(false);
    expect(localStorage.getItem('helprr-push-enabled')).toBeNull();
    expect(screen.queryByText('Notifications stopped on this device')).toBeNull();
    expect(subscribeBrowser).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url) === '/api/notifications/subscription/check')).toBe(true);
  });

  it('clears the re-enable nudge when the retry discovers revocation', async () => {
    getSubscription.mockResolvedValue(newSubscription);
    localStorage.setItem('helprr-push-enabled', '1');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 503));
    vi.useFakeTimers();
    await remount();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ revoked: true }));

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(newSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(latest.isSubscribed).toBe(false);
    expect(latest.subscriptionEndpoint).toBeNull();
    expect(latest.needsReenable).toBe(false);
    expect(localStorage.getItem('helprr-push-enabled')).toBeNull();
    expect(subscribeBrowser).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url) === '/api/notifications/subscription/check')).toBe(true);
  });

  it('settles Enable after five seconds when getSubscription never resolves', async () => {
    getSubscription.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    let result: Awaited<ReturnType<typeof latest.subscribe>> | undefined;
    let enabling!: Promise<void>;
    await act(async () => { enabling = latest.subscribe().then((value) => { result = value; }); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      // Old code never settles; do not await enabling until after asserting.
    });

    expect(latest.loading).toBe(false);
    expect(result).toEqual({ success: false, error: expect.stringContaining('not responding') });
    await enabling;
    expect(subscribeBrowser).not.toHaveBeenCalled();
  });
});
