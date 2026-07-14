import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  sessionUpdateMany: vi.fn(),
  watchlistUpdateMany: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock('@/lib/password', () => ({ hashPassword: mocks.hashPassword }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
    },
    session: { updateMany: mocks.sessionUpdateMany },
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
  mocks.transaction.mockResolvedValue([{ count: 0 }, { count: 0 }, { count: 0 }]);
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
});
