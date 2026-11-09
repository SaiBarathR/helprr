import { describe, expect, it } from 'vitest';
import { navBadgeName } from './nav-badge';

describe('navBadgeName', () => {
  it('says what each count is, after the label', () => {
    expect(navBadgeName('Notifications', { total: 44, attention: 44 }, 'notifications')).toBe('Notifications, 44 unread');
    // More's roll-up of mixed areas; a roll-up of only notifications passes 'notifications'.
    expect(navBadgeName('More', { total: 62, attention: 59 }, 'more')).toBe('More, 62 new');
    expect(navBadgeName('More', { total: 59, attention: 59 }, 'notifications')).toBe('More, 59 unread');
    // The Activity badge counts the Sonarr/Radarr/Lidarr download queue.
    expect(navBadgeName('Activity', { total: 3, attention: 0 }, 'activity')).toBe('Activity, 3 in queue');
    expect(navBadgeName('Torrents', { total: 2, attention: 0 }, 'downloads')).toBe('Torrents, 2 items');
    expect(navBadgeName('Requests', { total: 1, attention: 1 }, 'requests')).toBe('Requests, 1 item');
    expect(navBadgeName('Twitch', { total: 5, attention: 0 }, 'twitch')).toBe('Twitch, 5 items');
    expect(navBadgeName('YouTube', { total: 7, attention: 0 }, 'youtube')).toBe('YouTube, 7 items');
  });

  it('caps the count as the badge shows it', () => {
    expect(navBadgeName('Notifications', { total: 140, attention: 140 }, 'notifications')).toBe('Notifications, 99+ unread');
  });

  it('leaves an item without a count to its plain label', () => {
    expect(navBadgeName('Movies', undefined, undefined)).toBeUndefined();
    expect(navBadgeName('Activity', { total: 0, attention: 0 }, 'activity')).toBeUndefined();
  });
});
