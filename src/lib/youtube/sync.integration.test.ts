import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const api = vi.hoisted(() => ({ playlistItems: vi.fn(), videosById: vi.fn() }));

vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/youtube/api', async (original) => ({
  ...await original<typeof import('@/lib/youtube/api')>(),
  playlistItems: api.playlistItems,
  videosById: api.videosById,
}));

import type { YoutubeVideo } from '@/lib/youtube/api';
import { syncChannelVideos } from './sync';

const CHANNEL = 'UCVlfe3MRSCZSeIWByrWHhkg';
const UPLOADS = `UU${CHANNEL.slice(2)}`;
const SHORTS = `UUSH${CHANNEL.slice(2)}`;
const FIRST = new Date('2026-11-01T00:00:00Z');
const LATER = new Date('2026-11-01T00:10:00Z');

function video(id: string, extra: Partial<YoutubeVideo> = {}): YoutubeVideo {
  return {
    id, channelId: CHANNEL, channelTitle: 'WAN Show', title: `Title of ${id}`, description: null,
    publishedAt: new Date('2026-10-30T00:00:00Z'), durationSeconds: 1200, thumbnailUrl: null, viewCount: 1,
    liveState: 'none', liveEndedAt: null, wasLive: false, ageRestricted: false, ...extra,
  };
}

