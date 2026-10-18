import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const getRedisClient = vi.fn();
vi.mock('@/lib/redis', () => ({ getRedisClient: () => getRedisClient() }));

const { bindLiveStream, liveStreamBelongsTo } = await import('@/lib/jellyfin-playback/live-stream-binding');

beforeEach(() => {
  store.clear();
  getRedisClient.mockResolvedValue({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
  });
});

describe('live stream binding', () => {
  it('matches only the user and item the stream was opened for', async () => {
    await bindLiveStream('u1', 'ls-1', 'CHANNEL-1');
    expect(await liveStreamBelongsTo('u1', 'ls-1', 'channel-1')).toBe(true);
    expect(await liveStreamBelongsTo('u1', 'ls-1', 'movie-1')).toBe(false);
    expect(await liveStreamBelongsTo('u2', 'ls-1', 'channel-1')).toBe(false);
    expect(await liveStreamBelongsTo('u1', 'ls-unknown', 'channel-1')).toBe(false);
  });

  it('fails closed without Redis', async () => {
    getRedisClient.mockRejectedValue(new Error('down'));
    await bindLiveStream('u1', 'ls-1', 'channel-1');
    expect(await liveStreamBelongsTo('u1', 'ls-1', 'channel-1')).toBe(false);
  });
});
