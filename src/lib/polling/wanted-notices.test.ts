import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ receivers: vi.fn() }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn(), usersWhoCouldReceive: mocks.receivers }));

import { wantedNotices } from './shared';

const notice = (eventType: string, body = eventType) => ({ event: { eventType, title: 't', body, metadata: { source: 'sonarr' } } });

describe('wantedNotices', () => {
  it('keeps only the events someone takes, asking once per event type', async () => {
    mocks.receivers.mockImplementation(async (eventType: string) => (eventType === 'fileDeleted' ? [{ id: 'u1', timeZone: null }] : []));
    const kept = await wantedNotices([notice('fileDeleted', 'a'), notice('fileRenamed'), notice('fileDeleted', 'b')]);
    expect(kept.map((n) => n.event.body)).toEqual(['a', 'b']);
    expect(mocks.receivers).toHaveBeenCalledTimes(2);
    expect(mocks.receivers).toHaveBeenCalledWith('fileDeleted', { source: 'sonarr' });
  });

  it('sends them when the check fails, as before it existed', async () => {
    mocks.receivers.mockReset().mockRejectedValue(new Error('db down'));
    expect(await wantedNotices([notice('titleAdded')])).toHaveLength(1);
  });
});