// What YouTube says exists right now. Each test sets it, then sweeps.
let uploads: YoutubeVideo[] = [];
let shorts: string[] | null = [];
const item = (entry: YoutubeVideo, position: number) => ({ videoId: entry.id, position, title: entry.title });

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('syncing a channel against PostgreSQL', () => {
  const db = prisma!;
  const channel = () => db.creator.findFirstOrThrow({ where: { platform: 'YOUTUBE', externalId: CHANNEL } });
  const row = (externalId: string) => db.creatorVideo.findUniqueOrThrow({
    where: { platform_externalId: { platform: 'YOUTUBE', externalId } },
  });
  const sweep = async (now: Date) => syncChannelVideos(await channel(), now);

  beforeEach(async () => {
    uploads = [];
    shorts = [];
    await db.creator.deleteMany({ where: { platform: 'YOUTUBE' } });
    await db.creator.create({
      data: { platform: 'YOUTUBE', externalId: CHANNEL, login: 'wanshowyt', folderName: 'wanshowyt', displayName: 'WAN Show' },
    });
    api.playlistItems.mockReset();
    api.videosById.mockReset();
    api.playlistItems.mockImplementation(async (list: string) => {
      if (list === UPLOADS) return { items: uploads.map(item), total: uploads.length, nextPageToken: null };
      if (list === SHORTS && shorts) return { items: shorts.map((videoId, position) => ({ videoId, position, title: '' })), total: shorts.length, nextPageToken: null };
      return null;
    });
    api.videosById.mockImplementation(async (ids: string[]) => uploads.filter((entry) => ids.includes(entry.id)));
  });
  afterAll(async () => {
    await db.creator.deleteMany({ where: { platform: 'YOUTUBE' } });
    await db.$disconnect();
  });

  it('records what already exists without calling it new', async () => {
    uploads = [video('aaaaaaaaaaa'), video('bbbbbbbbbbb')];

    expect(await sweep(FIRST)).toEqual({ newVideoIds: [] });

    expect(await row('aaaaaaaaaaa')).toMatchObject({ type: 'UPLOAD', availability: 'PUBLISHED', notifiedAt: FIRST });
    expect((await channel()).baselinedAt).toEqual(FIRST);
  });

  it('calls a later upload new, and spends nothing on what it knows', async () => {
    uploads = [video('aaaaaaaaaaa')];
    await sweep(FIRST);
    api.videosById.mockClear();
    uploads = [video('ccccccccccc'), video('aaaaaaaaaaa')];

    const { newVideoIds } = await sweep(LATER);

    expect(newVideoIds).toEqual([(await row('ccccccccccc')).id]);
    expect(api.videosById).toHaveBeenCalledTimes(1);
    expect(api.videosById).toHaveBeenCalledWith(['ccccccccccc']);
  });

  it('spends no videos call at all on an idle channel', async () => {
    uploads = [video('aaaaaaaaaaa')];
    await sweep(FIRST);
    api.videosById.mockClear();
    api.videosById.mockResolvedValue([]);

    await sweep(LATER);

    expect(api.videosById.mock.calls.every(([ids]) => ids.length === 0)).toBe(true);
  });

  it('tells a Short from a short video, using the list only when it could matter', async () => {
    uploads = [video('sssssssssss', { durationSeconds: 45 }), video('mmmmmmmmmmm', { durationSeconds: 150 })];
    shorts = ['sssssssssss'];
    await sweep(FIRST);
    expect((await row('sssssssssss')).type).toBe('SHORT');
    expect((await row('mmmmmmmmmmm')).type).toBe('UPLOAD');

    api.playlistItems.mockClear();
    uploads = [video('lllllllllll'), ...uploads];
    await sweep(LATER);
    expect(api.playlistItems).toHaveBeenCalledTimes(1);
  });

  it('falls back to length when the Shorts list is gone', async () => {
    uploads = [video('sssssssssss', { durationSeconds: 45 }), video('mmmmmmmmmmm', { durationSeconds: 150 })];
    shorts = null;
    await sweep(FIRST);
    expect((await row('sssssssssss')).type).toBe('SHORT');
    expect((await row('mmmmmmmmmmm')).type).toBe('UPLOAD');
  });

  it('holds a stream until it ends, then calls the replay new', async () => {
    uploads = [video('aaaaaaaaaaa')];
    await sweep(FIRST);
    uploads = [video('wwwwwwwwwww', { liveState: 'live', durationSeconds: 0, wasLive: true }), video('aaaaaaaaaaa')];

    expect(await sweep(LATER)).toEqual({ newVideoIds: [] });
    expect(await row('wwwwwwwwwww')).toMatchObject({ type: 'ARCHIVE', availability: 'RECORDING', notifiedAt: null });

    const ended = new Date('2026-11-01T04:00:00Z');
    uploads = [video('wwwwwwwwwww', { wasLive: true, durationSeconds: 11_000, liveEndedAt: ended }), video('aaaaaaaaaaa')];
    const { newVideoIds } = await sweep(new Date('2026-11-01T04:10:00Z'));

    expect(newVideoIds).toEqual([(await row('wwwwwwwwwww')).id]);
    expect(await row('wwwwwwwwwww')).toMatchObject({ type: 'ARCHIVE', availability: 'PUBLISHED', durationSeconds: 11_000, liveEndedAt: ended });
  });

  it('does not treat a stream in the baseline as already announced', async () => {
    uploads = [video('wwwwwwwwwww', { liveState: 'upcoming', durationSeconds: 0 })];
    await sweep(FIRST);
    expect(await row('wwwwwwwwwww')).toMatchObject({ availability: 'RECORDING', notifiedAt: null });
    expect(api.playlistItems).toHaveBeenCalledTimes(1);
  });

  it('follows a new title for free, and ignores the placeholder for a hidden video', async () => {
    uploads = [video('aaaaaaaaaaa'), video('bbbbbbbbbbb')];
    await sweep(FIRST);
    uploads = [video('aaaaaaaaaaa', { title: 'A better title' }), video('bbbbbbbbbbb', { title: 'Private video' })];

    await sweep(LATER);

    expect((await row('aaaaaaaaaaa')).title).toBe('A better title');
    expect((await row('bbbbbbbbbbb')).title).toBe('Title of bbbbbbbbbbb');
  });

  it('marks a removed video only after a second miss and a lookup, keeping its row', async () => {
    uploads = [video('aaaaaaaaaaa'), video('bbbbbbbbbbb')];
    await sweep(FIRST);
    uploads = [video('aaaaaaaaaaa')];

    await sweep(LATER);
    expect(await row('bbbbbbbbbbb')).toMatchObject({ availability: 'PUBLISHED', missingSweeps: 1 });

    await sweep(new Date('2026-11-01T00:20:00Z'));
    expect((await row('bbbbbbbbbbb')).availability).toBe('UNAVAILABLE');
  });

  it('believes the lookup over an empty list, so a bad answer removes nothing', async () => {
    const kept = video('aaaaaaaaaaa');
    uploads = [kept];
    await sweep(FIRST);
    uploads = [];
    api.videosById.mockImplementation(async () => [kept]);

    await sweep(LATER);
    await sweep(new Date('2026-11-01T00:20:00Z'));

    expect(await row('aaaaaaaaaaa')).toMatchObject({ availability: 'PUBLISHED', missingSweeps: 0 });
  });

  it('never judges a video older than the page it can see', async () => {
    uploads = [video('ooooooooooo', { publishedAt: new Date('2020-01-01T00:00:00Z') })];
    await sweep(FIRST);
    uploads = Array.from({ length: 50 }, (_, index) => video(`n${String(index).padStart(10, '0')}`));

    await sweep(LATER);
    await sweep(new Date('2026-11-01T00:20:00Z'));

    expect(await row('ooooooooooo')).toMatchObject({ availability: 'PUBLISHED', missingSweeps: 0 });
  });
});
