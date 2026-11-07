import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each audited route writes the right event, names what changed and never a
// value, and still answers as before when the audit write fails.

const mocks = vi.hoisted(() => {
  const db = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ role: 'member', status: 'active' }]),
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(),
    },
    session: { findUnique: vi.fn(), updateMany: vi.fn() },
    calendarFeedToken: { deleteMany: vi.fn() },
    apiToken: { deleteMany: vi.fn() },
    serviceConnection: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    securityAuditEvent: { create: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    passwordLink: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  return {
    db,
    requireAdmin: vi.fn(),
    requireUser: vi.fn(),
    requireUserCapability: vi.fn(),
    verifyUserPassword: vi.fn(),
    applySettingsImport: vi.fn(),
    authenticateByName: vi.fn(),
    importServices: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  prisma: { ...mocks.db, $transaction: (fn: (tx: typeof mocks.db) => unknown) => fn(mocks.db) },
}));
vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'helprr-session',
  SESSION_DURATION: 60,
  requireAdmin: mocks.requireAdmin,
  requireUser: mocks.requireUser,
  requireUserCapability: mocks.requireUserCapability,
  verifyUserPassword: mocks.verifyUserPassword,
  createSession: vi.fn(async () => 'token'),
  revokeSession: vi.fn(),
}));
vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn(async () => 'new-hash'),
  verifyPasswordHash: vi.fn(async () => false),
  getDummyPasswordHash: vi.fn(async () => 'dummy'),
  passwordHashNeedsUpgrade: () => false,
}));
vi.mock('@/lib/login-rate-limit', () => ({
  getClientIp: () => '203.0.113.77',
  enforceLoginRateLimit: vi.fn(async () => null),
  clearLoginAttempts: vi.fn(),
  enforceUsernameBackoff: vi.fn(async () => null),
  recordUsernameFailure: vi.fn(),
  clearUsernameBackoff: vi.fn(),
  enforceGlobalLoginBackstop: vi.fn(async () => null),
  recordGlobalLoginFailure: vi.fn(),
  enforceMalformedLoginBackstop: vi.fn(async () => null),
  recordMalformedLoginRequest: vi.fn(async () => null),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/request-utils', () => ({ isHttpsRequest: () => false }));
vi.mock('@/lib/recommendations/engine', () => ({ refreshRecommendationsAfterLink: vi.fn(async () => {}) }));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  setDefaultConnection: vi.fn(),
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn() }));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: vi.fn() }));
vi.mock('@/lib/settings-import/run-import', () => ({ applySettingsImport: mocks.applySettingsImport }));
vi.mock('@/lib/settings-import/follow-ups', () => ({ runImportFollowUps: vi.fn(async () => []) }));
vi.mock('@/lib/jellyfin-token', async (original) => ({
  ...await original<typeof import('@/lib/jellyfin-token')>(),
  storeJellyfinToken: vi.fn(async () => {}),
}));
vi.mock('@/lib/twitch/helix', () => ({
  TWITCH_HELIX_URL: 'https://api.twitch.tv/helix',
  TwitchCredentialsRejectedError: class extends Error {},
  requestTwitchAppToken: vi.fn(async () => ({ accessToken: 'app-token-value', expiresAt: new Date() })),
}));
vi.mock('@/lib/twitch/token-cipher', () => ({ encryptTwitchToken: (value: string) => `enc:${value}` }));
vi.mock('@/lib/service-import', () => ({ discoverImportCandidates: vi.fn(), importServices: mocks.importServices }));

