import { describe, expect, it, vi } from 'vitest';
import { applyNotificationDeviceInTxn } from '@/lib/settings-import/notifications';
import { applyUserNotificationChannelsInTxn } from '@/lib/settings-import/notification-channels';
import type { NotificationEventType } from '@/lib/notification-events';

// A settings file from before the "upgraded" event: upgrades were sent as
// imports then, so the restored device or channel keeps getting them (or not).
describe('importing a file from before "Upgraded"', () => {
  const rule = (eventType: NotificationEventType, enabled: boolean, qualityFilter: string | null = null) => ({ eventType, enabled, tagFilter: 'kids', qualityFilter, mutedUserFilter: null });

  function deviceTx() {
    const upsert = vi.fn(async () => ({}));
    const tx = { pushSubscription: { findUnique: vi.fn(async () => ({ id: 'sub1' })) }, notificationPreference: { upsert } };
    const written = () => Object.fromEntries((upsert.mock.calls as unknown as Array<[{ create: { eventType: string; enabled: boolean; qualityFilter: string | null; tagFilter: string | null } }]>)
      .map(([args]) => [args.create.eventType, args.create]));
    return { tx: tx as never, written };
  }

  it('gives a device the choice and filters it had for "Imported"', async () => {
    const { tx, written } = deviceTx();
    await applyNotificationDeviceInTxn(tx, { deviceName: 'Phone', rules: [rule('imported', false, 'Bluray-2160p')] }, 'https://push.example/1', []);
    expect(written().upgraded).toMatchObject({ enabled: false, qualityFilter: 'Bluray-2160p', tagFilter: 'kids' });
  });

  it('keeps an "Upgraded" choice the file has', async () => {
    const { tx, written } = deviceTx();
    await applyNotificationDeviceInTxn(tx, { deviceName: 'Phone', rules: [rule('imported', true), rule('upgraded', false)] }, 'https://push.example/1', []);
    expect(written().upgraded).toMatchObject({ enabled: false });
    expect(written().imported).toMatchObject({ enabled: true });
  });

  function channelTx() {
    const upsert = vi.fn(async () => ({}));
    const tx = {
      user: { findUnique: vi.fn(async () => ({ role: 'member', permissions: {}, template: 'member' })) },
      notificationChannel: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0), upsert },
    };
    const events = () => (upsert.mock.calls as unknown as Array<[{ create: { events: string[] } }]>).map(([args]) => args.create.events);
    return { tx: tx as never, events };
  }
  const channel = (events: string[]) => ({ type: 'webhook', name: 'HA', enabled: true, events, config: {}, secrets: { url: 'https://hooks.example.com/helprr' } });

  it('adds "upgraded" to a channel set to "imported" in an older file, and not in a newer one', async () => {
    vi.stubEnv('JWT_SECRET', 'settings-import-test-secret-long-enough-for-aes');
    const old = channelTx();
    await applyUserNotificationChannelsInTxn(old.tx, [channel(['imported', 'grabbed'])] as never, 'u1', 'User', [], true);
    expect(old.events()).toEqual([['imported', 'grabbed', 'upgraded']]);

    // A newer file without it: the person turned upgrades off on purpose.
    const fresh = channelTx();
    await applyUserNotificationChannelsInTxn(fresh.tx, [channel(['imported', 'grabbed'])] as never, 'u1', 'User', [], false);
    expect(fresh.events()).toEqual([['imported', 'grabbed']]);
  });
});
