import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for two bugs that only live traffic exposed:
 *  - stopActiveEncodings used POST /Videos/ActiveEncodings/Stop and got 405 from
 *    Jellyfin, so every transcode was left running.
 *  - reportPlayback sent properties no Jellyfin playback model declares, and the
 *    session it reports against carries no user (admin API key), so resume
 *    position was never persisted.
 * Both are verified against the server's own OpenAPI contract.
 */

const post = vi.fn().mockResolvedValue({ data: {} });
const del = vi.fn().mockResolvedValue({ data: {} });

vi.mock('axios', () => {
  const create = () => ({ post, delete: del, get: vi.fn(), put: vi.fn() });
  return { default: { create, isAxiosError: () => false }, isAxiosError: () => false, create };
});

const { JellyfinClient } = await import('@/lib/jellyfin-client');

const USER_ID = 'jf-user-1';
const ITEM_ID = 'item-1';

function client() {
  return new JellyfinClient('http://jellyfin.local', 'admin-key', USER_ID);
}

function bodyFor(path: string): Record<string, unknown> | null {
  const call = post.mock.calls.find((c) => c[0] === path);
  return (call?.[1] as Record<string, unknown>) ?? null;
}

// Exactly what PlaybackStartInfo / PlaybackProgressInfo declare.
const SESSION_MODEL_KEYS = new Set([
  'AspectRatio', 'AudioStreamIndex', 'Brightness', 'CanSeek', 'IsMuted', 'IsPaused', 'Item',
  'ItemId', 'LiveStreamId', 'MediaSourceId', 'NowPlayingQueue', 'PlayMethod', 'PlaySessionId',
  'PlaybackOrder', 'PlaybackStartTimeTicks', 'PlaylistItemId', 'PositionTicks', 'RepeatMode',
  'SessionId', 'SubtitleStreamIndex', 'VolumeLevel',
]);
const STOP_MODEL_KEYS = new Set([
  'Failed', 'Item', 'ItemId', 'LiveStreamId', 'MediaSourceId', 'NextMediaType',
  'NowPlayingQueue', 'PlaySessionId', 'PlaylistItemId', 'PositionTicks', 'SessionId',
]);

const base = {
  deviceId: 'device-1',
  deviceName: 'Helprr',
  itemId: ITEM_ID,
  mediaSourceId: 'src-1',
  playSessionId: 'ps-1',
  positionTicks: 9_000_000_000,
  playMethod: 'Transcode' as const,
};

beforeEach(() => {
  post.mockClear();
  del.mockClear();
});

describe('stopActiveEncodings', () => {
  it('uses DELETE /Videos/ActiveEncodings with both required params', async () => {
    await client().stopActiveEncodings('ps-1', 'device-1', 'Helprr');
    expect(post).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(1);
    const [path, config] = del.mock.calls[0];
    expect(path).toBe('/Videos/ActiveEncodings');
    expect(config.params).toEqual({ deviceId: 'device-1', playSessionId: 'ps-1' });
  });
});

describe('reportPlayback', () => {
  it('sends only properties the start/progress model declares', async () => {
    await client().reportPlayback({ ...base, event: 'playing' });
    const body = bodyFor('/Sessions/Playing');
    expect(body).not.toBeNull();
    expect(Object.keys(body!).filter((k) => !SESSION_MODEL_KEYS.has(k))).toEqual([]);
  });

  it('drops the properties Jellyfin 400s on', async () => {
    await client().reportPlayback({
      ...base, event: 'progress', playbackRate: 1.5, maxStreamingBitrate: 20_000_000, shuffleMode: 'Shuffle',
    });
    const body = bodyFor('/Sessions/Playing/Progress')!;
    expect(body).not.toHaveProperty('PlaybackRate');
    expect(body).not.toHaveProperty('MaxStreamingBitrate');
    expect(body).not.toHaveProperty('ShuffleMode');
    expect(body).not.toHaveProperty('EventName');
    // Shuffle travels as PlaybackOrder instead.
    expect(body.PlaybackOrder).toBe('Shuffle');
  });

  it('sends the narrower stop model, not the progress one', async () => {
    await client().reportPlayback({ ...base, event: 'stopped' });
    const body = bodyFor('/Sessions/Playing/Stopped')!;
    expect(Object.keys(body).filter((k) => !STOP_MODEL_KEYS.has(k))).toEqual([]);
    expect(body).not.toHaveProperty('PlayMethod');
    expect(body).not.toHaveProperty('RepeatMode');
  });

  it('persists resume position against the member account, not the admin session', async () => {
    await client().reportPlayback({ ...base, event: 'progress' });
    const call = post.mock.calls.find((c) => c[0] === `/UserItems/${ITEM_ID}/UserData`);
    expect(call, 'progress must write user data or Resume never updates').toBeDefined();
    expect(call![1]).toEqual({ PlaybackPositionTicks: base.positionTicks });
    expect(call![2].params).toEqual({ userId: USER_ID });
  });

  it('writes user data on stop as well', async () => {
    await client().reportPlayback({ ...base, event: 'stopped' });
    expect(post.mock.calls.some((c) => c[0] === `/UserItems/${ITEM_ID}/UserData`)).toBe(true);
  });

  it('does not write user data on the initial playing event', async () => {
    await client().reportPlayback({ ...base, event: 'playing' });
    expect(post.mock.calls.some((c) => c[0] === `/UserItems/${ITEM_ID}/UserData`)).toBe(false);
  });

  it('still reports the session when the user-data write fails', async () => {
    post.mockImplementationOnce(() => Promise.reject(new Error('user data down')));
    await client().reportPlayback({ ...base, event: 'progress' });
    expect(post.mock.calls.some((c) => c[0] === '/Sessions/Playing/Progress')).toBe(true);
  });

  it('rounds fractional position ticks, which Jellyfin models as int64', async () => {
    await client().reportPlayback({ ...base, event: 'progress', positionTicks: 123.7 });
    expect(bodyFor('/Sessions/Playing/Progress')!.PositionTicks).toBe(124);
  });
});