import { JellyfinClient } from '@/lib/jellyfin-client';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as jellyfinLogin } from '@/app/api/auth/jellyfin/route';
import { POST as linkJellyfin } from '@/app/api/account/jellyfin/link/route';
import { POST as saveTwitch } from '@/app/api/services/twitch/route';
import { POST as importServicesRoute } from '@/app/api/services/import/route';
import { POST as createUser } from '@/app/api/users/route';
import { PATCH as updateUser, DELETE as deleteUser } from '@/app/api/users/[id]/route';
import { PUT as putPermissions } from '@/app/api/users/[id]/permissions/route';
import { POST as changeOwnPassword } from '@/app/api/me/password/route';
import { POST as revokeOne } from '@/app/api/sessions/[id]/revoke/route';
import { POST as revokeOthers } from '@/app/api/sessions/revoke-others/route';
import { POST as saveService } from '@/app/api/services/route';
import { DELETE as deleteService, PATCH as patchService } from '@/app/api/services/[id]/route';
import { POST as importSettings } from '@/app/api/settings/import/route';
import { GET as listSecurityAudit } from '@/app/api/security-audit/route';

const PASSWORD = 'a long enough passphrase here';
const API_KEY = 'abcd1234efgh5678ijkl9999';

const admin = { id: 'admin-1', username: 'admin', role: 'admin', status: 'active', passwordHash: 'h' };
const member = {
  id: 'user-1',
  username: 'member',
  displayName: 'Member',
  passwordHash: 'old-hash',
  role: 'member',
  status: 'active',
  template: 'member',
  permissions: {},
  jellyfinUserId: null,
  seerrUserId: null,
};
const sonarr = {
  id: 'svc-1',
  type: 'SONARR',
  label: 'HD',
  isDefault: true,
  url: 'http://sonarr.lan:8989',
  apiKey: 'old-key-0000000000000000',
  username: null,
  externalUrl: null,
  customHeaders: null,
};

function req(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'user-agent': 'TestAgent/1.0' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function events(): Array<Record<string, unknown>> {
  return mocks.db.securityAuditEvent.create.mock.calls.map((call) => call[0].data);
}

function expectNoSecrets() {
  const written = JSON.stringify([
    mocks.db.securityAuditEvent.create.mock.calls,
    mocks.db.securityAuditEvent.upsert.mock.calls,
  ]);
  for (const secret of [PASSWORD, API_KEY, 'new-hash', 'old-hash', sonarr.apiKey]) {
    expect(written).not.toContain(secret);
  }
}

beforeEach(() => {
  // Reset, not clear: queued one-off answers must not leak into the next test.
  vi.resetAllMocks();
  vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-audit-keys');
  const signedInAdmin = { ok: true, user: admin, session: { id: 'session-admin' } };
  mocks.requireAdmin.mockResolvedValue(signedInAdmin);
  mocks.requireUser.mockResolvedValue(signedInAdmin);
  mocks.requireUserCapability.mockResolvedValue(signedInAdmin);
  mocks.db.securityAuditEvent.create.mockResolvedValue({});
  mocks.db.securityAuditEvent.upsert.mockResolvedValue({});
  mocks.db.user.findUnique.mockResolvedValue(member);
  mocks.db.user.count.mockResolvedValue(1);
  mocks.db.calendarFeedToken.deleteMany.mockResolvedValue({ count: 0 });
  mocks.db.apiToken.deleteMany.mockResolvedValue({ count: 0 });
  vi.spyOn(JellyfinClient, 'authenticateByName').mockImplementation(mocks.authenticateByName);
});

afterEach(() => vi.unstubAllEnvs());

describe('sign-in', () => {
  it('records a success with the method, and a failure by account or by the name as typed when no account matches', async () => {
    mocks.db.user.findFirst.mockResolvedValue({ id: 'user-1', username: 'member', role: 'member', passwordHash: 'h', totpEnabledAt: null });
    mocks.verifyUserPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect((await login(req('/api/auth/login', 'POST', { username: 'member', password: PASSWORD }))).status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({
      action: 'LOGIN_SUCCEEDED', actorUserId: 'user-1', targetLabel: 'member', fields: ['password'],
      ip: '203.0.113.0/24', userAgent: 'TestAgent/1.0',
    })]);

    expect((await login(req('/api/auth/login', 'POST', { username: 'Member', password: 'wrong guess here!' }))).status).toBe(401);
    mocks.db.user.findFirst.mockResolvedValue(null);
    expect((await login(req('/api/auth/login', 'POST', { username: 'nobody', password: 'wrong guess here!' }))).status).toBe(401);

    const failures = mocks.db.securityAuditEvent.upsert.mock.calls.map((call) => call[0]);
    expect(failures.map((f) => [f.create.targetId, f.create.targetLabel])).toEqual([
      ['user-1', 'member'],
      [null, 'nobody'],
    ]);
    expect(failures[0]).toMatchObject({ update: { count: { increment: 1 } }, create: { action: 'LOGIN_FAILED', actorUserId: null } });
    expect(JSON.stringify(failures)).not.toContain('wrong guess');
    // The route already knows the account: one lookup per attempt, as before.
    expect(mocks.db.user.findFirst).toHaveBeenCalledTimes(3);
  });

  it('still signs in when the audit write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.securityAuditEvent.create.mockRejectedValue(new Error('table missing'));
    mocks.db.user.findFirst.mockResolvedValue({ id: 'user-1', username: 'member', role: 'member', passwordHash: 'h', totpEnabledAt: null });
    mocks.verifyUserPassword.mockResolvedValue(true);

    const response = await login(req('/api/auth/login', 'POST', { username: 'member', password: PASSWORD }));
    expect(response.status).toBe(200);
    expect(response.cookies.get('helprr-session')?.value).toBe('token');
  });
});

