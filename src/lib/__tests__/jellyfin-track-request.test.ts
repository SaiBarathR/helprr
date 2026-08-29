import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for the defect that made audio-track selection a no-op.
 *
 * Jellyfin only honours AudioStreamIndex / SubtitleStreamIndex when
 * MediaSourceId comes with them. Measured against 10.11.11 with the browser's
 * own device profile: requesting audio track 5 alone still returned a transcode
 * URL for track 1, while the same request carrying the source id returned
 * track 5. jellyfin-web always sends it — playbackmanager.js `changeStream`
 * hands `currentMediaSource.Id` to `getPlaybackInfo`, which sets
 * `query.MediaSourceId`.
 */

const post = vi.fn().mockResolvedValue({ data: {} });

vi.mock('axios', () => {
  const create = () => ({ post, delete: vi.fn(), get: vi.fn(), put: vi.fn() });
  return { default: { create, isAxiosError: () => false }, isAxiosError: () => false, create };
});

const { JellyfinClient } = await import('@/lib/jellyfin-client');

const USER_ID = 'jf-user-1';
const ITEM_ID = 'item-1';
const SOURCE_ID = 'source-1';

const base = {
  itemId: ITEM_ID,
  deviceId: 'device-1',
  deviceName: 'Helprr',
  deviceProfile: { DirectPlayProfiles: [], TranscodingProfiles: [], SubtitleProfiles: [] },
} as Parameters<InstanceType<typeof JellyfinClient>['getPlaybackInfo']>[0];

function client() {
  return new JellyfinClient('http://jellyfin.local', 'admin-key', USER_ID, undefined, 'member-token');
}

function lastCall() {
  const call = post.mock.calls.at(-1)!;
  return { body: call[1] as Record<string, unknown>, params: call[2].params as Record<string, unknown> };
}

beforeEach(() => post.mockClear());

describe('getPlaybackInfo track selection', () => {
  it('carries the media source id alongside an audio index', async () => {
    await client().getPlaybackInfo({ ...base, audioStreamIndex: 5, mediaSourceId: SOURCE_ID });
    const { body, params } = lastCall();
    expect(body.AudioStreamIndex).toBe(5);
    expect(body.MediaSourceId, 'without this Jellyfin ignores AudioStreamIndex').toBe(SOURCE_ID);
    expect(params.mediaSourceId).toBe(SOURCE_ID);
  });

  it('carries the media source id alongside a subtitle index', async () => {
    await client().getPlaybackInfo({ ...base, subtitleStreamIndex: 6, mediaSourceId: SOURCE_ID });
    const { body, params } = lastCall();
    expect(body.SubtitleStreamIndex).toBe(6);
    expect(body.MediaSourceId).toBe(SOURCE_ID);
    expect(params.subtitleStreamIndex).toBe(6);
  });

  it('sends subtitle index 0, which is a real track and not "unset"', async () => {
    await client().getPlaybackInfo({ ...base, subtitleStreamIndex: 0, mediaSourceId: SOURCE_ID });
    expect(lastCall().params.subtitleStreamIndex).toBe(0);
  });

  it('sends -1 so a burned-in subtitle can be turned back off', async () => {
    await client().getPlaybackInfo({ ...base, subtitleStreamIndex: -1, mediaSourceId: SOURCE_ID });
    const { body, params } = lastCall();
    expect(body.SubtitleStreamIndex).toBe(-1);
    expect(params.subtitleStreamIndex).toBe(-1);
  });

  it('omits the source id on a first play, where no source has been chosen yet', async () => {
    await client().getPlaybackInfo(base);
    const { params } = lastCall();
    expect(params).not.toHaveProperty('mediaSourceId');
  });
});
