import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maskApiKey } from '@/lib/service-connection-secrets';

// "Sign in with Jellyfin" signs in whichever account is linked to the user the
// configured server vouches for. So adding Jellyfin, or changing its address or
// key, is for an admin who confirms it is them (whatever capabilities a member
// holds), and a new address signs out every Jellyfin-linked account.

const mocks = vi.hoisted(() => {
  const tx = {
    serviceConnection: { update: vi.fn(), create: vi.fn() },
    session: { findMany: vi.fn(), updateMany: vi.fn() },
    user: { updateMany: vi.fn() },
  };
  return {
    tx,
    auth: vi.fn(),
    stepUp: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    recordSecurityEvent: vi.fn(),
    jfUser: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/server/confirm-password', () => ({ confirmAdminStepUp: mocks.stepUp }));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, update: mocks.update, create: mocks.create },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  changedFieldNames: (a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) => keys.filter((k) => a[k] !== b[k]),
  serviceTargetLabel: () => 'Jellyfin',
}));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: vi.fn() }));
vi.mock('@/lib/jellyfin-client', () => ({
  JellyfinClient: class {
    resolveCurrentUser = mocks.jfUser;
    hasAdminAccess = vi.fn().mockResolvedValue(true);
    getUsers = vi.fn().mockResolvedValue([]);
  },
}));

import { POST as saveConnection } from '@/app/api/services/route';

const OLD_URL = 'http://jellyfin.lan:8096';
const STORED_KEY = 'stored-jellyfin-key-0123456789';
const stored = {
  id: 'jf-1', type: 'JELLYFIN', label: 'Jellyfin', isDefault: true, url: OLD_URL, apiKey: STORED_KEY,
  username: 'jf-admin', externalUrl: null, customHeaders: null, accessToken: null, refreshToken: null,
  tokenExpiresAt: null, metadata: null, createdAt: new Date(), updatedAt: new Date(),
};
const admin = { ok: true, user: { id: 'admin-1', username: 'boss', role: 'admin' }, session: { id: 'sess-admin' } };
const member = { ok: true, user: { id: 'member-1', username: 'kid', role: 'member' }, session: { id: 'sess-member' } };

const save = (body: Record<string, unknown>) =>
  saveConnection(new NextRequest('http://helprr.test/api/services', {
    method: 'POST',
    body: JSON.stringify({ type: 'JELLYFIN', ...body }),
  }));

function expectNothingSaved() {
  expect(mocks.tx.serviceConnection.update).not.toHaveBeenCalled();
  expect(mocks.tx.serviceConnection.create).not.toHaveBeenCalled();
  expect(mocks.tx.session.updateMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(admin);
  mocks.stepUp.mockResolvedValue(null);
  mocks.jfUser.mockResolvedValue({ Id: 'jf-admin', Name: 'admin' });
  mocks.findFirst.mockResolvedValue(stored);
  mocks.tx.serviceConnection.update.mockImplementation(async ({ data }) => ({ ...stored, ...data }));
  mocks.tx.serviceConnection.create.mockImplementation(async ({ data }) => ({ ...stored, id: 'jf-new', ...data }));
  mocks.tx.session.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
  mocks.tx.session.updateMany.mockResolvedValue({ count: 5 });
});