describe('Jellyfin sign-in', () => {
  it('records a success, a wrong password, and an unlinked account apart', async () => {
    mocks.db.serviceConnection.findFirst.mockResolvedValue({ url: 'http://jf.lan' });
    mocks.authenticateByName
      .mockResolvedValueOnce({ ok: true, userId: 'jf-1', accessToken: 'jf-token' })
      .mockResolvedValueOnce({ ok: false, reason: 'invalid_credentials' })
      .mockResolvedValueOnce({ ok: true, userId: 'jf-2', accessToken: 'jf-token' });
    const linked = { id: 'user-1', username: 'member', role: 'member', totpEnabledAt: null };
    mocks.db.user.findFirst
      .mockResolvedValueOnce(linked) // the Jellyfin user's profile
      .mockResolvedValueOnce(linked) // the wrong password's typed name
      .mockResolvedValueOnce(null); // no profile for jf-2

    expect((await jellyfinLogin(req('/api/auth/jellyfin', 'POST', { username: 'member', password: PASSWORD }))).status).toBe(200);
    expect((await jellyfinLogin(req('/api/auth/jellyfin', 'POST', { username: 'member', password: PASSWORD }))).status).toBe(401);
    expect((await jellyfinLogin(req('/api/auth/jellyfin', 'POST', { username: 'stranger', password: PASSWORD }))).status).toBe(403);

    expect(events()).toEqual([expect.objectContaining({ action: 'LOGIN_SUCCEEDED', actorUserId: 'user-1', fields: ['jellyfin'] })]);
    expect(mocks.db.securityAuditEvent.upsert.mock.calls.map((call) => [
      call[0].create.targetId, call[0].create.targetLabel, call[0].create.fields,
    ])).toEqual([
      ['user-1', 'member', ['jellyfin']],
      // Jellyfin accepted the name: it is an account name, kept as typed.
      [null, 'stranger', ['jellyfin-unlinked']],
    ]);
    expect(mocks.db.user.findFirst).toHaveBeenNthCalledWith(2, {
      where: { username: 'member', status: 'active' }, select: { id: true, username: true },
    });
    expectNoSecrets();
  });
});

