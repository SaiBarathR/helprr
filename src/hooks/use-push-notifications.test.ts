// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { usePushNotifications } from './use-push-notifications';

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
  vi.unstubAllGlobals();
});

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
