import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const api = vi.hoisted(() => ({ playlistById: vi.fn(), playlistItems: vi.fn(), videosById: vi.fn(), channelById: vi.fn() }));

vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/youtube/api', async (original) => ({ ...await original<typeof import('@/lib/youtube/api')>(), ...api }));

import type { YoutubeVideo } from '@/lib/youtube/api';
import { followPlaylist, syncPlaylist } from './playlists';

const LIST = 'PLabcdefghijklmnop';
const FOLLOWED = 'UCfollowedfollowedfollow';
const STRANGER = 'UCstrangerstrangerstrang';
const FIRST = new Date('2026-11-01T00:00:00Z');
const LATER = new Date('2026-11-01T00:10:00Z');

function video(id: string, channelId: string, extra: Partial<YoutubeVideo> = {}): YoutubeVideo {
  return {
    id, channelId, channelTitle: 'Someone', title: `Title of ${id}`, description: null,
    publishedAt: new Date('2026-10-30T00:00:00Z'), durationSeconds: 1200, thumbnailUrl: null, viewCount: 1,
    liveState: 'none', liveEndedAt: null, wasLive: false, ageRestricted: false, ...extra,
  };
}

let listed: YoutubeVideo[] = [];
let hidden: string[] = [];

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('syncing a playlist against PostgreSQL', () => {
  const db = prisma!;
  let userId = '';
  const stored = () => db.creatorPlaylist.findFirstOrThrow({ where: { externalId: LIST } });
  const row = (externalId: string) => db.creatorVideo.findUniqueOrThrow({
    where: { platform_externalId: { platform: 'YOUTUBE', externalId } },
  });
  const members = async () => (await db.creatorPlaylistVideo.findMany({
    where: { playlist: { externalId: LIST } },
    orderBy: { position: 'asc' },
    select: { video: { select: { externalId: true } } },
  })).map((member) => member.video.externalId);

  beforeEach(async () => {
    listed = [];
    hidden = [];
    await db.creatorPlaylist.deleteMany({ where: { platform: 'YOUTUBE' } });
    await db.creator.deleteMany({ where: { platform: 'YOUTUBE' } });
    await db.user.deleteMany({ where: { username: 'playlist-test' } });
    userId = (await db.user.create({ data: { username: 'playlist-test', displayName: 'Test' } })).id;
    const channel = await db.creator.create({
      data: { platform: 'YOUTUBE', externalId: FOLLOWED, login: 'followed', folderName: 'followed', displayName: 'Followed' },
    });
    await db.creatorSubscription.create({ data: { userId, creatorId: channel.id } });
    vi.clearAllMocks();
    api.playlistById.mockImplementation(async (id: string) => (id === LIST ? {
      id: LIST, title: 'Best of', ownerName: 'Someone', description: null, thumbnailUrl: null, itemCount: listed.length + hidden.length,
    } : null));
    api.playlistItems.mockImplementation(async () => ({
      items: [...listed.map((entry) => entry.id), ...hidden].map((videoId, position) => ({ videoId, position, title: '' })),
      total: listed.length,
      nextPageToken: null,
    }));
    api.videosById.mockImplementation(async (ids: string[]) => listed.filter((entry) => ids.includes(entry.id)));
    api.channelById.mockImplementation(async (id: string) => ({
      id, title: 'A Stranger', handle: '@stranger', description: null, avatarUrl: null, bannerUrl: null, uploadsPlaylistId: null,
    }));
  });
  afterAll(async () => {
    await db.creatorPlaylist.deleteMany({ where: { platform: 'YOUTUBE' } });
    await db.creator.deleteMany({ where: { platform: 'YOUTUBE' } });
    await db.user.deleteMany({ where: { username: 'playlist-test' } });
    await db.$disconnect();
  });

  it('follows a list silently, keeping channels nobody follows out of the poll', async () => {
    listed = [video('aaaaaaaaaaa', FOLLOWED), video('bbbbbbbbbbb', STRANGER)];

    await followPlaylist(userId, LIST);

    expect(await members()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect((await stored()).baselinedAt).not.toBeNull();
    const stranger = await db.creator.findFirstOrThrow({ where: { externalId: STRANGER }, include: { subscriptions: true } });
    expect(stranger).toMatchObject({ folderName: 'stranger', subscriptions: [] });
  });

  it('returns nothing for a private list, and stores nothing', async () => {
    expect(await followPlaylist(userId, 'PLsomethingprivate00')).toBeNull();
    expect(await db.creatorPlaylist.count({ where: { platform: 'YOUTUBE' } })).toBe(0);
  });

  it('spends one unit on an idle list, however long it is', async () => {
    listed = [video('aaaaaaaaaaa', STRANGER)];
    await followPlaylist(userId, LIST);
    vi.clearAllMocks();

    expect(await syncPlaylist(await stored(), LATER)).toEqual({ newVideoIds: [] });

    expect(api.playlistById).toHaveBeenCalledTimes(1);
    expect(api.playlistItems).not.toHaveBeenCalled();
    expect(api.videosById).not.toHaveBeenCalled();
  });

  it('calls a later item new, once, and only that one', async () => {
    listed = [video('aaaaaaaaaaa', STRANGER)];
    await followPlaylist(userId, LIST);
    listed = [...listed, video('bbbbbbbbbbb', STRANGER)];

    const { newVideoIds } = await syncPlaylist(await stored(), LATER);

    expect(newVideoIds).toEqual([(await row('bbbbbbbbbbb')).id]);
    expect(await syncPlaylist(await stored(), LATER)).toEqual({ newVideoIds: [] });
  });

  it('leaves a followed channel to announce its own video, and marks the rest as told', async () => {
    listed = [video('aaaaaaaaaaa', STRANGER)];
    await followPlaylist(userId, LIST);
    listed = [...listed, video('fffffffffff', FOLLOWED), video('sssssssssss', STRANGER)];

    await syncPlaylist(await stored(), LATER);

    expect((await row('fffffffffff')).notifiedAt).toBeNull();
    expect((await row('sssssssssss')).notifiedAt).toEqual(LATER);
  });

  it("records a followed channel's older videos as told on the list's first sweep, so its own sweep does not announce them", async () => {
    listed = [video('fffffffffff', FOLLOWED), video('sssssssssss', STRANGER)];

    await followPlaylist(userId, LIST);

    expect((await row('fffffffffff')).notifiedAt).not.toBeNull();
    expect((await row('sssssssssss')).notifiedAt).not.toBeNull();
  });

  it('uses the stored video when a channel already found it, so one video stays one row', async () => {
    const channel = await db.creator.findFirstOrThrow({ where: { externalId: FOLLOWED } });
    const existing = await db.creatorVideo.create({
      data: {
        platform: 'YOUTUBE', externalId: 'aaaaaaaaaaa', creatorId: channel.id, type: 'UPLOAD', title: 'Already here',
        sourceCreatedAt: FIRST, durationSeconds: 60,
      },
    });
    listed = [video('aaaaaaaaaaa', FOLLOWED)];

    await followPlaylist(userId, LIST);

    expect(api.videosById).toHaveBeenCalledWith([]);
    expect((await row('aaaaaaaaaaa')).id).toBe(existing.id);
    expect(await members()).toEqual(['aaaaaaaaaaa']);
  });

  it('drops a removed video from the list only, keeping its row', async () => {
    listed = [video('aaaaaaaaaaa', STRANGER), video('bbbbbbbbbbb', STRANGER)];
    await followPlaylist(userId, LIST);
    listed = [video('aaaaaaaaaaa', STRANGER)];

    await syncPlaylist(await stored(), LATER);

    expect(await members()).toEqual(['aaaaaaaaaaa']);
    expect((await row('bbbbbbbbbbb')).availability).toBe('PUBLISHED');
  });

  it('skips a hidden item, which has no details to store', async () => {
    listed = [video('aaaaaaaaaaa', STRANGER)];
    hidden = ['hhhhhhhhhhh'];

    await followPlaylist(userId, LIST);

    expect(await members()).toEqual(['aaaaaaaaaaa']);
  });

  it('keeps the list in the order YouTube gives after a change', async () => {
    listed = [video('aaaaaaaaaaa', STRANGER), video('bbbbbbbbbbb', STRANGER)];
    await followPlaylist(userId, LIST);
    listed = [video('ccccccccccc', STRANGER), video('bbbbbbbbbbb', STRANGER), video('aaaaaaaaaaa', STRANGER)];

    await syncPlaylist(await stored(), LATER);

    expect(await members()).toEqual(['ccccccccccc', 'bbbbbbbbbbb', 'aaaaaaaaaaa']);
  });

  it('takes a new silent baseline when a list nobody watched is followed again', async () => {
    listed = [video('aaaaaaaaaaa', STRANGER)];
    const { subscription } = (await followPlaylist(userId, LIST))!;
    await db.creatorPlaylistSubscription.delete({ where: { id: subscription.id } });
    const before = (await stored()).baselinedAt!;
    listed = [...listed, video('bbbbbbbbbbb', STRANGER)];

    await followPlaylist(userId, LIST);

    expect((await stored()).baselinedAt!.getTime()).toBeGreaterThan(before.getTime());
    expect(await members()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });
});
