import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// The invite / reset link rules against real PostgreSQL row locks, on a
// disposable database with every migration applied:
//   PASSWORD_LINKS_TEST_DATABASE_URL=postgresql://…/helprr_password_links_test npx vitest run password-links.integration
// The tables it uses are emptied before each test, so the database must be
// named helprr_password_links_test, or that name with a suffix (helprr_password_links_test_<name>)
// for a private local copy.
const url = process.env.PASSWORD_LINKS_TEST_DATABASE_URL;

type Links = typeof import('@/lib/password-links');

describe.skipIf(!url)('password links against PostgreSQL', () => {
  let prisma: PrismaClient;
  let links: Links;

  beforeAll(async () => {
    if (!/^\/helprr_password_links_test(_[a-z0-9]+)?$/.test(new URL(url!).pathname)) {
      throw new Error('PASSWORD_LINKS_TEST_DATABASE_URL must name the database helprr_password_links_test[_<name>]');
    }
    vi.stubEnv('DATABASE_URL', url!);
    ({ prisma } = await import('@/lib/db'));
    links = await import('@/lib/password-links');
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "PasswordLink", "Session", "User" CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  async function user(id: string, status: 'active' | 'pending', passwordHash: string | null) {
    await prisma.user.create({ data: { id, username: id, displayName: id, status, passwordHash } });
  }

  it('lets exactly one of two simultaneous uses of a reset link through', async () => {
    await user('u1', 'active', 'old-hash');
    await prisma.session.createMany({ data: [{ userId: 'u1' }, { userId: 'u1' }] });
    const { token } = await links.issuePasswordLink(prisma, { userId: 'u1', purpose: 'reset', createdById: 'admin' });

    const results = await Promise.all([
      links.redeemPasswordLink(token, 'hash-a'),
      links.redeemPasswordLink(token, 'hash-b'),
    ]);

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(stored.passwordHash).toBe(results[0] ? 'hash-a' : 'hash-b');
    expect(await prisma.passwordLink.count()).toBe(0);
    expect(await prisma.session.count({ where: { userId: 'u1', revokedAt: null } })).toBe(0);
  });

  it("a reset link an admin made turns two-step sign-in off with the password, once; the user's own leaves it on", async () => {
    await user('u4', 'active', 'old-hash');
    await user('u5', 'active', 'old-hash');
    const on = { totpSecret: 'enc:v1:x', totpEnabledAt: new Date(Date.now() - 60_000), totpLastUsedStep: 3 };
    await prisma.user.updateMany({ where: { id: { in: ['u4', 'u5'] } }, data: on });
    await prisma.recoveryCode.createMany({ data: [{ userId: 'u4', codeHash: 'a' }, { userId: 'u4', codeHash: 'b' }, { userId: 'u5', codeHash: 'c' }] });
    const admins = await links.issuePasswordLink(prisma, { userId: 'u4', purpose: 'reset', createdById: 'admin' });
    const own = await links.issuePasswordLink(prisma, { userId: 'u5', purpose: 'reset', createdById: 'u5' });

    const results = await Promise.all([
      links.redeemPasswordLink(admins.token, 'hash-a'),
      links.redeemPasswordLink(admins.token, 'hash-b'),
    ]);
    expect(results.filter((r) => r?.mfaDisabled === true)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 'u4' } }))
      .toMatchObject({ totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null });
    expect(await prisma.recoveryCode.count({ where: { userId: 'u4' } })).toBe(0);

    expect(await links.redeemPasswordLink(own.token, 'hash-c')).toMatchObject({ mfaEnabled: true, mfaDisabled: false });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 'u5' } })).toMatchObject({ passwordHash: 'hash-c', totpSecret: 'enc:v1:x' });
    expect(await prisma.recoveryCode.count({ where: { userId: 'u5' } })).toBe(1);

    // A link made before two-step sign-in was turned on does not remove it.
    const early = await links.issuePasswordLink(prisma, { userId: 'u5', purpose: 'reset', createdById: 'admin' });
    await prisma.user.update({ where: { id: 'u5' }, data: { totpEnabledAt: new Date(Date.now() + 1_000) } });
    expect(await links.redeemPasswordLink(early.token, 'hash-d')).toMatchObject({ mfaEnabled: true, mfaDisabled: false });
    expect(await prisma.recoveryCode.count({ where: { userId: 'u5' } })).toBe(1);
  });

  it('activates an invited user once, and keeps only the hash', async () => {
    await user('u2', 'pending', null);
    const { token } = await links.issuePasswordLink(prisma, { userId: 'u2', purpose: 'invite', createdById: 'admin' });
    const row = await prisma.passwordLink.findUniqueOrThrow({ where: { userId: 'u2' } });
    expect(row.tokenHash).toBe(links.hashPasswordLinkToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const [a, b] = await Promise.all([
      links.redeemPasswordLink(token, 'hash-a'),
      links.redeemPasswordLink(token, 'hash-b'),
    ]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 'u2' } })).toMatchObject({ status: 'active' });
  });

  it('ends the old link when a new one is made', async () => {
    await user('u3', 'pending', null);
    const first = await links.issuePasswordLink(prisma, { userId: 'u3', purpose: 'invite', createdById: 'admin' });
    const second = await links.issuePasswordLink(prisma, { userId: 'u3', purpose: 'invite', createdById: 'admin' });

    expect(await links.redeemPasswordLink(first.token, 'hash')).toBeNull();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 'u3' } })).toMatchObject({ status: 'pending', passwordHash: null });
    expect(await links.redeemPasswordLink(second.token, 'hash')).not.toBeNull();
  });
});
