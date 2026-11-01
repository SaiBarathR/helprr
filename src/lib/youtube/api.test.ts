import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  head: vi.fn(),
  settings: { quotaDay: null as string | null, quotaUsed: 0, quotaSearches: 0 },
  updateMany: vi.fn(),
  apiKey: null as string | null,
}));

vi.mock('axios', async (original) => {
  const actual = await original<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: mocks.get, head: mocks.head } };
});
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findFirst: vi.fn(async () => (mocks.apiKey ? { apiKey: mocks.apiKey } : null)) },
    youtubeSettings: { updateMany: mocks.updateMany },
  },
}));
vi.mock('@/lib/youtube/settings', () => ({ getYoutubeSettings: vi.fn(async () => mocks.settings) }));
vi.mock('@/lib/twitch/token-cipher', () => ({ decryptTwitchToken: (value: string | null) => value?.replace('enc:', '') ?? null }));

import { AxiosError, type AxiosResponse } from 'axios';
import {
  channelByHandle, DAILY_QUOTA, DAILY_SEARCHES, pacificDay, parseIsoDuration, playlistItems, quotaState, searchChannels, shortsListOf, verifyYoutubeKey,
  videosById, YoutubeKeyRejectedError, youtubeReachable, YoutubeQuotaError,
} from './api';

const KEY = 'not-a-real-youtube-key';

function apiError(status: number, reason: string) {
  const error = new AxiosError('failed');
  error.response = { status, data: { error: { errors: [{ reason }] } } } as AxiosResponse;
  return error;
}

const video = {
  id: 'z7rgGfE8sug',
  snippet: {
    channelId: 'UCVlfe3MRSCZSeIWByrWHhkg', channelTitle: 'WAN Show', title: 'AI Is Bursting', description: 'Show',
    publishedAt: '2026-10-31T03:54:00Z', liveBroadcastContent: 'none',
    thumbnails: { high: { url: 'https://i.ytimg.com/high.jpg' }, maxres: { url: 'https://i.ytimg.com/max.jpg' } },
  },
  contentDetails: { duration: 'PT3H12M50S' },
  liveStreamingDetails: { actualStartTime: '2026-10-31T00:00:00Z', actualEndTime: '2026-10-31T03:42:00Z' },
  statistics: { viewCount: '1234' },
};

