import { beforeEach, describe, expect, it, vi } from 'vitest';

const { helixGet, video, streamerUpdate } = vi.hoisted(() => ({
  helixGet: vi.fn(),
  video: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  streamerUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { twitchVideo: video, twitchStreamer: { update: streamerUpdate } } }));
vi.mock('@/lib/twitch/helix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/twitch/helix')>()),
  helixGet,
}));

import { estimateExpiry } from '@/lib/twitch/expiry';
import { TwitchHelixError } from '@/lib/twitch/helix';
import { parseTwitchLogin } from '@/lib/twitch/streamers';
import { syncStreamerVideos, type HelixVideo } from '@/lib/twitch/sync';

const now = new Date('2026-10-30T12:00:00Z');
const page = (data: HelixVideo[]) => ({ data, cursor: null, rateLimit: { remaining: 700, resetAt: null } });

function helixVideo(id: string, overrides: Partial<HelixVideo> = {}): HelixVideo {
  return {
    id,
    stream_id: `stream-${id}`,
    title: `Video ${id}`,
    description: '',
    created_at: '2026-10-29T10:00:00Z',
    published_at: '2026-10-29T10:00:00Z',
    thumbnail_url: 'https://static-cdn.jtvnw.net/thumb-%{width}x%{height}.jpg',
    view_count: 5,
    language: 'en',
    type: 'archive',
    duration: '1h',
    muted_segments: null,
    ...overrides,
  };
}

function stored(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `row-${id}`,
    twitchVideoId: id,
    title: `Video ${id}`,
    durationSeconds: 3600,
    viewCount: 5,
    availability: 'PUBLISHED',
    notifiedAt: now,
    thumbnailUrl: 'https://static-cdn.jtvnw.net/thumb-%{width}x%{height}.jpg',
    twitchCreatedAt: new Date('2026-10-29T10:00:00Z'),
    missingSweeps: 0,
    ...overrides,
  };
}

const streamer = {
  id: 's1',
  twitchUserId: '100',
  broadcasterType: 'partner',
  isLive: false,
  liveStreamId: null,
  liveCategory: null,
  baselinedAt: new Date('2026-10-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  video.findMany.mockResolvedValue([]);
});