describe('users', () => {
  it('records a created user with the fields set, never the password', async () => {
    mocks.db.user.create.mockImplementation(async ({ data }) => ({ ...member, ...data, id: 'user-2' }));
    const response = await createUser(req('/api/users', 'POST', {
      username: 'newbie', displayName: 'New', password: PASSWORD, role: 'admin',
    }));
    expect(response.status).toBe(201);
    expect(events()).toEqual([expect.objectContaining({
      action: 'USER_CREATED', actorUserId: 'admin-1', actorUsername: 'admin', targetId: 'user-2', targetLabel: 'newbie',
      fields: ['username', 'displayName', 'role', 'password'],
    })]);
    expectNoSecrets();
  });

  it('records a role change and a password reset by name, with the sessions the reset signed out', async () => {
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, ...data }));
    mocks.db.session.updateMany.mockResolvedValue({ count: 2 });
    const response = await updateUser(req('/api/users/user-1', 'PATCH', { role: 'admin', password: PASSWORD, displayName: 'Member' }), params('user-1'));
    expect(response.status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({
      action: 'USER_UPDATED', targetId: 'user-1', targetLabel: 'member', fields: ['made admin', 'template', 'password'], count: 2,
    })]);
    expectNoSecrets();
  });

  it('records a demotion as "made member"', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ ...member, role: 'admin', template: 'admin' });
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, role: 'admin', template: 'admin', ...data }));
    const response = await updateUser(req('/api/users/user-1', 'PATCH', { role: 'member' }), params('user-1'));
    expect(response.status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({ action: 'USER_UPDATED', fields: ['made member', 'template'] })]);
  });

  it('records the API tokens a password reset ended', async () => {
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, ...data }));
    mocks.db.session.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.apiToken.deleteMany.mockResolvedValue({ count: 2 });
    expect((await updateUser(req('/api/users/user-1', 'PATCH', { password: PASSWORD }), params('user-1'))).status).toBe(200);
    expect(mocks.db.apiToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(events()).toEqual([
      expect.objectContaining({ action: 'USER_UPDATED', fields: ['password'] }),
      expect.objectContaining({ action: 'API_TOKEN_REVOKED', targetId: 'user-1', fields: ['password'], count: 2 }),
    ]);
    expectNoSecrets();
  });

  it('records the calendar feed link a password reset ended', async () => {
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, ...data }));
    mocks.db.session.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.calendarFeedToken.deleteMany.mockResolvedValue({ count: 1 });
    expect((await updateUser(req('/api/users/user-1', 'PATCH', { password: PASSWORD }), params('user-1'))).status).toBe(200);
    expect(events()).toEqual([
      expect.objectContaining({ action: 'USER_UPDATED', fields: ['password'] }),
      expect.objectContaining({ action: 'CALENDAR_FEED_REVOKED', targetId: 'user-1', targetLabel: 'member', fields: ['password'] }),
    ]);
    expectNoSecrets();
  });

  it('records an edit without a password reset as one change', async () => {
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, ...data }));
    expect((await updateUser(req('/api/users/user-1', 'PATCH', { displayName: 'Renamed' }), params('user-1'))).status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({ action: 'USER_UPDATED', fields: ['displayName'], count: 1 })]);
    expect(mocks.db.session.updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing for an edit that changed nothing, or one that was refused', async () => {
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, ...data }));
    await updateUser(req('/api/users/user-1', 'PATCH', { displayName: 'Member' }), params('user-1'));
    mocks.db.user.findUnique.mockResolvedValue({ ...member, role: 'admin' });
    mocks.db.user.count.mockResolvedValue(0);
    expect((await updateUser(req('/api/users/user-1', 'PATCH', { role: 'member' }), params('user-1'))).status).toBe(409);
    // Demoting an admin counts the rest under the last-admin guard lock.
    expect(mocks.db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([]);
  });

  it('records a deleted user, and still deletes when the audit write fails', async () => {
    mocks.db.user.delete.mockResolvedValue(member);
    expect((await deleteUser(req('/api/users/user-1', 'DELETE'), params('user-1'))).status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({ action: 'USER_DELETED', targetId: 'user-1', targetLabel: 'member' })]);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.securityAuditEvent.create.mockRejectedValue(new Error('db down'));
    expect((await deleteUser(req('/api/users/user-1', 'DELETE'), params('user-1'))).status).toBe(200);
    expect(mocks.db.user.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('records the capabilities whose effective value changed', async () => {
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, ...data }));
    const response = await putPermissions(
      req('/api/users/user-1/permissions', 'PUT', { permissions: { 'settings.instances': true } }),
      params('user-1'),
    );
    expect(response.status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({
      action: 'USER_PERMISSIONS_CHANGED', targetLabel: 'member', fields: ['settings.instances'],
    })]);
  });

  it('ends and records the calendar feed link when calendar.view is taken away, and keeps it otherwise', async () => {
    mocks.db.user.update.mockImplementation(async ({ data }) => ({ ...member, ...data }));
    await putPermissions(req('/api/users/user-1/permissions', 'PUT', { permissions: { 'settings.instances': true } }), params('user-1'));
    expect(mocks.db.calendarFeedToken.deleteMany).not.toHaveBeenCalled();

    mocks.db.securityAuditEvent.create.mockClear();
    mocks.db.calendarFeedToken.deleteMany.mockResolvedValue({ count: 1 });
    const response = await putPermissions(
      req('/api/users/user-1/permissions', 'PUT', { permissions: { 'calendar.view': false } }),
      params('user-1'),
    );
    expect(response.status).toBe(200);
    expect(mocks.db.calendarFeedToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(events()).toEqual([
      expect.objectContaining({ action: 'USER_PERMISSIONS_CHANGED', fields: ['calendar.view'] }),
      expect.objectContaining({ action: 'CALENDAR_FEED_REVOKED', targetId: 'user-1', targetLabel: 'member', fields: ['calendar.view'] }),
    ]);
  });

  it('records a self password change with the sessions it signed out', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...member }, session: { id: 'session-1' } });
    mocks.verifyUserPassword.mockResolvedValue(true);
    mocks.db.user.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.session.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 3 });
    const response = await changeOwnPassword(req('/api/me/password', 'POST', { currentPassword: 'old passphrase', newPassword: PASSWORD }));
    expect(response.status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({
      action: 'PASSWORD_CHANGED', actorUserId: 'user-1', targetId: 'user-1', fields: ['password'], count: 3,
    })]);
    expectNoSecrets();
  });

  it('records a wrong current password as a failed sign-in, and changes nothing', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...member }, session: { id: 'session-1' } });
    mocks.verifyUserPassword.mockResolvedValue(false);
    const response = await changeOwnPassword(req('/api/me/password', 'POST', { currentPassword: 'a wrong guess', newPassword: PASSWORD }));
    expect(response.status).toBe(403);
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
    expect(mocks.db.securityAuditEvent.upsert.mock.calls[0][0].create).toMatchObject({
      action: 'LOGIN_FAILED', actorUserId: 'user-1', actorUsername: 'member', targetId: 'user-1', targetLabel: 'member', fields: ['password'],
    });
  });
});

