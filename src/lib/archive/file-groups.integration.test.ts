import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));

import { fileGroups, FILE_GROUPS_PER_PAGE, FILES_PER_GROUP } from './file-groups';

const DAY = 86_400_000;
const MB = 1024 * 1024;

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('the Library by channel, against PostgreSQL', () => {
  const db = prisma!;
  const now = Date.now();
  const groups = (extra: Record<string, string> = {}) => fileGroups('YOUTUBE', null, new URLSearchParams(extra));

  async function channel(name: string, files: Array<{ daysAgo: number; mb: number; keep?: boolean }>) {
    const creator = await db.creator.create({ data: { platform: 'YOUTUBE', externalId: `lg-${name}`, login: name, folderName: name, displayName: name } });
    for (const [index, file] of files.entries()) {
      const video = await db.creatorVideo.create({
        data: { platform: 'YOUTUBE', externalId: `lg-${name}-${index}`, creatorId: creator.id, type: 'UPLOAD', title: `${name} ${index}`, sourceCreatedAt: new Date(now), durationSeconds: 600 },
      });
      await db.archiveMediaFile.create({
        data: {
          platform: 'YOUTUBE', videoId: video.id, relativePath: `${name}/${index}.mkv`, sizeBytes: BigInt(file.mb * MB), durationSeconds: 600,
          videoCodec: 'h264', keepForever: file.keep ?? false, createdAt: new Date(now - file.daysAgo * DAY),
        },
      });
    }
  }

  beforeAll(async () => {
    await db.archiveJob.deleteMany();
    await db.archiveMediaFile.deleteMany();
    await db.creator.deleteMany();
    await channel('recent', [{ daysAgo: 1, mb: 10 }, { daysAgo: 2, mb: 20 }]);
    await channel('big', [{ daysAgo: 3, mb: 900 }, { daysAgo: 4, mb: 800, keep: true }, { daysAgo: 5, mb: 50 }, { daysAgo: 6, mb: 40 }, { daysAgo: 30, mb: 30 }]);
    await channel('old', [{ daysAgo: 60, mb: 5 }]);
    for (let index = 0; index < FILE_GROUPS_PER_PAGE; index++) await channel(`filler-${index}`, [{ daysAgo: 100 + index, mb: 1 }]);
  });
  afterAll(async () => {
    await db.archiveMediaFile.deleteMany();
    await db.creator.deleteMany();
    await db.$disconnect();
  });

  it('puts the channel with the newest download first, by default', async () => {
    expect((await groups()).groups.map(({ creator }) => creator.displayName).slice(0, 3)).toEqual(['recent', 'big', 'old']);
  });

  it('puts the channel using the most space first when sorted by size, and its biggest files first', async () => {
    const { groups: byted } = await groups({ sort: 'largest' });
    expect(byted[0].creator.displayName).toBe('big');
    expect(byted[0].files.map(({ title }) => title)).toEqual(['big 0', 'big 1', 'big 2']);
  });

  it('puts the oldest download first when asked', async () => {
    const { groups: oldest } = await groups({ sort: 'oldest' });
    expect(oldest[0].creator.displayName).toBe('filler-7');
  });

  it('sends a few files, with the totals for all of them', async () => {
    const big = (await groups()).groups.find(({ creator }) => creator.displayName === 'big')!;
    expect(big.files).toHaveLength(FILES_PER_GROUP);
    expect(big).toMatchObject({ total: 5, totalBytes: 1820 * MB });
  });

  it('applies the Library filters inside each channel, and drops a channel left empty', async () => {
    const kept = await groups({ filter: 'keep-forever' });
    expect(kept.groups.map(({ creator }) => creator.displayName)).toEqual(['big']);
    expect(kept.groups[0]).toMatchObject({ total: 1, files: [{ title: 'big 1' }] });
    expect(kept.videoTotal).toBe(1);
  });

  it('pages by channel', async () => {
    const first = await groups();
    const second = await groups({ page: '2' });
    expect(first.total).toBe(3 + FILE_GROUPS_PER_PAGE);
    expect([...first.groups, ...second.groups]).toHaveLength(3 + FILE_GROUPS_PER_PAGE);
  });
});
