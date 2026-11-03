import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), channel: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: { creatorPolicy: { findUnique: mocks.channel }, creatorPlaylist: { findUnique: mocks.list } },
}));
vi.mock('@/lib/youtube/settings', () => ({ getYoutubeSettings: mocks.settings }));

import { BUILT_IN_POLICY, layerMap, sanitizeLayer } from '@/lib/archive/policy';
import { decideForYoutubeVideo, optionsFromPolicy, settleTime, YOUTUBE_BUILT_IN_POLICY } from './policy';

const video = { title: 'An episode', durationSeconds: 3600, type: 'UPLOAD' as const, creatorId: 'c' };

function stored({ global = {}, types = {}, channel = {}, channelTypes = {}, on = true }: Record<string, unknown> = {}) {
  mocks.settings.mockResolvedValue({ defaultPolicy: global, typePolicies: types, autoDownloadEnabled: on });
  mocks.channel.mockResolvedValue({ policy: channel, typePolicies: channelTypes });
}

describe('YouTube rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue(null);
    stored();
  });

  it('starts from the common choice, downloading nothing by itself', async () => {
    const { policy, autoDownloadReason } = await decideForYoutubeVideo(video);
    expect(policy).toMatchObject({
      autoDownload: false, quality: '1080', codec: 'compatible', captions: true, sponsorblock: 'mark', reencode: false, chat: false, delayMinutes: 180,
    });
    expect(autoDownloadReason).toBe('off by default');
  });

  it('leaves Twitch built-in values as they were', () => {
    expect(BUILT_IN_POLICY.quality).toBe('1080p60');
    expect(BUILT_IN_POLICY).not.toHaveProperty('sponsorblock');
    expect(YOUTUBE_BUILT_IN_POLICY.quality).toBe('1080');
  });

  it('applies each layer in order, most specific last', async () => {
    stored({
      global: { quality: '720', codec: 'vp9' },
      types: { UPLOAD: { quality: '1080', sponsorblock: 'off' } },
      channel: { quality: '1440', captions: false },
      channelTypes: { UPLOAD: { quality: '2160' } },
    });
    mocks.list.mockResolvedValue({ policy: { keepForever: true } });

    const { policy, trace } = await decideForYoutubeVideo(video, { playlistId: 'p' });

    expect(policy).toMatchObject({ quality: '2160', codec: 'vp9', sponsorblock: 'off', captions: false, keepForever: true });
    expect(trace).toMatchObject({ quality: 'streamerType', codec: 'global', sponsorblock: 'type', captions: 'streamer', keepForever: 'playlist' });
  });

  it('gives a Short its own layer', async () => {
    stored({ channel: { autoDownload: true }, channelTypes: { SHORT: { autoDownload: false } } });
    expect((await decideForYoutubeVideo({ ...video, type: 'SHORT' })).policy.autoDownload).toBe(false);
    expect((await decideForYoutubeVideo(video)).policy.autoDownload).toBe(true);
  });

  it('lets the master switch overrule every layer', async () => {
    stored({ on: false, channel: { autoDownload: true } });
    const { policy, autoDownloadReason } = await decideForYoutubeVideo(video);
    expect(policy.autoDownload).toBe(false);
    expect(autoDownloadReason).toBe('master-switch');
  });

  it('applies conditions, by keyword', async () => {
    stored({ channel: { autoDownload: true, conditions: { titleExclude: ['episode'] } } });
    const { policy, autoDownloadReason } = await decideForYoutubeVideo(video);
    expect(policy.autoDownload).toBe(false);
    expect(autoDownloadReason).toContain('episode');
  });

  it('tries an unsaved draft instead of the stored rules', async () => {
    stored({ channel: { autoDownload: false } });
    const { policy } = await decideForYoutubeVideo(video, { channel: { autoDownload: true } });
    expect(policy.autoDownload).toBe(true);
  });

  it('hands the worker only download options', () => {
    expect(Object.keys(optionsFromPolicy(YOUTUBE_BUILT_IN_POLICY)).sort()).toEqual(
      ['captions', 'chapters', 'chat', 'codec', 'keepForever', 'quality', 'reencode', 'sponsorblock'],
    );
  });
});

describe('stored rule values', () => {
  it('keeps the new fields when they are fixed choices', () => {
    expect(sanitizeLayer({ codec: 'av1', sponsorblock: 'remove', captions: false, delayMinutes: 60 }))
      .toEqual({ codec: 'av1', sponsorblock: 'remove', captions: false, delayMinutes: 60 });
  });

  it('drops anything else, so a stored rule cannot reach a yt-dlp argument', () => {
    expect(sanitizeLayer({ codec: 'x;rm', sponsorblock: 'all', delayMinutes: -1, captions: 'yes' })).toEqual({});
    expect(sanitizeLayer({ delayMinutes: 99_999 })).toEqual({});
  });

  it('keeps a Short layer', () => {
    expect(layerMap({ SHORT: { autoDownload: false } })).toEqual({ SHORT: { autoDownload: false } });
  });
});

describe('settleTime', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const published = new Date('2026-11-01T11:00:00Z');

  it('waits from publishing', () => {
    expect(settleTime({ sourceCreatedAt: published, liveEndedAt: null }, { delayMinutes: 180 }, now)).toEqual(new Date('2026-11-01T14:00:00Z'));
  });

  it('waits from the end of a stream, which comes later', () => {
    const liveEndedAt = new Date('2026-11-01T11:45:00Z');
    expect(settleTime({ sourceCreatedAt: published, liveEndedAt }, { delayMinutes: 180 }, now)).toEqual(new Date('2026-11-01T14:45:00Z'));
  });

  it('starts now when the wait has already passed', () => {
    const old = new Date('2026-10-01T00:00:00Z');
    expect(settleTime({ sourceCreatedAt: old, liveEndedAt: null }, { delayMinutes: 180 }, now)).toEqual(now);
  });
});