describe('Jellyfin self-link', () => {
  beforeEach(() => {
    mocks.db.serviceConnection.findFirst.mockResolvedValue({ url: 'http://jf.lan' });
  });

  it('records a wrong Jellyfin password with the signed-in member as the actor', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...member }, session: { id: 'session-1' } });
    mocks.authenticateByName.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });
    mocks.db.user.findFirst.mockResolvedValue(null);

    const response = await linkJellyfin(req('/api/account/jellyfin/link', 'POST', { username: 'jf-member', password: PASSWORD }));
    expect(response.status).toBe(401);
    expect(mocks.db.securityAuditEvent.upsert.mock.calls.map((call) => call[0].create)).toEqual([expect.objectContaining({
      action: 'LOGIN_FAILED', actorUserId: 'user-1', actorUsername: 'member', targetId: null,
      targetLabel: 'jf-member', fields: ['jellyfin'],
    })]);
    expectNoSecrets();
  });

  it('records a different Jellyfin account than the linked one, and links nothing', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...member, jellyfinUserId: 'jf-1' }, session: { id: 'session-1' } });
    mocks.authenticateByName.mockResolvedValue({ ok: true, userId: 'jf-2', accessToken: 'jf-token', userName: 'someone' });

    const response = await linkJellyfin(req('/api/account/jellyfin/link', 'POST', { username: 'someone', password: PASSWORD }));
    expect(response.status).toBe(409);
    expect(mocks.db.user.update).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
    expect(mocks.db.securityAuditEvent.upsert.mock.calls.map((call) => call[0].create)).toEqual([expect.objectContaining({
      action: 'LOGIN_FAILED', actorUserId: 'user-1', targetLabel: 'someone', fields: ['jellyfin-wrong-account'],
    })]);
    expect(JSON.stringify(mocks.db.securityAuditEvent.upsert.mock.calls)).not.toContain('jf-token');
  });
});

