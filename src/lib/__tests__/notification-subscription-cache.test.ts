import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  syncRegisteredNotificationDevice,
  syncRemovedNotificationDevices,
} from '@/lib/notification-subscription-cache';
import {
  isNotificationSubscriptionsChangedMessage,
  NOTIFICATION_SUBSCRIPTIONS_CHANGED,
  type NotificationDeviceSummary,
} from '@/lib/notification-subscriptions';
import { queryKeys } from '@/lib/query-keys';

function device(overrides: Partial<NotificationDeviceSummary> = {}): NotificationDeviceSummary {
  return {
    id: 'device-1',
    endpoint: 'https://push.example/one',
    deviceName: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastSucceededAt: null,
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe('notification subscription cache synchronization', () => {
  it('does not seed a partial device list when no complete list is cached', async () => {
    const client = queryClient();

    await syncRegisteredNotificationDevice(client, device());

    expect(client.getQueryData(queryKeys.notificationSubscriptions())).toBeUndefined();
  });

  it('upserts endpoint rotation by stable id without duplicating the device', async () => {
    const client = queryClient();
    client.setQueryData(queryKeys.notificationSubscriptions(), [device()]);

    await syncRegisteredNotificationDevice(
      client,
      device({ endpoint: 'https://push.example/rotated' }),
    );

    expect(client.getQueryData(queryKeys.notificationSubscriptions())).toEqual([
      device({ endpoint: 'https://push.example/rotated' }),
    ]);
  });

  it('removes a deleted endpoint alias when rotation collides with another row', async () => {
    const client = queryClient();
    const rotated = device({ endpoint: 'https://push.example/rotated' });
    client.setQueryData(queryKeys.notificationSubscriptions(), [
      device(),
      device({ id: 'device-2', endpoint: rotated.endpoint }),
    ]);

    await syncRegisteredNotificationDevice(client, rotated);

    expect(client.getQueryData(queryKeys.notificationSubscriptions())).toEqual([rotated]);
  });

  it('removes only confirmed matching devices from a complete cached list', async () => {
    const client = queryClient();
    const other = device({ id: 'device-2', endpoint: 'https://push.example/two' });
    client.setQueryData(queryKeys.notificationSubscriptions(), [device(), other]);

    await syncRemovedNotificationDevices(client, (cached) => cached.id === 'device-1');

    expect(client.getQueryData(queryKeys.notificationSubscriptions())).toEqual([other]);
  });

  it('refetches an active list after patching to close registration races', async () => {
    const client = queryClient();
    const fetchDevices = vi.fn(async () => [
      device(),
      device({ id: 'device-2', endpoint: 'https://push.example/two' }),
    ]);
    client.setQueryData(queryKeys.notificationSubscriptions(), [device()]);
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.notificationSubscriptions(),
      queryFn: fetchDevices,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    await syncRegisteredNotificationDevice(
      client,
      device({ id: 'device-2', endpoint: 'https://push.example/two' }),
    );

    expect(fetchDevices).toHaveBeenCalledOnce();
    expect(client.getQueryData(queryKeys.notificationSubscriptions())).toEqual([
      device(),
      device({ id: 'device-2', endpoint: 'https://push.example/two' }),
    ]);
    unsubscribe();
  });

  it('cancels an in-flight stale list before the authoritative refetch', async () => {
    const client = queryClient();
    let resolveStaleList!: (devices: NotificationDeviceSummary[]) => void;
    const confirmed = device({ id: 'device-2', endpoint: 'https://push.example/two' });
    const fetchDevices = vi.fn(() => {
      if (fetchDevices.mock.calls.length === 1) {
        return new Promise<NotificationDeviceSummary[]>((resolve) => {
          resolveStaleList = resolve;
        });
      }
      return Promise.resolve([device(), confirmed]);
    });
    const observer = new QueryObserver(client, {
      queryKey: queryKeys.notificationSubscriptions(),
      queryFn: fetchDevices,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(fetchDevices).toHaveBeenCalledOnce());

    await syncRegisteredNotificationDevice(client, confirmed);
    resolveStaleList([device()]);
    await Promise.resolve();

    expect(fetchDevices).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(queryKeys.notificationSubscriptions())).toEqual([
      device(),
      confirmed,
    ]);
    unsubscribe();
  });
});

describe('notification subscription service-worker message', () => {
  it('accepts only the event-only cache invalidation message', () => {
    expect(isNotificationSubscriptionsChangedMessage({
      type: NOTIFICATION_SUBSCRIPTIONS_CHANGED,
    })).toBe(true);
    expect(isNotificationSubscriptionsChangedMessage({
      type: NOTIFICATION_SUBSCRIPTIONS_CHANGED,
      p256dh: 'secret',
    })).toBe(false);
    expect(isNotificationSubscriptionsChangedMessage({
      type: 'other',
    })).toBe(false);
  });
});