describe('syncStreamerVideos', () => {
  it('records the baseline as already notified and marks the streamer baselined', async () => {
    helixGet.mockResolvedValue(page([helixVideo('1'), helixVideo('2')]));

    const { newVideoIds } = await syncStreamerVideos({ ...streamer, baselinedAt: null }, now);

    const rows = video.createMany.mock.calls[0][0].data;
    expect(rows.map((row: { notifiedAt: Date }) => row.notifiedAt)).toEqual([now, now]);
    expect(streamerUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { baselinedAt: now } });
    expect(newVideoIds).toEqual([]);
  });

  it('leaves an archive recording at baseline unnotified, so it can notify when it publishes', async () => {
    helixGet.mockResolvedValue(page([helixVideo('1', { stream_id: 'live' })]));

    await syncStreamerVideos({ ...streamer, baselinedAt: null, isLive: true, liveStreamId: 'live' }, now);

    expect(video.createMany.mock.calls[0][0].data[0]).toMatchObject({ availability: 'RECORDING', notifiedAt: null });
  });

  it('keeps the category of a stream seen live', async () => {
    helixGet.mockResolvedValue(page([helixVideo('1', { stream_id: 'live' })]));
    await syncStreamerVideos({ ...streamer, isLive: true, liveStreamId: 'live', liveCategory: 'Elden Ring' }, now);
    expect(video.createMany.mock.calls[0][0].data[0].category).toBe('Elden Ring');
  });

  it('holds a recording back and reports it once it publishes', async () => {
    helixGet.mockResolvedValue(page([helixVideo('1', { stream_id: 'live' })]));
    video.findMany
      .mockResolvedValueOnce([stored('1', { availability: 'RECORDING', notifiedAt: null })])
      .mockResolvedValueOnce([{ id: 'row-1' }]);

    const { newVideoIds } = await syncStreamerVideos(streamer, now);

    expect(video.update.mock.calls[0][0].data.availability).toBe('PUBLISHED');
    expect(newVideoIds).toEqual(['row-1']);
    expect(video.findMany.mock.calls[1][0].where).toMatchObject({ availability: 'PUBLISHED', notifiedAt: null });
  });

  it('skips clips and unknown types, and writes nothing for an unchanged video', async () => {
    helixGet.mockResolvedValue(page([helixVideo('1'), helixVideo('2', { type: 'clip' })]));
    video.findMany.mockResolvedValueOnce([stored('1')]).mockResolvedValueOnce([]);

    await syncStreamerVideos(streamer, now);

    expect(video.createMany).not.toHaveBeenCalled();
    expect(video.update).not.toHaveBeenCalled();
    expect(video.updateMany).toHaveBeenCalledTimes(1);
  });

  it('marks a video unavailable after two missed sweeps and an empty lookup', async () => {
    helixGet
      .mockResolvedValueOnce(page([helixVideo('1')]))
      .mockRejectedValueOnce(new TwitchHelixError(404));
    video.findMany
      .mockResolvedValueOnce([stored('1'), stored('2', { missingSweeps: 1 })])
      .mockResolvedValueOnce([]);

    await syncStreamerVideos(streamer, now);

    expect(video.update).toHaveBeenCalledWith({
      where: { id: 'row-2' },
      data: { missingSweeps: 2, availability: 'UNAVAILABLE' },
    });
  });

  it('counts a first miss without any extra Helix call', async () => {
    helixGet.mockResolvedValueOnce(page([helixVideo('1')]));
    video.findMany.mockResolvedValueOnce([stored('1'), stored('2')]).mockResolvedValueOnce([]);

    await syncStreamerVideos(streamer, now);

    expect(helixGet).toHaveBeenCalledTimes(1);
    expect(video.update).toHaveBeenCalledWith({ where: { id: 'row-2' }, data: { missingSweeps: 1 } });
  });

  it('keeps a missing video that is still found by id', async () => {
    helixGet.mockResolvedValueOnce(page([helixVideo('1')])).mockResolvedValueOnce(page([helixVideo('2')]));
    video.findMany
      .mockResolvedValueOnce([stored('1'), stored('2', { missingSweeps: 1 })])
      .mockResolvedValueOnce([]);

    await syncStreamerVideos(streamer, now);

    expect(video.update).toHaveBeenCalledWith({ where: { id: 'row-2' }, data: { missingSweeps: 0, lastSeenAt: now } });
  });

  it('ignores videos older than a full page, which are only out of view', async () => {
    const full = Array.from({ length: 100 }, (_, index) => helixVideo(String(index)));
    helixGet.mockResolvedValueOnce(page(full));
    video.findMany
      .mockResolvedValueOnce([stored('old', { twitchCreatedAt: new Date('2025-01-01T00:00:00Z'), missingSweeps: 5 })])
      .mockResolvedValueOnce([]);

    await syncStreamerVideos(streamer, now);

    expect(video.update).not.toHaveBeenCalled();
  });
});

describe('estimateExpiry', () => {
  const created = new Date('2026-10-01T00:00:00Z');

  it.each([
    ['partner', '2026-11-30T00:00:00.000Z'],
    ['affiliate', '2026-10-15T00:00:00.000Z'],
    ['', '2026-10-08T00:00:00.000Z'],
  ])('uses the %s retention', (type, expected) => {
    expect(estimateExpiry('ARCHIVE', created, type)?.toISOString()).toBe(expected);
  });

  it('gives highlights and uploads no expiry', () => {
    expect(estimateExpiry('HIGHLIGHT', created, 'partner')).toBeNull();
    expect(estimateExpiry('UPLOAD', created, '')).toBeNull();
  });
});

describe('parseTwitchLogin', () => {
  it.each([
    ['xQc', 'xqc'],
    ['@xqc', 'xqc'],
    ['https://www.twitch.tv/xqc', 'xqc'],
    ['twitch.tv/xqc/videos?filter=archives', 'xqc'],
    ['https://m.twitch.tv/some_name', 'some_name'],
  ])('reads %s', (input, login) => {
    expect(parseTwitchLogin(input)).toBe(login);
  });

  it.each(['', '../etc', 'a/b', 'https://www.twitch.tv/videos/123', 'https://evil.example/xqc', 'name with space'])(
    'refuses %s',
    (input) => {
      expect(parseTwitchLogin(input)).toBeNull();
    },
  );
});