describe('sessions', () => {
  it('records a single revoke with whose session it was, and a bulk revoke with its count', async () => {
    mocks.db.session.findUnique.mockResolvedValue({ id: 's-9', revokedAt: null, userId: 'user-1', user: { username: 'member' } });
    expect((await revokeOne(req('/api/sessions/s-9/revoke', 'POST'), params('s-9'))).status).toBe(200);
    mocks.db.session.updateMany.mockResolvedValue({ count: 2 });
    expect((await revokeOthers(req('/api/sessions/revoke-others', 'POST'))).status).toBe(200);
    mocks.db.session.updateMany.mockResolvedValue({ count: 0 });
    await revokeOthers(req('/api/sessions/revoke-others', 'POST'));

    expect(events()).toEqual([
      expect.objectContaining({ action: 'SESSION_REVOKED', targetType: 'session', targetId: 's-9', targetLabel: 'member' }),
      expect.objectContaining({ action: 'SESSION_REVOKED', targetType: 'user', targetId: 'admin-1', count: 2 }),
    ]);
  });
});

describe('service connections', () => {
  it('records a new connection and a key change by field name only', async () => {
    mocks.db.serviceConnection.create.mockImplementation(async ({ data }) => ({ ...sonarr, ...data, id: 'svc-2' }));
    expect((await saveService(req('/api/services', 'POST', { type: 'SONARR', url: 'http://new.lan:8989', apiKey: API_KEY, label: '4K' }))).status).toBe(200);

    mocks.db.serviceConnection.findUnique.mockResolvedValue(sonarr);
    mocks.db.serviceConnection.update.mockImplementation(async ({ data }) => ({ ...sonarr, ...data }));
    expect((await saveService(req('/api/services', 'POST', { id: 'svc-1', type: 'SONARR', url: sonarr.url, apiKey: API_KEY }))).status).toBe(200);

    expect(events()).toEqual([
      expect.objectContaining({ action: 'SERVICE_CREATED', targetId: 'svc-2', targetLabel: 'Sonarr · 4K', fields: ['url', 'apiKey'] }),
      expect.objectContaining({ action: 'SERVICE_UPDATED', targetId: 'svc-1', targetLabel: 'Sonarr · HD', fields: ['apiKey'] }),
    ]);
    expectNoSecrets();
  });

  it('does not name customHeaders when a URL change only turns no headers into none', async () => {
    mocks.db.serviceConnection.findUnique.mockResolvedValue(sonarr);
    mocks.db.serviceConnection.update.mockImplementation(async ({ data }) => ({ ...sonarr, ...data }));
    await saveService(req('/api/services', 'POST', { id: 'svc-1', type: 'SONARR', url: 'http://moved.lan:8989', apiKey: API_KEY }));
    expect(events()).toEqual([expect.objectContaining({ fields: ['url', 'apiKey'] })]);
  });

  it('records Twitch credentials by name, and nothing when only the app token renews', async () => {
    let stored: Record<string, unknown> | null = null;
    mocks.db.serviceConnection.findFirst.mockImplementation(async () => stored);
    mocks.db.serviceConnection.create.mockResolvedValue({ id: 'tw-1' });
    mocks.db.serviceConnection.update.mockResolvedValue({ id: 'tw-1' });
    await saveTwitch(req('/api/services/twitch', 'POST', { clientId: 'client-a', clientSecret: API_KEY }));
    stored = { id: 'tw-1', url: 'https://api.twitch.tv/helix', externalUrl: 'client-a', apiKey: API_KEY };
    await saveTwitch(req('/api/services/twitch', 'POST', { clientId: 'client-a', clientSecret: API_KEY }));
    await saveTwitch(req('/api/services/twitch', 'POST', { clientId: 'client-b', clientSecret: API_KEY }));

    expect(events()).toEqual([
      expect.objectContaining({ action: 'SERVICE_CREATED', targetId: 'tw-1', targetLabel: 'Twitch', fields: ['clientId', 'clientSecret'] }),
      expect.objectContaining({ action: 'SERVICE_UPDATED', fields: ['clientId'] }),
    ]);
    expectNoSecrets();
  });

  it('records each connection the Seerr/Prowlarr import adds', async () => {
    mocks.importServices.mockImplementation(async (_items, onCreated) => {
      await onCreated({ id: 'svc-7', type: 'RADARR', label: '4K' });
      return [{ id: 'prowlarr:5', ok: true, label: '4K' }];
    });
    expect((await importServicesRoute(req('/api/services/import', 'POST', { items: [{ id: 'prowlarr:5', apiKey: API_KEY }] }))).status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({
      action: 'SERVICE_CREATED', actorUserId: 'admin-1', targetId: 'svc-7', targetLabel: 'Radarr · 4K', fields: ['url', 'apiKey'],
    })]);
  });

  it('records a rename and a delete', async () => {
    mocks.db.serviceConnection.findUnique
      .mockResolvedValueOnce(sonarr)
      .mockResolvedValueOnce({ ...sonarr, label: 'Main' })
      .mockResolvedValueOnce(sonarr);
    await patchService(req('/api/services/svc-1', 'PATCH', { label: 'Main' }), params('svc-1'));
    expect((await deleteService(req('/api/services/svc-1', 'DELETE'), params('svc-1'))).status).toBe(200);
    expect(events()).toEqual([
      expect.objectContaining({ action: 'SERVICE_UPDATED', targetLabel: 'Sonarr · Main', fields: ['label'] }),
      expect.objectContaining({ action: 'SERVICE_DELETED', targetId: 'svc-1', targetLabel: 'Sonarr · HD' }),
    ]);
  });
});

