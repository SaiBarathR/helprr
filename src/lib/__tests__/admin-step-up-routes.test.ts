import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Secret, TOTP } from 'otpauth';

// Giving admin (creating one, making someone admin, a way into another admin's
// account) needs the acting admin's current password, plus a code while their
// two-step sign-in is on. The real password/code checks and TOTP, with the
// database, Redis, throttles and audit mocked. Members are unchanged.

const mocks = vi.hoisted(() => {
  const tx = {
    user: { count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    session: { updateMany: vi.fn() },
    recoveryCode: { deleteMany: vi.fn() },
    passwordLink: { deleteMany: vi.fn(), upsert: vi.fn() },
    calendarFeedToken: { deleteMany: vi.fn() },
    apiToken: { deleteMany: vi.fn() },
    // The last-admin guard's lock.
    $executeRaw: vi.fn(async () => 0),
    // The link route's lock on the target's row: answers their role as it is now.
    $queryRaw: vi.fn(),
  };
  return {
    tx,
    requireAdmin: vi.fn(),
    verifyUserPassword: vi.fn(),
    hashPassword: vi.fn(),
    userFindUnique: vi.fn(),
    linkUpsert: vi.fn(),
    recoveryDeleteMany: vi.fn(),
    recordFailedSignIn: vi.fn(),
    recordSecurityEvent: vi.fn(),
    changedFieldNames: vi.fn((): string[] => []),
    redisEval: vi.fn(),
    redisDel: vi.fn(),
    limits: {
      enforceLoginRateLimit: vi.fn(),
      enforceUsernameBackoff: vi.fn(),
      recordUsernameFailure: vi.fn(),
      clearUsernameBackoff: vi.fn(),
      enforceGlobalLoginBackstop: vi.fn(),
      recordGlobalLoginFailure: vi.fn(),
    },
  };
});

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, updateMany: vi.fn(async () => ({ count: 1 })) },
    recoveryCode: { deleteMany: mocks.recoveryDeleteMany },
    passwordLink: { upsert: mocks.linkUpsert },
    $transaction: async (fn: (client: unknown) => unknown) => fn(mocks.tx),
  },
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin, verifyUserPassword: mocks.verifyUserPassword }));
vi.mock('@/lib/password', () => ({ hashPassword: mocks.hashPassword }));
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: () => undefined, ...mocks.limits }));
vi.mock('@/lib/security-audit', () => ({
  recordFailedSignIn: mocks.recordFailedSignIn,
  recordSecurityEvent: mocks.recordSecurityEvent,
  changedFieldNames: mocks.changedFieldNames,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ eval: mocks.redisEval, del: mocks.redisDel }) }));
vi.mock('@/lib/recommendations/engine', () => ({ refreshRecommendationsAfterLink: vi.fn(async () => {}) }));

import { POST as createUser } from '@/app/api/users/route';
import { PATCH as updateUser } from '@/app/api/users/[id]/route';
import { POST as issueLink } from '@/app/api/users/[id]/password-link/route';
import { PUT as putPermissions } from '@/app/api/users/[id]/permissions/route';
import { DELETE as turnOffTwoStep } from '@/app/api/users/[id]/totp/route';
import { createTotpSetup } from '@/lib/totp';
import { CAPABILITIES } from '@/lib/capabilities';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const PASSWORD = 'the admin password, long enough';
const NEW_PASSWORD = 'a brand new password here';
let secret: { secret: string; encryptedSecret: string };
let admin: Record<string, unknown>;

function code(): string {
  return new TOTP({ secret: Secret.fromBase32(secret.secret) }).generate({ timestamp: NOW });
}

