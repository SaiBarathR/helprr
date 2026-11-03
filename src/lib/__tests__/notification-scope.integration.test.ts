import { PrismaClient, type UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historyScope } from '@/lib/notification-scope';

const url = process.env.TWITCH_QUEUE_TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : null;

const ADMIN = { id: 'scope-admin', role: 'admin' };
const OTHER_ADMIN = { id: 'scope-other', role: 'admin' };
const MEMBER = { id: 'scope-member', role: 'member' };

// Needs a migrated, disposable PostgreSQL; skipped without one.
describe.skipIf(!url || !url.endsWith('/helprr_migration_test'))('whose notifications a person sees', () => {
  const db = prisma!;
  const titles = async (user: { id: string; role: string }) => (
    await db.notificationHistory.findMany({ where: historyScope(user), orderBy: { title: 'asc' }, select: { title: true } })
  ).map(({ title }) => title);

  beforeAll(async () => {
    for (const user of [ADMIN, OTHER_ADMIN, MEMBER]) {
      await db.user.upsert({ where: { id: user.id }, update: {}, create: { id: user.id, username: user.id, displayName: user.id, role: user.role as UserRole } });
    }
    await db.notificationHistory.deleteMany({ where: { title: { startsWith: 'scope ' } } });
    // One new video, one copy per follower, as poll-youtube writes it.
    for (const user of [ADMIN, OTHER_ADMIN, MEMBER]) {
      await db.notificationHistory.create({ data: { userId: user.id, eventType: 'youtubeVideoNew', title: `scope video for ${user.id}`, body: 'b' } });
    }
    await db.notificationHistory.create({ data: { userId: MEMBER.id, eventType: 'requestApproved', title: 'scope member request', body: 'b' } });
    await db.notificationHistory.create({ data: { userId: null, eventType: 'youtubeDownloadFailed', title: 'scope worker issue', body: 'b' } });
  });
  afterAll(async () => {
    await db.notificationHistory.deleteMany({ where: { title: { startsWith: 'scope ' } } });
    await db.user.deleteMany({ where: { id: { in: [ADMIN.id, OTHER_ADMIN.id, MEMBER.id] } } });
    await db.$disconnect();
  });

  it('gives an admin one copy of a new video, not one per follower', async () => {
    expect((await titles(ADMIN)).filter((title) => title.startsWith('scope video'))).toEqual(['scope video for scope-admin']);
  });

  it('still shows an admin a member\'s requests and the alerts nobody owns', async () => {
    expect(await titles(ADMIN)).toEqual(expect.arrayContaining(['scope member request', 'scope worker issue']));
  });

  it('shows a member only their own', async () => {
    expect((await titles(MEMBER)).filter((title) => title.startsWith('scope '))).toEqual(['scope member request', 'scope video for scope-member']);
  });

  it('marks as read only what the person sees', async () => {
    await db.notificationHistory.updateMany({ where: { read: false, title: { startsWith: 'scope ' }, ...historyScope(ADMIN) }, data: { read: true } });
    const other = await db.notificationHistory.findFirstOrThrow({ where: { title: 'scope video for scope-other' } });
    expect(other.read).toBe(false);
  });
});
