import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const getRedisClient = vi.fn();
const expire = vi.fn(async () => 1);
vi.mock('@/lib/redis', () => ({ getRedisClient: () => getRedisClient() }));

const { bindLiveStream, bindPlaySession, liveStreamBelongsTo, playSessionBelongsTo } = await import('@/lib/jellyfin-playback/live-stream-binding');

beforeEach(() => {
  store.clear();
  getRedisClient.mockResolvedValue({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
    expire: expire,
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

  it('keeps a binding in use alive', async () => {
    await bindLiveStream('u1', 'ls-3', 'channel-3');
    expire.mockClear();
    await liveStreamBelongsTo('u1', 'ls-3', 'channel-3');
    expect(expire).toHaveBeenCalledWith('jellyfin:live-stream:u1:ls3', 12 * 60 * 60);
    expire.mockClear();
    await liveStreamBelongsTo('u1', 'ls-3', 'movie-1');
    expect(expire).not.toHaveBeenCalled();
  });

  it('treats the dashed GUID form of an id as the same item', async () => {
    await bindLiveStream('u1', 'ls-2', 'cf48421ddae2e64ad06216e009d1615b');
    expect(await liveStreamBelongsTo('u1', 'ls-2', 'cf48421d-dae2-e64a-d062-16e009d1615b')).toBe(true);
  });

  it('binds play sessions the same way, apart from live streams', async () => {
    await bindPlaySession('u1', 'ABCDEF0123', 'movie-1');
    expect(await playSessionBelongsTo('u1', 'abcdef0123', 'movie-1')).toBe(true);
    expect(await playSessionBelongsTo('u1', 'abcdef0123', 'channel-1')).toBe(false);
    expect(await playSessionBelongsTo('u2', 'abcdef0123', 'movie-1')).toBe(false);
    expect(await liveStreamBelongsTo('u1', 'abcdef0123', 'movie-1')).toBe(false);
  });

  it('fails closed without Redis', async () => {
    getRedisClient.mockRejectedValue(new Error('down'));
    await bindLiveStream('u1', 'ls-1', 'channel-1');
    expect(await liveStreamBelongsTo('u1', 'ls-1', 'channel-1')).toBe(false);
  });
});
