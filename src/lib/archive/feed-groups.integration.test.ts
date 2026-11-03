import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));

import { serializeVideoRow } from './serialize-video';
import { feedGroups, GROUP_SIZE, GROUPS_PER_PAGE } from './feed-groups';

const USER = 'feed-groups-user';
const DAY = 86_400_000;

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('the feed by channel, against PostgreSQL', () => {
  const db = prisma!;
  const now = Date.now();
  const params = (extra: Record<string, string> = {}) => new URLSearchParams({ segment: 'all', ...extra });
  const groups = (extra?: Record<string, string>) => feedGroups('YOUTUBE', USER, params(extra), serializeVideoRow);

  async function channel(name: string, videos: Array<{ daysAgo: number; type?: 'UPLOAD' | 'ARCHIVE' | 'SHORT'; notified?: boolean }>, follow = true) {
    const creator = await db.creator.create({
      data: { platform: 'YOUTUBE', externalId: `fg-${name}`, login: name, folderName: name, displayName: name, baselinedAt: new Date(now - 30 * DAY) },
    });
    if (follow) await db.creatorSubscription.create({ data: { userId: USER, creatorId: creator.id, createdAt: new Date(now - 30 * DAY) } });
    for (const [index, video] of videos.entries()) {
      await db.creatorVideo.create({
        data: {
          platform: 'YOUTUBE', externalId: `fg-${name}-${index}`, creatorId: creator.id, type: video.type ?? 'UPLOAD', title: `${name} ${index}`,
          sourceCreatedAt: new Date(now - video.daysAgo * DAY), durationSeconds: 600,
          notifiedAt: video.notified ? new Date(now - video.daysAgo * DAY) : new Date(now - 60 * DAY),
        },
      });
    }
    return creator.id;
  }

  beforeAll(async () => {
    await db.archiveJob.deleteMany();
    await db.creator.deleteMany();
    await db.user.upsert({ where: { id: USER }, update: {}, create: { id: USER, username: USER, displayName: 'Groups' } });
    await channel('older', [{ daysAgo: 5, notified: true }, { daysAgo: 6 }]);
    await channel('newest', [{ daysAgo: 1, notified: true }, { daysAgo: 2, notified: true }, { daysAgo: 3, type: 'SHORT', notified: true }]);
    await channel('busy', Array.from({ length: 14 }, (_, index) => ({ daysAgo: 3 + index })));
    await channel('unfollowed', [{ daysAgo: 0 }], false);
    for (let index = 0; index < GROUPS_PER_PAGE; index++) await channel(`quiet-${index}`, [{ daysAgo: 40 + index }]);
  });
  afterAll(async () => {
    await db.creator.deleteMany();
    await db.user.deleteMany({ where: { id: USER } });
    await db.$disconnect();
  });

  it('puts the channel with the newest video first, and leaves out who is not followed', async () => {
    const first = await groups();
    expect(first.groups.map(({ creator }) => creator.login).slice(0, 3)).toEqual(['newest', 'busy', 'older']);
    expect(first.groups.some(({ creator }) => creator.login === 'unfollowed')).toBe(false);
  });

  it('sends each channel its newest videos, with the full count', async () => {
    const busy = (await groups()).groups.find(({ creator }) => creator.login === 'busy')!;
    expect(busy.videos).toHaveLength(GROUP_SIZE);
    expect(busy.total).toBe(14);
    expect(busy.videos[0].title).toBe('busy 0');
  });

  it('counts New the way the New filter does: announced after following, and not opened', async () => {
    const byLogin = Object.fromEntries((await groups()).groups.map((group) => [group.creator.login, group.newCount]));
    expect(byLogin).toMatchObject({ newest: 2, older: 1, busy: 0 });
  });

  it('applies the feed filters inside each channel, and drops a channel left empty', async () => {
    const shorts = await groups({ type: 'SHORT' });
    expect(shorts.groups.map(({ creator }) => creator.login)).toEqual(['newest']);
    expect(shorts.groups[0].videos.map(({ title }) => title)).toEqual(['newest 2']);
    expect(shorts.videoTotal).toBe(1);
  });

  it('leaves out what the person hid', async () => {
    const video = await db.creatorVideo.findFirstOrThrow({ where: { title: 'older 0' } });
    await db.creatorVideoState.create({ data: { userId: USER, videoId: video.id, hidden: true } });
    const older = (await groups()).groups.find(({ creator }) => creator.login === 'older')!;
    expect(older.videos.map(({ title }) => title)).toEqual(['older 1']);
    await db.creatorVideoState.deleteMany({ where: { userId: USER } });
  });

  it('pages by channel', async () => {
    const first = await groups();
    const second = await groups({ page: '2' });
    expect(first.total).toBe(3 + GROUPS_PER_PAGE);
    expect(first.groups).toHaveLength(GROUPS_PER_PAGE);
    expect(second.groups).toHaveLength(3);
    const logins = [...first.groups, ...second.groups].map(({ creator }) => creator.login);
    expect(new Set(logins).size).toBe(logins.length);
  });
});
