import { describe, expect, it } from 'vitest';
import { webPushDeliveryOptions } from '@/lib/notification-service';

describe('web push delivery options', () => {
  it('marks every user-visible push as high urgency so FCM can wake a dozing Android device', () => {
    expect(webPushDeliveryOptions('grabbed-12').urgency).toBe('high');
    expect(webPushDeliveryOptions(undefined).urgency).toBe('high');
  });

  it('keeps time-sensitive events queued long enough to survive a locked Android phone', () => {
    // Android Chrome maps omitted/normal urgency + a 60s TTL into "drop this
    // while the screen is off". One hour is the floor: high urgency should
    // wake the device immediately, and the TTL is the backstop if an OEM still
    // delays until the next maintenance window.
    for (const tag of [
      'grabbed-1',
      'imported-2',
      'torrentAdded-abc',
      'torrentCompleted-abc',
      'jellyfinPlaybackStart-s1',
      'cleanupRemoved-x',
      'requestCreated-9',
      'downloadFailed-3',
    ]) {
      expect(webPushDeliveryOptions(tag).TTL, tag).toBeGreaterThanOrEqual(3600);
    }
    expect(webPushDeliveryOptions(undefined).TTL).toBeGreaterThanOrEqual(3600);
  });

  it('still allows calendar-style events to wait a full day', () => {
    expect(webPushDeliveryOptions('upcomingPremiere-1').TTL).toBe(86400);
    expect(webPushDeliveryOptions('watchlistReminder-1').TTL).toBe(86400);
    expect(webPushDeliveryOptions('scheduledAlert-1').TTL).toBe(86400);
  });
});
