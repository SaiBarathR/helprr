// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationDeviceSummary } from '@/lib/notification-subscriptions';

const mocks = vi.hoisted(() => ({ devices: [] as NotificationDeviceSummary[] }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.devices, isError: false }),
  useQueryClient: () => ({}),
}));
vi.mock('@/hooks/use-push-notifications', () => ({
  usePushNotifications: () => ({ subscriptionEndpoint: null, loading: false }),
}));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));

import NotificationDevicesPage from './page';

const device: NotificationDeviceSummary = {
  id: 'phone',
  endpoint: 'https://fcm.googleapis.com/fcm/send/phone',
  deviceName: 'Phone',
  consecutiveFailures: 1,
  lastFailedAt: '2026-10-29T10:00:00.000Z',
  lastSucceededAt: '2026-10-29T09:43:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('notification device delivery health', () => {
  it('flags a failed delivery despite a previous success and clears guidance after success', () => {
    mocks.devices = [device];
    const { rerender } = render(<NotificationDevicesPage />);

    expect(screen.getByRole('status').textContent).toContain('Delivery is failing.');
    expect(screen.getByRole('status').textContent).toContain('Turn notifications off and on again on that device');
    expect(screen.getByText('Last failure')).toBeDefined();
    expect(screen.getByText('Last delivery')).toBeDefined();

    mocks.devices = [{ ...device, consecutiveFailures: 0, lastSucceededAt: '2026-10-29T10:01:00.000Z' }];
    rerender(<NotificationDevicesPage />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Consecutive failures')).toBeNull();
  });
});
