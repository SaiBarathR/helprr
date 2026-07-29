export const NOTIFICATION_SUBSCRIPTIONS_CHANGED =
  'helprr-notification-subscriptions-changed';

export interface NotificationDeviceSummary {
  id: string;
  endpoint: string;
  deviceName: string | null;
  consecutiveFailures: number;
  lastFailedAt: string | null;
  lastSucceededAt: string | null;
  createdAt: string;
}

interface NotificationDeviceSource {
  id: string;
  endpoint: string;
  deviceName: string | null;
  consecutiveFailures: number;
  lastFailedAt: Date | null;
  lastSucceededAt: Date | null;
  createdAt: Date;
}

export function toNotificationDeviceSummary(
  subscription: NotificationDeviceSource,
): NotificationDeviceSummary {
  return {
    id: subscription.id,
    endpoint: subscription.endpoint,
    deviceName: subscription.deviceName,
    consecutiveFailures: subscription.consecutiveFailures,
    lastFailedAt: subscription.lastFailedAt?.toISOString() ?? null,
    lastSucceededAt: subscription.lastSucceededAt?.toISOString() ?? null,
    createdAt: subscription.createdAt.toISOString(),
  };
}

export function isNotificationSubscriptionsChangedMessage(
  value: unknown,
): value is { type: typeof NOTIFICATION_SUBSCRIPTIONS_CHANGED } {
  return (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === NOTIFICATION_SUBSCRIPTIONS_CHANGED
    && Object.keys(value).length === 1
  );
}