describe('settings import', () => {
  it('records the sections that wrote something', async () => {
    mocks.applySettingsImport.mockResolvedValue({
      applied: {
        appSettings: true, services: ['SONARR'], notificationRules: 0, cleanup: false, twitchSubscriptions: 0,
        dashboardLayouts: 0, watchlistItems: 0, watchlistTags: 0, scheduledAlerts: 0, animeMappings: 0, users: 2,
      },
      skipped: [],
      discoverLayoutApplied: false,
      followUps: {},
    });
    const response = await importSettings(req('/api/settings/import', 'POST', { version: 1 }));
    expect(response.status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({
      action: 'SETTINGS_IMPORTED', targetType: 'settings', fields: ['appSettings', 'services', 'users'],
    })]);
  });
});

describe('GET /api/security-audit', () => {
  it('is admin only', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await listSecurityAudit(req('/api/security-audit', 'GET'))).status).toBe(403);
    expect(mocks.db.securityAuditEvent.findMany).not.toHaveBeenCalled();
  });

  it('lists newest first and keeps the coalescing key on the server', async () => {
    mocks.db.securityAuditEvent.findMany.mockResolvedValue([]);
    mocks.db.securityAuditEvent.count.mockResolvedValue(0);
    const response = await listSecurityAudit(req('/api/security-audit?pageSize=20', 'GET'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.db.securityAuditEvent.findMany).toHaveBeenCalledWith({
      where: {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 20, omit: { coalesceKey: true },
    });
  });

  it('pages, and hides failed sign-ins from the rows and the total on request', async () => {
    mocks.db.securityAuditEvent.findMany.mockResolvedValue([]);
    mocks.db.securityAuditEvent.count.mockResolvedValue(0);
    const response = await listSecurityAudit(req('/api/security-audit?page=3&pageSize=50&hideFailedSignIns=1', 'GET'));
    expect(response.status).toBe(200);
    const where = { action: { notIn: ['LOGIN_FAILED', 'INVITE_LINK_FAILED'] } };
    expect(mocks.db.securityAuditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 100, take: 50 }));
    expect(mocks.db.securityAuditEvent.count).toHaveBeenCalledWith({ where });
  });
});
