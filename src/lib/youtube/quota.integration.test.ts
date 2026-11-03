import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
const get = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ get prisma() { return prisma; } }));
vi.mock('@/lib/twitch/token-cipher', () => ({ decryptTwitchToken: () => 'not-a-real-key' }));
vi.mock('axios', async (original) => {
  const actual = await original<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get } };
});

import { channelById, DAILY_QUOTA, DAILY_SEARCHES, pacificDay, searchChannels, YoutubeQuotaError } from './api';

const TOGETHER = 30;

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('YouTube quota against PostgreSQL', () => {
  const db = prisma!;
  const seed = (data: { quotaDay: string | null; quotaUsed: number; quotaSearches: number }) => (
    db.youtubeSettings.upsert({ where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data } })
  );
  const counts = () => db.youtubeSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  const together = (request: () => Promise<unknown>) => Promise.allSettled(Array.from({ length: TOGETHER }, request));

  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { items: [] } });
  });
  afterAll(async () => {
    await db.youtubeSettings.deleteMany();
    await db.$disconnect();
  });

  it('loses no count when requests run together', async () => {
    await seed({ quotaDay: pacificDay(), quotaUsed: 100, quotaSearches: 0 });
    await together(() => channelById('UCVlfe3MRSCZSeIWByrWHhkg'));
    expect((await counts()).quotaUsed).toBe(100 + TOGETHER);
  });

  it('lets through only the room that is left', async () => {
    const room = 10;
    await seed({ quotaDay: pacificDay(), quotaUsed: DAILY_QUOTA * 0.95 - room, quotaSearches: 0 });
    const results = await together(() => channelById('UCVlfe3MRSCZSeIWByrWHhkg'));
    const stopped = results.filter((result) => result.status === 'rejected');

    expect(results.length - stopped.length).toBe(room);
    expect(stopped.every((result) => result.reason instanceof YoutubeQuotaError)).toBe(true);
    expect(get).toHaveBeenCalledTimes(room);
    expect((await counts()).quotaUsed).toBe(DAILY_QUOTA * 0.95);
  });

  it('starts a new day once, however many requests arrive at midnight', async () => {
    await seed({ quotaDay: '2020-01-01', quotaUsed: 9_000, quotaSearches: 90 });
    await together(() => channelById('UCVlfe3MRSCZSeIWByrWHhkg'));
    expect(await counts()).toMatchObject({ quotaDay: pacificDay(), quotaUsed: TOGETHER, quotaSearches: 0 });
  });

  it('starts counting on a fresh row', async () => {
    await seed({ quotaDay: null, quotaUsed: 0, quotaSearches: 0 });
    await channelById('UCVlfe3MRSCZSeIWByrWHhkg');
    expect(await counts()).toMatchObject({ quotaDay: pacificDay(), quotaUsed: 1 });
  });

  it('keeps searches apart, so running out of them leaves the units alone', async () => {
    await seed({ quotaDay: pacificDay(), quotaUsed: 5, quotaSearches: DAILY_SEARCHES * 0.95 - 1 });
    const results = await together(() => searchChannels('waveform'));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await counts()).toMatchObject({ quotaUsed: 5, quotaSearches: DAILY_SEARCHES * 0.95 });
    await expect(channelById('UCVlfe3MRSCZSeIWByrWHhkg')).resolves.toBeNull();
  });
});
