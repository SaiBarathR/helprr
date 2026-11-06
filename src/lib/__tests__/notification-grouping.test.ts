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