describe('a member with settings.instances', () => {
  beforeEach(() => mocks.auth.mockResolvedValue(member));

  it.each([
    ['a new address', { url: 'http://evil.example:8096', apiKey: 'new-key' }],
    ['a new API key', { url: OLD_URL, apiKey: 'another-key' }],
  ])('cannot give Jellyfin %s', async (_label, body) => {
    const res = await save(body);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only an admin/);
    expect(mocks.jfUser).not.toHaveBeenCalled();
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it('cannot add Jellyfin', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await save({ url: OLD_URL, apiKey: 'a-key' })).status).toBe(403);
    expectNothingSaved();
  });

  it('cannot change which Jellyfin user the connection reads as', async () => {
    const res = await save({ url: OLD_URL, apiKey: maskApiKey(STORED_KEY), username: 'jf-other' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only an admin/);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it('cannot change Jellyfin custom headers', async () => {
    vi.stubEnv('HELPRR_CUSTOM_HEADERS', 'true');
    try {
      const res = await save({ url: OLD_URL, apiKey: maskApiKey(STORED_KEY), username: 'jf-admin', customHeaders: { 'X-Proxy-Auth': 'mine' } });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/Only an admin/);
      expectNothingSaved();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('can still re-save it with the same address, key (the masked key) and Jellyfin user', async () => {
    const res = await save({ url: `${OLD_URL}/`, apiKey: maskApiKey(STORED_KEY), username: 'jf-admin' });
    expect(res.status).toBe(200);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(mocks.tx.serviceConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'jf-1', url: OLD_URL, apiKey: STORED_KEY },
    }));
    expect(mocks.tx.session.updateMany).not.toHaveBeenCalled();
  });

  // The external URL builds the "Open in Jellyfin" links everyone follows.
  it.each([
    ['set', null],
    ['change', 'https://jf.example.com'],
  ])('cannot %s the external URL', async (_label, current) => {
    mocks.findFirst.mockResolvedValue({ ...stored, externalUrl: current });
    const res = await save({ url: OLD_URL, apiKey: maskApiKey(STORED_KEY), externalUrl: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only an admin/);
    expect(mocks.jfUser).not.toHaveBeenCalled();
    expectNothingSaved();
  });

  it('re-saving with the stored external URL leaves it unwritten', async () => {
    mocks.findFirst.mockResolvedValue({ ...stored, externalUrl: 'https://jf.example.com' });
    const res = await save({ url: OLD_URL, apiKey: maskApiKey(STORED_KEY), externalUrl: 'https://jf.example.com/' });
    expect(res.status).toBe(200);
    const { data } = mocks.tx.serviceConnection.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('externalUrl');
  });
});

describe('an admin', () => {
  it('sets the external URL with no step-up', async () => {
    const res = await save({ url: OLD_URL, apiKey: maskApiKey(STORED_KEY), externalUrl: 'https://jf.example.com/' });
    expect(res.status).toBe(200);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(mocks.tx.serviceConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalUrl: 'https://jf.example.com' }),
    }));
  });

  it('passes the step-up a refusal from the password check, and saves nothing', async () => {
    mocks.stepUp.mockResolvedValue(NextResponse.json({ error: 'needs password', needsStepUp: true, needsCode: true }, { status: 403 }));
    const res = await save({ url: 'http://new.lan:8096', apiKey: 'new-key' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ needsStepUp: true, needsCode: true });
    expect(mocks.stepUp).toHaveBeenCalledWith(expect.anything(), admin.user, expect.anything(), 'jellyfin-connection', 'Changing the Jellyfin connection');
    expectNothingSaved();
  });

  it('is asked only after Jellyfin answered, so a failed test does not use up a code', async () => {
    mocks.jfUser.mockResolvedValue(null);
    expect((await save({ url: 'http://new.lan:8096', apiKey: 'new-key' })).status).toBe(400);
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });

  it('a new address, confirmed: saves it and signs out every Jellyfin-linked account but this session, audited with counts', async () => {
    const res = await save({ url: 'http://new.lan:8096', apiKey: 'new-key', currentPassword: 'x', code: '123456' });
    expect(res.status).toBe(200);
    expect(mocks.tx.serviceConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'jf-1', url: OLD_URL, apiKey: STORED_KEY },
      data: expect.objectContaining({ url: 'http://new.lan:8096', apiKey: 'new-key' }),
    }));
    const where = { revokedAt: null, user: { jellyfinUserId: { not: null } }, NOT: { id: 'sess-admin' } };
    expect(mocks.tx.session.updateMany).toHaveBeenCalledWith({ where, data: { revokedAt: expect.any(Date) } });
    // The members' Jellyfin tokens are for the old server, so they are not sent to the new one.
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({ where: { jellyfinToken: { not: null } }, data: { jellyfinToken: null } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'SESSION_REVOKED', targetType: 'service', targetId: 'jf-1', count: 5, fields: ['url', 'accounts: 2'],
    }));
  });

  it('a new key at the same address: confirmed, nobody signed out', async () => {
    const res = await save({ url: OLD_URL, apiKey: 'rotated-key' });
    expect(res.status).toBe(200);
    expect(mocks.stepUp).toHaveBeenCalledTimes(1);
    expect(mocks.tx.session.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('adding Jellyfin: confirmed, and accounts still linked from before sign in again', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await save({ url: 'http://new.lan:8096', apiKey: 'new-key' });
    expect(res.status).toBe(200);
    expect(mocks.stepUp).toHaveBeenCalledTimes(1);
    expect(mocks.tx.serviceConnection.create).toHaveBeenCalled();
    expect(mocks.tx.session.updateMany).toHaveBeenCalled();
  });

  it('no linked account with a live session: nothing revoked, no sign-out row', async () => {
    mocks.tx.session.findMany.mockResolvedValue([]);
    expect((await save({ url: 'http://new.lan:8096', apiKey: 'new-key' })).status).toBe(200);
    expect(mocks.tx.session.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'SESSION_REVOKED' }));
  });

  it('the address or key changed meanwhile: 409, nothing signed out', async () => {
    mocks.tx.serviceConnection.update.mockRejectedValue(Object.assign(new Error('changed'), { code: 'P2025' }));
    expect((await save({ url: 'http://new.lan:8096', apiKey: 'new-key' })).status).toBe(409);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });
});

describe('other services are unchanged', () => {
  it('a member saves a new Sonarr address with no step-up', async () => {
    mocks.auth.mockResolvedValue(member);
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({ data }) => ({ id: 's1', isDefault: true, ...data }));
    const res = await saveConnection(new NextRequest('http://helprr.test/api/services', {
      method: 'POST',
      body: JSON.stringify({ type: 'SONARR', label: 'Main', url: 'http://sonarr.lan:8989', apiKey: 'k' }),
    }));
    expect(res.status).toBe(200);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
