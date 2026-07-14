import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMPORT_BYTES } from '@/lib/settings-export';
import { MAX_IMPORT_ARRAY_ENTRIES } from '@/lib/settings-import-validation';

const mocks = vi.hoisted(() => ({
  authError: vi.fn(),
  capabilityError: vi.fn(),
  currentUser: vi.fn(),
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.authError,
  requireCapability: mocks.capabilityError,
  getCurrentUser: mocks.currentUser,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
  configureApiLogging: vi.fn(),
}));

vi.mock('@/lib/polling-service', () => ({ pollingService: { restart: vi.fn() } }));
vi.mock('@/lib/cache/state', () => ({
  setCachedCacheImagesEnabled: vi.fn(),
  setCachedAnilistTtlSettings: vi.fn(),
}));
vi.mock('@/lib/cache/admin', () => ({ disableCachingAndPurgeCaches: vi.fn() }));
vi.mock('@/lib/logger', () => ({ configureLogger: vi.fn() }));
vi.mock('@/lib/app-settings', () => ({ getOrCreateAppSettings: vi.fn() }));
vi.mock('@/lib/cleanup/scheduler', () => ({
  restartDownloadCleaner: vi.fn(),
  restartQueueCleaner: vi.fn(),
}));
vi.mock('@/lib/cleanup/strikes', () => ({ pruneStrikesForMissingRules: vi.fn() }));
vi.mock('@/lib/scheduled-alerts/resolver', () => ({
  createResolverContext: vi.fn(),
  resolveAlertOccurrencesResult: vi.fn(),
}));
vi.mock('@/lib/scheduled-alerts/delivery', () => ({ upsertOccurrencesForAlert: vi.fn() }));
vi.mock('@/lib/arr-instances', () => ({
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
  ensureDefaultForType: vi.fn(),
  clearConnectionMemo: vi.fn(),
}));
vi.mock('@/lib/timezone', () => ({
  setAppTimeZone: vi.fn(),
  isValidTimeZone: () => true,
  getEnvTimeZone: () => 'UTC',
}));

import { POST as importSettings } from '@/app/api/settings/import/route';

const admin = {
  id: 'admin-id',
  username: 'admin',
  displayName: 'Admin',
  role: 'admin',
  status: 'active',
  template: 'admin',
  permissions: {},
};

function request(raw: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/settings/import', {
    method: 'POST',
    body: raw,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authError.mockResolvedValue(null);
  mocks.capabilityError.mockResolvedValue(null);
  mocks.currentUser.mockResolvedValue(admin);
  const tx = {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    session: { updateMany: mocks.sessionUpdateMany },
  };
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
});

describe('hostile settings imports', () => {
  it('authenticates before reading an untrusted request body', async () => {
    const text = vi.fn();
    mocks.authError.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const fakeRequest = { text, headers: new Headers() } as unknown as NextRequest;

    const response = await importSettings(fakeRequest);

    expect(response.status).toBe(401);
    expect(text).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('enforces actual UTF-8 bytes even when content-length is spoofed smaller', async () => {
    const oversized = '💣'.repeat(Math.floor(MAX_IMPORT_BYTES / 4) + 1);

    const response = await importSettings(request(oversized, { 'content-length': '1' }));

    expect(response.status).toBe(413);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"appSettings":', 400],
    ['top-level array', '[]', 400],
    ['top-level null', 'null', 400],
  ])('rejects %s without database work', async (_label, raw, status) => {
    const response = await importSettings(request(raw));

    expect(response.status).toBe(status);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects aggregate collection bombs before database work', async () => {
    const raw = JSON.stringify({ watchlist: { items: Array(MAX_IMPORT_ARRAY_ENTRIES + 1).fill(null) } });

    const response = await importSettings(request(raw));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('arrays exceed');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('prevents a backup-capable member from importing global sections', async () => {
    mocks.currentUser.mockResolvedValue({ ...admin, id: 'member-id', role: 'member', template: 'member' });

    const response = await importSettings(request(JSON.stringify({ appSettings: { logLevel: 'debug' } })));

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('ignores prototype-shaped unknown sections without polluting objects', async () => {
    const raw = '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}';

    const response = await importSettings(request(raw));

    expect(response.status).toBe(200);
    expect((Object.prototype as { polluted?: string }).polluted).toBeUndefined();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('drops an invalid imported password hash without replacing or revoking the account', async () => {
    const existing = {
      id: 'victim-id',
      username: 'victim',
      displayName: 'Victim',
      passwordHash: 'scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg==$MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZg==',
      role: 'member',
      status: 'active',
      template: 'member',
      permissions: {},
      jellyfinUserId: null,
      seerrUserId: null,
    };
    mocks.userFindUnique.mockResolvedValue(existing);
    mocks.userUpdate.mockResolvedValue(existing);
    const raw = JSON.stringify({
      users: {
        accounts: [{
          username: 'victim',
          displayName: 'Victim',
          passwordHash: 'scrypt$999999999$999$999$bad$bad',
          role: 'member',
          status: 'active',
          template: 'member',
          permissions: {},
        }],
      },
    });

    const response = await importSettings(request(raw));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ passwordHash: existing.passwordHash }),
    }));
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    expect(body.skipped).toContain('User "victim": invalid password hash dropped');
  });
});
