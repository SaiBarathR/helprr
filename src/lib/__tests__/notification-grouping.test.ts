import { describe, expect, it, vi } from 'vitest';
import { PollNotificationCollector, type NotificationEventInput } from '@/lib/notification-grouping';

type Notify = (event: NotificationEventInput) => Promise<number>;

// Three items of one series in one cycle: enough to group.
function flushGroup(eventType: string) {
  const collector = new PollNotificationCollector();
  for (const episodeId of [1, 2, 3]) {
    collector.add({
      eventType,
      title: 'x',
      body: `Show.S01E0${episodeId}`,
      metadata: { source: 'sonarr', instanceId: 'son-1', seriesId: 7, episodeId },
    }, { service: 'sonarr', reason: 'test' });
  }
  const notify = vi.fn<Notify>(async () => 1);
  return collector.flush({ enabled: true, notify }).then(() => {
    expect(notify).toHaveBeenCalledOnce();
    return notify.mock.calls[0][0];
  });
}

describe('grouped push destinations', () => {
  it.each(['downloadFailed', 'importFailed'])('opens the Needs import tab for grouped %s, even for one series', async (eventType) => {
    const event = await flushGroup(eventType);
    expect(event.url).toBe('/activity?tab=failed&source=sonarr');
    expect(event.metadata?.redirect).toBe('/activity?tab=failed&source=sonarr');
  });

  it('still opens the shared series for grouped grabs', async () => {
    const event = await flushGroup('grabbed');
    expect(event.url).toBe('/series/7?instance=son-1');
  });
});

describe('grouping by recipients', () => {
  it('keeps events for different recipients apart and sends a group to its own', async () => {
    const collector = new PollNotificationCollector();
    const add = (id: number, userIds?: string[]) => collector.add({
      eventType: 'upcomingPremiere',
      title: 'Upcoming Movie',
      body: `Film ${id}`,
      dedupeKey: `radarr-r1-${id}`,
      metadata: { source: 'radarr', instanceId: 'r1', movieId: id },
      ...(userIds ? { userIds } : {}),
    }, { service: 'radarr', reason: 'test' });
    for (const id of [1, 2, 3]) add(id, ['u2', 'u1']);
    for (const id of [4, 5, 6]) add(id, ['u3']);
    const notify = vi.fn<Notify>(async () => 1);
    await collector.flush({ enabled: true, notify });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map(([event]) => [event.userIds, event.metadata?.itemDedupeKeys])).toEqual([
      [['u2', 'u1'], ['radarr-r1-1', 'radarr-r1-2', 'radarr-r1-3']],
      [['u3'], ['radarr-r1-4', 'radarr-r1-5', 'radarr-r1-6']],
    ]);
  });
});
