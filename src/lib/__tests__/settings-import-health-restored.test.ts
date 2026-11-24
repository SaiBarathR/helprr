import { describe, expect, it, vi } from 'vitest';
import { applyNotificationDeviceInTxn, laterEventsMissingFrom } from '@/lib/settings-import/notifications';
import { applyUserNotificationChannelsInTxn } from '@/lib/settings-import/notification-channels';
import type { NotificationEventType } from '@/lib/notification-events';

// A settings file from before the "healthRestored" event: a device or channel
// that had health warnings off must not start getting "Health Restored".
describe('importing a file from before "Health Restored"', () => {
  const rule = (eventType: NotificationEventType, enabled: boolean) => ({ eventType, enabled, tagFilter: null, qualityFilter: null, mutedUserFilter: null });

  function deviceTx() {
    const upsert = vi.fn(async () => ({}));
    const tx = { pushSubscription: { findUnique: vi.fn(async () => ({ id: 'sub1' })) }, notificationPreference: { upsert } };
    const written = () => Object.fromEntries((upsert.mock.calls as unknown as Array<[{ create: { eventType: string; enabled: boolean } }]>)
      .map(([args]) => [args.create.eventType, args.create]));
    return { tx: tx as never, written };
  }

  it('gives a device the choice it had for "Health Warning"', async () => {
    const off = deviceTx();
    await applyNotificationDeviceInTxn(off.tx, { deviceName: 'Phone', rules: [rule('healthWarning', false)] }, 'https://push.example/1', []);
    expect(off.written().healthRestored).toMatchObject({ enabled: false });

    const on = deviceTx();
    await applyNotificationDeviceInTxn(on.tx, { deviceName: 'Phone', rules: [rule('healthWarning', true)] }, 'https://push.example/1', []);
    expect(on.written().healthRestored).toMatchObject({ enabled: true });
  });

  it('keeps a "Health Restored" choice the file has', async () => {
    const { tx, written } = deviceTx();
    await applyNotificationDeviceInTxn(tx, { deviceName: 'Phone', rules: [rule('healthRestored', true), rule('healthWarning', false)] }, 'https://push.example/1', []);
    expect(written()).toMatchObject({ healthWarning: { enabled: false }, healthRestored: { enabled: true } });
  });

  it('reads the marker each later event has', () => {
    expect(laterEventsMissingFrom({ accounts: [] }).map((e) => e.to)).toEqual(['upgraded', 'healthRestored']);
    expect(laterEventsMissingFrom({ accounts: [], upgradedEvent: true }).map((e) => e.to)).toEqual(['healthRestored']);
    expect(laterEventsMissingFrom({ accounts: [], upgradedEvent: true, healthRestoredEvent: true })).toEqual([]);
  });

  function channelTx() {
    const upsert = vi.fn(async () => ({}));
    const tx = {
      // An admin, so health events survive the cut to what the account may receive.
      user: { findUnique: vi.fn(async () => ({ role: 'admin', permissions: {}, template: 'admin' })) },
      notificationChannel: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0), upsert },
    };
    const events = () => (upsert.mock.calls as unknown as Array<[{ create: { events: string[] } }]>).map(([args]) => args.create.events);
    return { tx: tx as never, events };
  }
  const channel = (events: string[], name = 'HA') => ({ type: 'webhook', name, enabled: true, events, config: {}, secrets: { url: 'https://hooks.example.com/helprr' } });

  it('adds "healthRestored" to a channel set to "healthWarning" in an older file, and not in a newer one', async () => {
    vi.stubEnv('JWT_SECRET', 'settings-import-test-secret-long-enough-for-aes');
    // From between "Upgraded" and "Health Restored".
    const old = channelTx();
    await applyUserNotificationChannelsInTxn(old.tx, [channel(['healthWarning', 'imported']), channel(['grabbed'], 'Other')] as never, 'u1', 'User', [], laterEventsMissingFrom({ accounts: [], upgradedEvent: true }));
    expect(old.events()).toEqual([['healthWarning', 'imported', 'healthRestored'], ['grabbed']]);

    // A newer file without it: the person turned it off on purpose.
    const fresh = channelTx();
    await applyUserNotificationChannelsInTxn(fresh.tx, [channel(['healthWarning'])] as never, 'u1', 'User', [], laterEventsMissingFrom({ accounts: [], upgradedEvent: true, healthRestoredEvent: true }));
    expect(fresh.events()).toEqual([['healthWarning']]);
  });
});