function request(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function account(id: string, role: 'admin' | 'member') {
  return {
    id,
    username: id,
    displayName: id,
    role,
    status: 'active',
    template: role,
    permissions: {},
    passwordHash: 'stored-hash',
    jellyfinUserId: null,
    seerrUserId: null,
    passwordLink: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
}

const create = (body: Record<string, unknown>) =>
  createUser(request('/api/users', 'POST', { username: 'newbie', displayName: 'Newbie', password: NEW_PASSWORD, ...body }));
const patch = (id: string, body: Record<string, unknown>) =>
  updateUser(request(`/api/users/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) });
const link = (id: string, body: Record<string, unknown> = {}) =>
  issueLink(request(`/api/users/${id}/password-link`, 'POST', body), { params: Promise.resolve({ id }) });
const permissions = (id: string, body: Record<string, unknown>) =>
  putPermissions(request(`/api/users/${id}/permissions`, 'PUT', body), { params: Promise.resolve({ id }) });
const twoStepOffFor = (id: string, body: Record<string, unknown> = {}) =>
  turnOffTwoStep(request(`/api/users/${id}/totp`, 'DELETE', body), { params: Promise.resolve({ id }) });

/** The next read of the target finds it with these fields. */
function targetIs(fields: Record<string, unknown>) {
  mocks.userFindUnique.mockImplementationOnce(async ({ where }: { where: { id: string } }) => ({
    ...account(where.id, where.id.startsWith('admin') ? 'admin' : 'member'),
    ...fields,
  }));
}

function twoStepOff() {
  admin = { ...admin, totpSecret: null, totpEnabledAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', 'a-valid-session-secret-that-is-longer-than-32-characters');
  vi.stubEnv('APP_ORIGIN', '');
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  for (const fn of Object.values(mocks.limits)) fn.mockResolvedValue(null);
  mocks.verifyUserPassword.mockImplementation(async (_user: unknown, password: string) => password === PASSWORD);
  mocks.hashPassword.mockResolvedValue('new-hash');
  mocks.recoveryDeleteMany.mockResolvedValue({ count: 1 });
  mocks.redisEval.mockResolvedValue(['ok', '0']);
  mocks.redisDel.mockResolvedValue(1);
  mocks.linkUpsert.mockResolvedValue({});
  mocks.tx.user.count.mockResolvedValue(1);
  mocks.tx.user.create.mockImplementation(async ({ data }) => ({ ...account('created', data.role), ...data }));
  mocks.tx.user.update.mockImplementation(async ({ where, data }) => ({ ...account(where.id, 'member'), ...data }));
  mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.user.findUnique.mockResolvedValue({ role: 'admin' });
  mocks.tx.recoveryCode.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.session.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.passwordLink.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.passwordLink.upsert.mockResolvedValue({});
  mocks.tx.$queryRaw.mockImplementation(async (_sql: TemplateStringsArray, id: string) =>
    [{ role: id.startsWith('admin') ? 'admin' : 'member', totpEnabledAt: null }]);
  mocks.tx.calendarFeedToken.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.apiToken.deleteMany.mockResolvedValue({ count: 0 });
  secret = createTotpSetup('boss');
  admin = {
    ...account('admin-1', 'admin'),
    username: 'boss',
    totpSecret: secret.encryptedSecret,
    totpEnabledAt: new Date(NOW - 86_400_000),
    totpLastUsedStep: null,
  };
  mocks.requireAdmin.mockImplementation(async () => ({ ok: true, user: admin }));
  mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id.startsWith('admin') ? account(where.id, 'admin') : account(where.id, 'member'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function expectNothingWritten() {
  expect(mocks.tx.user.create).not.toHaveBeenCalled();
  expect(mocks.tx.user.update).not.toHaveBeenCalled();
  expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  expect(mocks.linkUpsert).not.toHaveBeenCalled();
  expect(mocks.tx.passwordLink.upsert).not.toHaveBeenCalled();
  expect(mocks.hashPassword).not.toHaveBeenCalled();
  // The guards ran before any transaction.
  expect(mocks.tx.$queryRaw).not.toHaveBeenCalled();
}

// Each step that gives admin, and what it writes once confirmed.
const STEPS = [
  {
    name: 'creating an admin',
    run: (extra: Record<string, unknown>) => create({ role: 'admin', ...extra }),
    written: () => expect(mocks.tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'admin' }) })),
    status: 201,
  },
  {
    name: 'making a member admin',
    run: (extra: Record<string, unknown>) => patch('member-1', { role: 'admin', ...extra }),
    written: () => expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'admin' }) })),
    status: 200,
  },
  {
    name: "setting another admin's password",
    run: (extra: Record<string, unknown>) => patch('admin-2', { password: NEW_PASSWORD, ...extra }),
    written: () => expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ passwordHash: 'new-hash' }) })),
    status: 200,
  },
  {
    name: "changing another admin's Jellyfin link",
    run: (extra: Record<string, unknown>) => patch('admin-2', { jellyfinUserId: 'jf-attacker', ...extra }),
    written: () => expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jellyfinUserId: 'jf-attacker' }) })),
    status: 200,
  },
  {
    name: 'a reset link for another admin',
    run: (extra: Record<string, unknown>) => link('admin-2', extra),
    written: () => expect(mocks.tx.passwordLink.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 'admin-2', purpose: 'reset' }) })),
    status: 201,
  },
  {
    name: 'turning a disabled admin back on',
    run: (extra: Record<string, unknown>) => {
      targetIs({ status: 'disabled' });
      return patch('admin-2', { status: 'active', ...extra });
    },
    written: () => expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'admin-2', status: 'disabled', role: 'admin' },
      data: expect.objectContaining({ status: 'active' }),
    })),
    status: 200,
  },
  {
    name: 'giving a member the Admin template',
    run: (extra: Record<string, unknown>) => permissions('member-1', { template: 'admin', ...extra }),
    written: () => expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'member-1', role: 'member', template: 'member' },
      data: expect.objectContaining({ template: 'admin' }),
    })),
    status: 200,
  },
  {
    name: 'creating a member with the Admin template',
    run: (extra: Record<string, unknown>) => create({ role: 'member', template: 'admin', ...extra }),
    written: () => expect(mocks.tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'member', template: 'admin' }),
    })),
    status: 201,
  },
  {
    name: "turning off another admin's two-step sign-in",
    run: (extra: Record<string, unknown>) => {
      targetIs({ totpEnabledAt: new Date(NOW) });
      return twoStepOffFor('admin-2', extra);
    },
    written: () => expect(mocks.tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'admin-2', role: 'admin' }),
      data: expect.objectContaining({ totpSecret: null, totpEnabledAt: null }),
    })),
    status: 200,
  },
];

describe.each(STEPS)('$name, acting admin with two-step sign-in on', ({ run, written, status }) => {
  it.each([
    ['nothing', {}],
    ['the password without a code', { currentPassword: PASSWORD }],
    ['a code without the password', { code: '123456' }],
  ])('refuses %s with 403, asking for both, and writes nothing', async (_label, body) => {
    const response = await run(body);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ needsStepUp: true, needsCode: true });
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it('refuses a wrong password, counted as a failed sign-in', async () => {
    const response = await run({ currentPassword: 'not it', code: code() });
    expect(response.status).toBe(403);
    expect(mocks.limits.recordUsernameFailure).toHaveBeenCalledWith('boss', 'not it');
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'password' }));
    expectNothingWritten();
  });

  it('refuses a wrong code, counted against the code cap', async () => {
    const wrong = code() === '000000' ? '111111' : '000000';
    const response = await run({ currentPassword: PASSWORD, code: wrong });
    expect(response.status).toBe(403);
    expect((await response.json()).field).toBe('code');
    expect(mocks.redisEval).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailedSignIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'totp' }));
    expectNothingWritten();
  });

  it('fails closed when Redis is down', async () => {
    mocks.redisEval.mockRejectedValue(new Error('down'));
    expect((await run({ currentPassword: PASSWORD, code: code() })).status).toBe(503);
    expectNothingWritten();
  });

  it('goes ahead with the right password and code, and clears the counts', async () => {
    const response = await run({ currentPassword: PASSWORD, code: code() });
    expect(response.status).toBe(status);
    written();
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('boss');
  });

  it('accepts a recovery code, uses it up and records it', async () => {
    const response = await run({ currentPassword: PASSWORD, code: 'ABCD-EFGH-JKLM-NPQR' });
    expect(response.status).toBe(status);
    expect(mocks.recoveryDeleteMany).toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'MFA_RECOVERY_CODE_USED', targetId: 'admin-1',
    }));
    written();
  });
});

describe.each(STEPS)('$name, acting admin with two-step sign-in off', ({ run, written, status }) => {
  it('refuses with no password, asking for the password only', async () => {
    twoStepOff();
    const response = await run({});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ needsStepUp: true, needsCode: false });
    expectNothingWritten();
  });

  it('refuses a wrong password', async () => {
    twoStepOff();
    expect((await run({ currentPassword: 'not it' })).status).toBe(403);
    expect(mocks.recordFailedSignIn).toHaveBeenCalled();
    expectNothingWritten();
  });

  it('goes ahead with the right password alone, no code asked', async () => {
    twoStepOff();
    const response = await run({ currentPassword: PASSWORD });
    expect(response.status).toBe(status);
    expect(mocks.redisEval).not.toHaveBeenCalled();
    expect(mocks.limits.clearUsernameBackoff).toHaveBeenCalledWith('boss');
    written();
  });

  it('refuses, closed, an acting admin with no Helprr password', async () => {
    twoStepOff();
    admin = { ...admin, passwordHash: null };
    const response = await run({ currentPassword: PASSWORD });
    expect(response.status).toBe(403);
    expect((await response.json()).needsStepUp).toBeUndefined();
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expectNothingWritten();
  });
});

describe('members are unchanged: no password or code asked', () => {
  function expectNoStepUp() {
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.redisEval).not.toHaveBeenCalled();
  }

  it('creates a member', async () => {
    expect((await create({ role: 'member' })).status).toBe(201);
    expectNoStepUp();
  });

  it("edits a member, their password and Jellyfin link included", async () => {
    expect((await patch('member-1', { displayName: 'New name', password: NEW_PASSWORD, jellyfinUserId: 'jf-9' })).status).toBe(200);
    expectNoStepUp();
  });

  it("makes a member's reset link", async () => {
    expect((await link('member-1')).status).toBe(201);
    expectNoStepUp();
  });

  it("edits another admin's display name, or demotes them", async () => {
    expect((await patch('admin-2', { displayName: 'Other' })).status).toBe(200);
    expect((await patch('admin-2', { role: 'member' })).status).toBe(200);
    expectNoStepUp();
  });

  it('keeps an admin role already held (no promotion)', async () => {
    expect((await patch('admin-2', { role: 'admin' })).status).toBe(200);
    expectNoStepUp();
  });

  it('a member made admin meanwhile gets no link without the step-up', async () => {
    mocks.tx.$queryRaw.mockResolvedValue([{ role: 'admin', totpEnabledAt: null }]);
    expect((await link('member-1')).status).toBe(409);
    expect(mocks.tx.passwordLink.upsert).not.toHaveBeenCalled();
  });
});

describe('making someone admin', () => {
  it('ends their outstanding link, made without the step-up, and says so in the audit', async () => {
    twoStepOff();
    mocks.tx.passwordLink.deleteMany.mockResolvedValue({ count: 1 });
    expect((await patch('member-1', { role: 'admin', currentPassword: PASSWORD })).status).toBe(200);
    expect(mocks.tx.passwordLink.deleteMany).toHaveBeenCalledWith({ where: { userId: 'member-1' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'USER_UPDATED', fields: expect.arrayContaining(['passwordLink']),
    }));
  });

  it('writes only to the role it read, so a demotion meanwhile cannot be undone without the step-up', async () => {
    expect((await patch('admin-2', { role: 'admin' })).status).toBe(200);
    expect(mocks.tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'admin-2', role: 'admin' } }));
    mocks.tx.user.update.mockRejectedValueOnce(Object.assign(new Error('changed'), { code: 'P2025' }));
    expect((await patch('admin-2', { role: 'admin' })).status).toBe(409);
  });
});

describe('round 10: members and other steps are unchanged', () => {
  function expectNoStepUp() {
    expect(mocks.verifyUserPassword).not.toHaveBeenCalled();
    expect(mocks.redisEval).not.toHaveBeenCalled();
  }

  it('turns a disabled member back on', async () => {
    targetIs({ status: 'disabled' });
    expect((await patch('member-1', { status: 'active' })).status).toBe(200);
    expectNoStepUp();
  });

  it('disables an admin without asking', async () => {
    expect((await patch('admin-2', { status: 'disabled' })).status).toBe(200);
    expectNoStepUp();
  });

  it('gives a member the Member template, or toggles a capability', async () => {
    targetIs({ template: 'admin' });
    expect((await permissions('member-1', { template: 'member' })).status).toBe(200);
    expect((await permissions('member-1', { permissions: { 'settings.instances': true } })).status).toBe(200);
    expectNoStepUp();
  });

  it('re-applies the Admin template a member already has', async () => {
    targetIs({ template: 'admin' });
    expect((await permissions('member-1', { template: 'admin' })).status).toBe(200);
    expectNoStepUp();
  });

  it("turns off a member's two-step sign-in", async () => {
    targetIs({ totpEnabledAt: new Date(NOW) });
    mocks.tx.user.findUnique.mockResolvedValue({ role: 'member' });
    expect((await twoStepOffFor('member-1')).status).toBe(200);
    expectNoStepUp();
  });

  it("refuses an admin's two-step that is already off before asking for a code", async () => {
    const response = await twoStepOffFor('admin-2', { currentPassword: PASSWORD, code: code() });
    expect(response.status).toBe(409);
    expectNoStepUp();
  });

  it('a disabled admin cannot come back on through pending without the step-up', async () => {
    targetIs({ status: 'disabled' });
    expect((await patch('admin-2', { status: 'pending' })).status).toBe(200);
    targetIs({ status: 'pending' });
    const response = await patch('admin-2', { status: 'active' });
    expect(response.status).toBe(403);
    expect((await response.json()).needsStepUp).toBe(true);
  });

  it('turning on the last capabilities one by one, or re-applying the Admin template over turned-off ones, asks', async () => {
    const all = Object.fromEntries(CAPABILITIES.map((cap) => [cap, true]));
    let response = await permissions('member-1', { permissions: all });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ needsStepUp: true, error: expect.stringMatching(/^Giving every capability/) });

    targetIs({ template: 'admin', permissions: { 'settings.instances': false } });
    response = await permissions('member-1', { template: 'admin' });
    expect(response.status).toBe(403);
    targetIs({ template: 'admin', permissions: { 'settings.instances': false } });
    expect((await permissions('member-1', { resetToTemplate: true })).status).toBe(403);
    targetIs({ template: 'admin', permissions: { 'settings.instances': false, 'settings.backup': false } });
    expect((await permissions('member-1', { permissions: { ...all, 'settings.backup': false } })).status).toBe(200);
    expect(mocks.tx.user.update).toHaveBeenCalledTimes(1);
  });

  it('a member given the Admin template or made admin meanwhile: 409, nothing given', async () => {
    mocks.tx.user.update.mockRejectedValueOnce(Object.assign(new Error('changed'), { code: 'P2025' }));
    expect((await permissions('member-1', { template: 'member' })).status).toBe(409);
    targetIs({ totpEnabledAt: new Date(NOW) });
    mocks.tx.user.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.tx.user.findUnique.mockResolvedValueOnce({ role: 'admin' });
    // A member when read, an admin when written.
    expect((await twoStepOffFor('member-1')).status).toBe(409);
    expect(mocks.tx.recoveryCode.deleteMany).not.toHaveBeenCalled();
  });
});

describe('disabling and turning back on', () => {
  it('a disable ends every session, so turning the account on does not bring them back', async () => {
    mocks.tx.session.updateMany.mockResolvedValue({ count: 3 });
    mocks.changedFieldNames.mockReturnValueOnce(['status']);
    expect((await patch('member-1', { status: 'disabled' })).status).toBe(200);
    expect(mocks.tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'member-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'USER_UPDATED', targetId: 'member-1', count: 3,
    }));
  });

  it('turning an admin back on ends any session left from a disable made before this rule', async () => {
    twoStepOff();
    targetIs({ status: 'disabled' });
    expect((await patch('admin-2', { status: 'active', currentPassword: PASSWORD })).status).toBe(200);
    expect(mocks.tx.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'admin-2', revokedAt: null } }));
  });

  it('a save that does not change the status leaves sessions alone', async () => {
    expect((await patch('member-1', { displayName: 'Same status', status: 'active' })).status).toBe(200);
    expect(mocks.tx.session.updateMany).not.toHaveBeenCalled();
  });
});
