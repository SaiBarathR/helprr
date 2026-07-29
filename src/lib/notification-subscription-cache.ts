import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { NotificationDeviceSummary } from '@/lib/notification-subscriptions';

const subscriptionKey = queryKeys.notificationSubscriptions();

function updateCompleteList(
  queryClient: QueryClient,
  update: (devices: NotificationDeviceSummary[]) => NotificationDeviceSummary[],
): void {
  const cached = queryClient.getQueryData<NotificationDeviceSummary[]>(subscriptionKey);
  if (!Array.isArray(cached)) return;
  queryClient.setQueryData(subscriptionKey, update(cached));
}

async function reconcileNotificationSubscriptions(
  queryClient: QueryClient,
  update?: (devices: NotificationDeviceSummary[]) => NotificationDeviceSummary[],
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: subscriptionKey, exact: true });
  if (update) updateCompleteList(queryClient, update);
  await queryClient.invalidateQueries({ queryKey: subscriptionKey, exact: true });
}

export async function syncRegisteredNotificationDevice(
  queryClient: QueryClient,
  device: NotificationDeviceSummary,
): Promise<void> {
  await reconcileNotificationSubscriptions(queryClient, (devices) => {
    const updated = devices.filter(
      (existing) => existing.id === device.id || existing.endpoint !== device.endpoint,
    );
    const index = updated.findIndex((existing) => existing.id === device.id);
    if (index === -1) return [...updated, device];
    updated[index] = device;
    return updated;
  });
}

export async function syncRemovedNotificationDevices(
  queryClient: QueryClient,
  matches: (device: NotificationDeviceSummary) => boolean,
): Promise<void> {
  await reconcileNotificationSubscriptions(
    queryClient,
    (devices) => devices.filter((device) => !matches(device)),
  );
}

export function invalidateNotificationSubscriptions(queryClient: QueryClient): Promise<void> {
  return reconcileNotificationSubscriptions(queryClient);
}
