import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ count: vi.fn(), txCount: vi.fn(), create: vi.fn(), attach: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { count: mocks.count },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: { count: mocks.txCount, create: mocks.create } }),
  },
}));
vi.mock('@/lib/bootstrap-admin', () => ({ BOOTSTRAP_ADMIN_ID: 'user-bootstrap-admin', attachOwnerlessRowsToAdmin: mocks.attach }));
vi.mock('@/lib/password', () => ({ hashPassword: async () => 'scrypt$hash' }));

import { claimFirstAdmin, FirstAdminBusyError, FirstAdminInputError, FirstAdminTakenError, needsFirstAdmin, resetClaimSlots, resetFirstAdminLatch } from '@/lib/first-admin';

const good = { username: 'Owner', password: 'a-long-first-admin-password' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('APP_PASSWORD', '');
  resetFirstAdminLatch();
  resetClaimSlots();
  mocks.count.mockResolvedValue(0);
  mocks.txCount.mockResolvedValue(0);
  mocks.create.mockResolvedValue({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('claimFirstAdmin', () => {
  it('creates the admin with the bootstrap id and attaches ownerless rows', async () => {
    expect(await claimFirstAdmin(good)).toEqual({ id: 'user-bootstrap-admin', role: 'admin' });
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'user-bootstrap-admin', username: 'Owner', role: 'admin', status: 'active', passwordHash: 'scrypt$hash' }) });
    expect(mocks.attach).toHaveBeenCalled();
  });

  it('turns the primary-key clash of a lost race into "taken"', async () => {
    mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }));
    await expect(claimFirstAdmin(good)).rejects.toBeInstanceOf(FirstAdminTakenError);
  });

  it('says "taken" when a user appeared before the transaction', async () => {
    mocks.txCount.mockResolvedValue(1);
    await expect(claimFirstAdmin(good)).rejects.toBeInstanceOf(FirstAdminTakenError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ username: 42, password: good.password }],
    [{ username: '', password: good.password }],
    [{ username: 'owner', password: undefined }],
    [{ username: 'owner', password: 'short' }],
  ])('refuses %j before touching the database', async (input) => {
    await expect(claimFirstAdmin(input)).rejects.toBeInstanceOf(FirstAdminInputError);
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('lets ten real claims a minute through, and junk uses none of them', async () => {
    for (let i = 0; i < 30; i++) await expect(claimFirstAdmin({ username: 'owner', password: 'short' })).rejects.toBeInstanceOf(FirstAdminInputError);
    mocks.txCount.mockResolvedValue(1);
    for (let i = 0; i < 10; i++) await expect(claimFirstAdmin(good)).rejects.toBeInstanceOf(FirstAdminTakenError);
    await expect(claimFirstAdmin(good)).rejects.toBeInstanceOf(FirstAdminBusyError);
  });

  it('stays closed for the life of the process once someone exists', async () => {
    mocks.count.mockResolvedValue(1);
    expect(await needsFirstAdmin()).toBe(false);
    mocks.count.mockResolvedValue(0);
    expect(await needsFirstAdmin()).toBe(false);
    expect(mocks.count).toHaveBeenCalledTimes(1);
  });
});
