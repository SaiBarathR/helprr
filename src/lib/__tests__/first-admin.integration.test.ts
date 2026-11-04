import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// The first-admin claim against real PostgreSQL, where the race is decided by the
// primary key. Uses the disposable database of the settings import test:
//   SETTINGS_IMPORT_TEST_DATABASE_URL=postgresql://…/helprr_import_test npx vitest run first-admin.integration
const url = process.env.SETTINGS_IMPORT_TEST_DATABASE_URL;

describe.skipIf(!url)('first admin against PostgreSQL', () => {
  let prisma: PrismaClient;
  let firstAdmin: typeof import('@/lib/first-admin');

  beforeAll(async () => {
    if (new URL(url!).pathname !== '/helprr_import_test') {
      throw new Error('SETTINGS_IMPORT_TEST_DATABASE_URL must name the database helprr_import_test');
    }
    vi.stubEnv('DATABASE_URL', url!);
    ({ prisma } = await import('@/lib/db'));
    firstAdmin = await import('@/lib/first-admin');
  });
  beforeEach(async () => {
    vi.stubEnv('APP_PASSWORD', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await prisma.$executeRawUnsafe('TRUNCATE "User" CASCADE');
    // Each case decides from the database, not from a previous case's latch.
    firstAdmin.resetFirstAdminLatch();
    expect(await firstAdmin.needsFirstAdmin()).toBe(true);
    firstAdmin.resetFirstAdminLatch();
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "User" CASCADE');
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it('lets exactly one of several racing claims create the admin', async () => {
    expect(await firstAdmin.needsFirstAdmin()).toBe(true);
    const claims = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => firstAdmin.claimFirstAdmin({ username: `racer${i}`, password: 'a-long-first-admin-password' })),
    );
    expect(claims.filter((c) => c.status === 'fulfilled')).toHaveLength(1);
    for (const c of claims.filter((c) => c.status === 'rejected')) {
      expect((c as PromiseRejectedResult).reason).toBeInstanceOf(firstAdmin.FirstAdminTakenError);
    }
    const users = await prisma.user.findMany({ select: { id: true, role: true, status: true, passwordHash: true } });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 'user-bootstrap-admin', role: 'admin', status: 'active' });
    expect(users[0].passwordHash).toMatch(/^scrypt/);
    expect(await firstAdmin.needsFirstAdmin()).toBe(false);
  });

  it('never reopens for an install whose only admin signs in with Jellyfin', async () => {
    await prisma.user.create({ data: { id: 'jf-admin', username: 'jf', displayName: 'JF', role: 'admin', status: 'active', passwordHash: null } });
    expect(await firstAdmin.needsFirstAdmin()).toBe(false);
    await expect(firstAdmin.claimFirstAdmin({ username: 'admin', password: 'a-long-first-admin-password' }))
      .rejects.toBeInstanceOf(firstAdmin.FirstAdminTakenError);
  });

  it('never reopens after the bootstrap admin was deleted, or with only a member left', async () => {
    await prisma.user.create({ data: { id: 'someone', username: 'member', displayName: 'M', role: 'member', status: 'active', passwordHash: null } });
    expect(await firstAdmin.needsFirstAdmin()).toBe(false);
  });

  it('stays closed while APP_PASSWORD is set, even with no user', async () => {
    vi.stubEnv('APP_PASSWORD', 'a-long-bootstrap-password-1');
    expect(await firstAdmin.needsFirstAdmin()).toBe(false);
  });
});
