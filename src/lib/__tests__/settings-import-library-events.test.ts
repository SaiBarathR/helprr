import { describe, expect, it, vi } from 'vitest';
import { applyNotificationDeviceInTxn, laterEventsMissingFrom } from '@/lib/settings-import/notifications';
import { applyUserNotificationChannelsInTxn } from '@/lib/settings-import/notification-channels';
import { eventEnabledByDefault, type NotificationEventType } from '@/lib/notification-events';

const OPT_IN = ['titleAdded', 'titleDeleted', 'fileDeleted', 'fileRenamed', 'arrUpdateAvailable'] as const;

// The AR-17 events start off everywhere: a file from before them has no rule
// and no channel event for them, and must not turn them on, while a newer
// file restores what was chosen.
describe('importing the library, file and app update events', () => {
  const rule = (eventType: NotificationEventType, enabled: boolean) => ({ eventType, enabled, tagFilter: null, qualityFilter: null, mutedUserFilter: null });

  function deviceTx() {
    const upsert = vi.fn(async () => ({}));
    const tx = { pushSubscription: { findUnique: vi.fn(async () => ({ id: 'sub1' })) }, notificationPreference: { upsert } };
    const written = () => Object.fromEntries((upsert.mock.calls as unknown as Array<[{ create: { eventType: string; enabled: boolean } }]>)
      .map(([args]) => [args.create.eventType, args.create.enabled]));
    return { tx: tx as never, written };
  }

  it('an older device writes nothing for them, so they read as off', async () => {
    const { tx, written } = deviceTx();
    await applyNotificationDeviceInTxn(tx, {
      deviceName: 'Phone', rules: [rule('imported', true), rule('importFailed', true), rule('healthWarning', true), rule('updateAvailable', true)],
    }, 'https://push.example/1', []);
    for (const eventType of OPT_IN) {
      expect(written()).not.toHaveProperty(eventType);
      expect(eventEnabledByDefault(eventType)).toBe(false);
    }
  });

  it('a newer device keeps the ones turned on, and off', async () => {
    const { tx, written } = deviceTx();
    await applyNotificationDeviceInTxn(tx, {
      deviceName: 'Phone', rules: [rule('titleAdded', true), rule('fileRenamed', false), rule('arrUpdateAvailable', true)],
    }, 'https://push.example/1', []);
    expect(written()).toEqual({ titleAdded: true, fileRenamed: false, arrUpdateAvailable: true });
  });

  function channelTx() {
    const upsert = vi.fn(async () => ({}));
    const tx = {
      user: { findUnique: vi.fn(async () => ({ role: 'admin', permissions: {}, template: 'admin' })) },
      notificationChannel: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0), upsert },
    };
    const events = () => (upsert.mock.calls as unknown as Array<[{ create: { events: string[] } }]>).map(([args]) => args.create.events);
    return { tx: tx as never, events };
  }
  const channel = (events: string[]) => ({ type: 'webhook', name: 'HA', enabled: true, events, config: {}, secrets: { url: 'https://hooks.example.com/helprr' } });

  it('a channel from the oldest file gets none of them; one that lists them keeps them', async () => {
    vi.stubEnv('JWT_SECRET', 'settings-import-test-secret-long-enough-for-aes');
    const old = channelTx();
    await applyUserNotificationChannelsInTxn(old.tx, [channel(['imported', 'importFailed', 'healthWarning', 'updateAvailable'])] as never, 'u1', 'User', [], laterEventsMissingFrom({ accounts: [] }));
    for (const eventType of OPT_IN) expect(old.events()[0]).not.toContain(eventType);

    const fresh = channelTx();
    await applyUserNotificationChannelsInTxn(fresh.tx, [channel(['titleAdded', 'arrUpdateAvailable'])] as never, 'u1', 'User', [], []);
    expect(fresh.events()).toEqual([['titleAdded', 'arrUpdateAvailable']]);
  });
});
