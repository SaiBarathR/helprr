import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createMany: vi.fn(async () => ({ count: 0 })) }));
vi.mock('@/lib/db', () => ({ prisma: { notificationPreference: { createMany: mocks.createMany } } }));

import { ensureNotificationPreferences, eventEnabledByDefault, EVENT_TYPES } from '@/lib/notification-events';

describe('notification defaults', () => {
  it('seeds a new device with every event on except Tonight pick invites, keeping saved rows', async () => {
    await ensureNotificationPreferences('sub-1');
    const [[{ data, skipDuplicates }]] = mocks.createMany.mock.calls as unknown as [[{ data: { eventType: string; enabled: boolean }[]; skipDuplicates: boolean }]];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(EVENT_TYPES.length);
    expect(data.filter((row) => !row.enabled).map((row) => row.eventType)).toEqual(['tonightPickInvite']);
    expect(eventEnabledByDefault('grabbed')).toBe(true);
    expect(eventEnabledByDefault('tonightPickInvite')).toBe(false);
  });
});
