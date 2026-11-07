import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  sessionUpdateMany: vi.fn(),
  linkDeleteMany: vi.fn(),
  feedDeleteMany: vi.fn(),
  recoveryCodeDeleteMany: vi.fn(),
  apiTokenDeleteMany: vi.fn(),
  watchlistUpdateMany: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/password', () => ({ hashPassword: mocks.hashPassword }));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
    },
    session: { updateMany: mocks.sessionUpdateMany },
    passwordLink: { deleteMany: mocks.linkDeleteMany },
    calendarFeedToken: { deleteMany: mocks.feedDeleteMany },
    recoveryCode: { deleteMany: mocks.recoveryCodeDeleteMany },
    apiToken: { deleteMany: mocks.apiTokenDeleteMany },
    watchlistItem: { updateMany: mocks.watchlistUpdateMany },
    pushSubscription: { updateMany: mocks.subscriptionUpdateMany },
    $transaction: mocks.transaction,
  },
}));

import { ensureBootstrapAdmin } from '@/lib/bootstrap-admin';

const originalAppPassword = process.env.APP_PASSWORD;
const originalReset = process.env.HELPRR_ADMIN_PASSWORD_RESET;
const originalUsername = process.env.HELPRR_ADMIN_USERNAME;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_PASSWORD = 'short';
  delete process.env.HELPRR_ADMIN_PASSWORD_RESET;
  delete process.env.HELPRR_ADMIN_USERNAME;
  mocks.hashPassword.mockResolvedValue('new-hash');
  mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
  mocks.watchlistUpdateMany.mockResolvedValue({ count: 0 });
  mocks.subscriptionUpdateMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockResolvedValue([{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
  if (originalReset === undefined) delete process.env.HELPRR_ADMIN_PASSWORD_RESET;
  else process.env.HELPRR_ADMIN_PASSWORD_RESET = originalReset;
  if (originalUsername === undefined) delete process.env.HELPRR_ADMIN_USERNAME;
  else process.env.HELPRR_ADMIN_USERNAME = originalUsername;
});

describe('bootstrap local-password policy', () => {
  it('rejects a bootstrap username that the login boundary cannot accept', async () => {
    process.env.APP_PASSWORD = 'a'.repeat(15);
    process.env.HELPRR_ADMIN_USERNAME = 'a'.repeat(65);

    await expect(ensureBootstrapAdmin()).rejects.toThrow(
      'HELPRR_ADMIN_USERNAME must be at most 64 characters',
    );
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not reject an unused legacy env password after the admin is configured', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'user-bootstrap-admin',
      username: 'admin',
      passwordHash: 'existing-hash',
    });

    await expect(ensureBootstrapAdmin()).resolves.toBeUndefined();
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects a short password before seeding a new bootstrap admin', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(ensureBootstrapAdmin()).rejects.toThrow(
      'APP_PASSWORD must be at least 15 characters',
    );
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects a short forced reset without replacing the stored hash', async () => {
    process.env.HELPRR_ADMIN_PASSWORD_RESET = 'true';
    mocks.findUnique.mockResolvedValue({
      id: 'user-bootstrap-admin',
      username: 'admin',
      passwordHash: 'existing-hash',
    });

    await expect(ensureBootstrapAdmin()).rejects.toThrow(
      'APP_PASSWORD must be at least 15 characters',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('a forced reset also ends the admin\'s sessions, password link, calendar feed link, API tokens and two-step sign-in, in one transaction', async () => {
    process.env.HELPRR_ADMIN_PASSWORD_RESET = 'true';
    process.env.APP_PASSWORD = 'a-long-bootstrap-password-1';
    mocks.findUnique.mockResolvedValue({ id: 'user-bootstrap-admin', username: 'admin', passwordHash: 'existing-hash' });
    mocks.update.mockReturnValue('update-op');
    mocks.linkDeleteMany.mockReturnValue('link-op');
    mocks.sessionUpdateMany.mockReturnValueOnce('session-op');
    mocks.feedDeleteMany.mockReturnValue('feed-op');
    mocks.recoveryCodeDeleteMany.mockReturnValue('recovery-op');
    mocks.apiTokenDeleteMany.mockReturnValue('api-token-op');
    mocks.transaction.mockResolvedValueOnce([{}, { count: 1 }, { count: 2 }, { count: 1 }, { count: 10 }, { count: 3 }]);

    await ensureBootstrapAdmin();

    expect(mocks.transaction).toHaveBeenNthCalledWith(1, ['update-op', 'link-op', 'session-op', 'feed-op', 'recovery-op', 'api-token-op']);
    expect(mocks.apiTokenDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-bootstrap-admin' } });
    expect(mocks.feedDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-bootstrap-admin' } });
    expect(mocks.recoveryCodeDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-bootstrap-admin' } });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ended 1 link(s), 1 calendar feed link(s) and 3 API token(s), and turned off two-step sign-in'));
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'user-bootstrap-admin' },
      data: { passwordHash: 'new-hash', totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null },
    });
    expect(mocks.linkDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-bootstrap-admin' } });
    // Owner-less sessions too, before the attach hands them to the admin.
    expect(mocks.sessionUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { OR: [{ userId: 'user-bootstrap-admin' }, { userId: null }], revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // Two-step sign-in was off, so only the ended tokens are recorded.
    expect(mocks.recordSecurityEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(null, {
      actor: null,
      action: 'API_TOKEN_REVOKED',
      targetType: 'user',
      targetId: 'user-bootstrap-admin',
      targetLabel: 'admin',
      fields: ['admin-password-reset'],
      count: 3,
    });
  });

  it('a forced reset that turned two-step sign-in off records it, with no request and no actor', async () => {
    process.env.HELPRR_ADMIN_PASSWORD_RESET = 'true';
    process.env.APP_PASSWORD = 'a-long-bootstrap-password-1';
    mocks.findUnique.mockResolvedValue({
      id: 'user-bootstrap-admin', username: 'admin', passwordHash: 'existing-hash', totpEnabledAt: new Date('2026-11-01'),
    });
    mocks.transaction.mockResolvedValueOnce([{}, { count: 0 }, { count: 1 }, { count: 0 }, { count: 10 }, { count: 0 }]);

    await ensureBootstrapAdmin();

    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ totpEnabledAt: true }) }));
    expect(mocks.recordSecurityEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(null, {
      actor: null,
      action: 'MFA_DISABLED',
      targetType: 'user',
      targetId: 'user-bootstrap-admin',
      targetLabel: 'admin',
      fields: ['admin-password-reset'],
    });
  });

  it('seeding a missing hash on an upgrade leaves sessions and links alone', async () => {
    process.env.APP_PASSWORD = 'a-long-bootstrap-password-1';
    mocks.findUnique.mockResolvedValue({ id: 'user-bootstrap-admin', username: 'admin', passwordHash: null });

    await ensureBootstrapAdmin();

    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'user-bootstrap-admin' }, data: { passwordHash: 'new-hash' } });
    expect(mocks.linkDeleteMany).not.toHaveBeenCalled();
    expect(mocks.feedDeleteMany).not.toHaveBeenCalled();
    expect(mocks.recoveryCodeDeleteMany).not.toHaveBeenCalled();
    expect(mocks.apiTokenDeleteMany).not.toHaveBeenCalled();
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: expect.any(Date) } }));
  });

  it('keeps the name an admin chose in /setup unless HELPRR_ADMIN_USERNAME is set', async () => {
    process.env.APP_PASSWORD = 'a-long-bootstrap-password-1';
    mocks.findUnique.mockResolvedValue({ id: 'user-bootstrap-admin', username: 'sai', passwordHash: 'existing-hash' });
    await ensureBootstrapAdmin();
    expect(mocks.update).not.toHaveBeenCalled();

    process.env.HELPRR_ADMIN_USERNAME = '""';
    await ensureBootstrapAdmin();
    expect(mocks.update).not.toHaveBeenCalled();

    process.env.HELPRR_ADMIN_USERNAME = 'admin';
    await ensureBootstrapAdmin();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'user-bootstrap-admin' }, data: { username: 'admin' } });
  });
});