describe('YouTube API client', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.updateMany.mockReset();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.apiKey = `enc:${KEY}`;
    mocks.settings.quotaDay = pacificDay();
    mocks.settings.quotaUsed = 0;
    mocks.settings.quotaSearches = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('sends the key in a header, never in the URL or the parameters', async () => {
    mocks.get.mockResolvedValue({ data: { items: [] } });
    await channelByHandle('wanshowyt');
    const [url, config] = mocks.get.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/youtube/v3/channels');
    expect(config.headers['X-Goog-Api-Key']).toBe(KEY);
    expect(JSON.stringify([url, config.params])).not.toContain(KEY);
  });

  it('keeps the key out of an error', async () => {
    mocks.get.mockRejectedValue(apiError(500, 'backendError'));
    await expect(channelByHandle('wanshowyt')).rejects.toThrow('YouTube request failed: 500');
    await channelByHandle('wanshowyt').catch((error: Error) => expect(error.message).not.toContain(KEY));
  });

  it('counts the units it spends', async () => {
    mocks.get.mockResolvedValue({ data: { items: [] } });
    await channelByHandle('wanshowyt');
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'singleton', quotaDay: pacificDay(), quotaUsed: { lt: DAILY_QUOTA * 0.95 } },
      data: { quotaUsed: { increment: 1 } },
    });
  });

  it('starts a new count on a new Pacific day', async () => {
    mocks.get.mockResolvedValue({ data: { items: [] } });
    await channelByHandle('wanshowyt');
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'singleton', OR: [{ quotaDay: null }, { quotaDay: { not: pacificDay() } }] },
      data: { quotaDay: pacificDay(), quotaUsed: 0, quotaSearches: 0 },
    });
  });

  it('stops before the limit without calling Google', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(channelByHandle('wanshowyt')).rejects.toBeInstanceOf(YoutubeQuotaError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('counts a search in its own daily bucket, never in the units', async () => {
    mocks.get.mockResolvedValue({ data: { items: [] } });
    await searchChannels('waveform');
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'singleton', quotaDay: pacificDay(), quotaSearches: { lt: DAILY_SEARCHES * 0.95 } },
      data: { quotaSearches: { increment: 1 } },
    });
  });

  it('says what to do instead when the searches run out', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(searchChannels('waveform')).rejects.toThrow("Paste the channel's link");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('shows both counts, and none from an earlier day', async () => {
    mocks.settings.quotaUsed = 40;
    mocks.settings.quotaSearches = 3;
    expect(await quotaState()).toMatchObject({ used: 40, searches: 3, searchLimit: DAILY_SEARCHES });
    mocks.settings.quotaDay = '2020-01-01';
    expect(await quotaState()).toMatchObject({ used: 0, searches: 0 });
  });

  it('tests a key without asking the counter, which may belong to another key', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.get.mockResolvedValue({ data: { items: [] } });
    await expect(verifyYoutubeKey(KEY)).resolves.toBeUndefined();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('reports slowing down at 80%', async () => {
    mocks.settings.quotaUsed = DAILY_QUOTA * 0.8;
    expect(await quotaState()).toMatchObject({ slowDown: true, stopped: false });
  });

  it('uses the Pacific day, not the server day', () => {
    expect(pacificDay(new Date('2026-11-01T06:59:00Z'))).toBe('2026-10-31');
    expect(pacificDay(new Date('2026-11-01T07:01:00Z'))).toBe('2026-11-01');
  });

  it.each([
    ['quotaExceeded', YoutubeQuotaError],
    ['keyInvalid', YoutubeKeyRejectedError],
    ['API_KEY_SERVICE_BLOCKED', YoutubeKeyRejectedError],
  ])('turns %s into a clear error', async (reason, type) => {
    mocks.get.mockRejectedValue(apiError(403, reason));
    await expect(channelByHandle('wanshowyt')).rejects.toBeInstanceOf(type);
  });

  it('treats a missing list as an answer: a channel with no Shorts has none', async () => {
    mocks.get.mockRejectedValue(apiError(404, 'playlistNotFound'));
    expect(await playlistItems(shortsListOf('UCVlfe3MRSCZSeIWByrWHhkg'))).toBeNull();
    expect(mocks.get.mock.calls[0][1].params.playlistId).toBe('UUSHVlfe3MRSCZSeIWByrWHhkg');
  });

  it('refuses to call without a key', async () => {
    mocks.apiKey = null;
    await expect(channelByHandle('wanshowyt')).rejects.toBeInstanceOf(YoutubeKeyRejectedError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('verifies a typed key without saving anything else', async () => {
    mocks.get.mockResolvedValue({ data: { items: [] } });
    await verifyYoutubeKey('another-fake-key');
    expect(mocks.get.mock.calls[0][1].headers['X-Goog-Api-Key']).toBe('another-fake-key');
  });

  it('reads a finished stream', async () => {
    mocks.get.mockResolvedValue({ data: { items: [video] } });
    const [row] = await videosById(['z7rgGfE8sug']);
    expect(row).toMatchObject({
      id: 'z7rgGfE8sug', durationSeconds: 11_570, liveState: 'none', wasLive: true, ageRestricted: false,
      thumbnailUrl: 'https://i.ytimg.com/max.jpg', viewCount: 1234,
    });
    expect(row.liveEndedAt).toEqual(new Date('2026-10-31T03:42:00Z'));
  });

  it('sees an age-restricted video before downloading', async () => {
    mocks.get.mockResolvedValue({ data: { items: [{ ...video, contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } }] } });
    expect((await videosById(['KbrHmRU-IfU']))[0].ageRestricted).toBe(true);
  });

  it('asks for 50 ids at a time', async () => {
    mocks.get.mockResolvedValue({ data: { items: [] } });
    await videosById(Array.from({ length: 120 }, (_, index) => `id-${index}`));
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(mocks.get.mock.calls[0][1].params.id.split(',')).toHaveLength(50);
  });

  it('checks reachability for free, with no key', async () => {
    mocks.head.mockResolvedValue({});
    await youtubeReachable();
    expect(JSON.stringify(mocks.head.mock.calls[0])).not.toContain(KEY);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe('parseIsoDuration', () => {
  it.each([['PT3H12M50S', 11_570], ['PT59S', 59], ['PT1H', 3600], ['P1DT2H', 93_600], ['P0D', 0], [undefined, 0], ['nonsense', 0]])('reads %s', (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected);
  });
});
