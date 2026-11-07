import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  upsert: vi.fn(),
  findUser: vi.fn(),
  clientIp: vi.fn<() => string | undefined>(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    securityAuditEvent: { create: mocks.create, upsert: mocks.upsert },
    user: { findFirst: mocks.findUser },
  },
}));
vi.mock('@/lib/login-rate-limit', () => ({ getClientIp: mocks.clientIp }));

import {
  changedFieldNames,
  coarseIp,
  typedUsernameLabel,
  recordFailedLinkAttempt,
  recordFailedSignIn,
  recordSecurityEvent,
  serviceTargetLabel,
} from '@/lib/security-audit';
import { runWithRequestContext } from '@/lib/request-context';

function request(userAgent = 'Mozilla/5.0 (iPhone)'): NextRequest {
  return new NextRequest('http://localhost/api/anything', { method: 'POST', headers: { 'user-agent': userAgent } });
}

describe('coarseIp', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['::ffff:198.51.100.9', '198.51.100.0/24'],
    ['::FFFF:198.51.100.9', '198.51.100.0/24'],
    ['0:0:0:0:0:ffff:198.51.100.9', '198.51.100.0/24'],
    ['0000:0000:0000:0000:0000:ffff:198.51.100.9', '198.51.100.0/24'],
    ['::ffff:c633:6409', '198.51.100.0/24'],
    ['::ffff:0:c633:6409', '0:0:0:0::/64'],
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['1:2::4:5:6:1.2.3.4', '1:2:0:4::/64'],
    ['::1', '0:0:0:0::/64'],
    ['not-an-ip', null],
    [undefined, null],
  ] as Array<[string | undefined, string | null]>)('%s → %s', (ip, expected) => {
    expect(coarseIp(ip)).toBe(expected);
  });
});

describe('changedFieldNames and serviceTargetLabel', () => {
  it('names only the keys whose values changed', () => {
    expect(changedFieldNames(
      { role: 'member', status: 'active', username: 'a' },
      { role: 'admin', status: 'active' },
      ['role', 'status', 'username'],
    )).toEqual(['role']);
  });

  it('labels named instances and single services', () => {
    expect(serviceTargetLabel('SONARR', 'HD')).toBe('Sonarr · HD');
    expect(serviceTargetLabel('SONARR', 'Sonarr')).toBe('Sonarr');
    expect(serviceTargetLabel('TWITCH', 'Twitch')).toBe('Twitch');
  });
});

describe('recordSecurityEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientIp.mockReturnValue('203.0.113.77');
    mocks.create.mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it('stores the actor, target, field names, coarse IP, a bounded user agent and the request id', async () => {
    await runWithRequestContext({ requestId: 'req-1', startedAt: new Date() }, () =>
      recordSecurityEvent(request('x'.repeat(1000)), {
        actor: { id: 'admin-1', username: 'admin' },
        action: 'USER_UPDATED',
        targetType: 'user',
        targetId: 'user-1',
        targetLabel: 'member',
        fields: ['role', 'password'],
      }));

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-1',
        actorUsername: 'admin',
        action: 'USER_UPDATED',
        targetType: 'user',
        targetId: 'user-1',
        targetLabel: 'member',
        fields: ['role', 'password'],
        count: 1,
        ip: '203.0.113.0/24',
        userAgent: 'x'.repeat(256),
        requestId: 'req-1',
      },
    });
  });

  it('is fail-soft: a failed write resolves and logs no arguments', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('Invalid value: secret-hash-123'), { code: 'P2021' });
    mocks.create.mockRejectedValue(failure);

    await expect(recordSecurityEvent(request(), {
      actor: { id: 'u', username: 'u' },
      action: 'USER_DELETED',
      targetType: 'user',
    })).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('[SecurityAudit] Failed to write audit row: Error P2021');
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-hash-123');
  });
});

describe('recordFailedSignIn', () => {
  const minute = Date.UTC(2026, 10, 6, 12, 0, 0);
  const alice = { id: 'user-a', username: 'alice' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientIp.mockReturnValue('203.0.113.77');
    mocks.upsert.mockResolvedValue({});
    mocks.findUser.mockResolvedValue(null);
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret-for-audit-keys');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function keyOf(call: number): string {
    return mocks.upsert.mock.calls[call][0].where.coalesceKey;
  }
  function created(call: number) {
    return mocks.upsert.mock.calls[call][0].create;
  }

  it('stores a known account and coarse IP with no actor, and adds repeats to one row', async () => {
    await recordFailedSignIn(request(), { username: 'alice', method: 'password', user: alice, nowMs: minute + 1_000 });
    await recordFailedSignIn(request(), { username: 'alice', method: 'password', user: alice, nowMs: minute + 59_000 });

    const args = mocks.upsert.mock.calls[0][0];
    expect(args.update).toEqual({ count: { increment: 1 } });
    expect(args.create).toMatchObject({
      actorUserId: null,
      actorUsername: null,
      action: 'LOGIN_FAILED',
      targetType: 'user',
      targetId: 'user-a',
      targetLabel: 'alice',
      fields: ['password'],
      ip: '203.0.113.0/24',
    });
    expect(args.create.coalesceKey).toMatch(/^[0-9a-f]{64}$/);
    // The key is a hash: the username is not readable from it.
    expect(keyOf(0)).not.toContain('alice');
    expect(keyOf(1)).toBe(keyOf(0));
    // The caller said who it is: no lookup.
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it('keeps a name that matches no account as typed (owner decision 2026-11-07)', async () => {
    const typo = 'hunter2-correct-horse';
    await recordFailedSignIn(request(), { username: typo, method: 'password', user: null, nowMs: minute });
    await recordFailedSignIn(request(), { username: typo, method: 'password', user: null, nowMs: minute + 5_000 });

    expect(created(0)).toMatchObject({ targetId: null, targetLabel: typo });
    expect(keyOf(1)).toBe(keyOf(0));
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it('strips control and bidi characters from a typed name and caps its length', async () => {
    await recordFailedSignIn(request(), { username: 'ev\u0000il\u202Egnp.exe\u200B\u0007', method: 'password', user: null, nowMs: minute });
    expect(created(0).targetLabel).toBe('evilgnp.exe');
    await recordFailedSignIn(request(), { username: '😀'.repeat(70), method: 'password', user: null, nowMs: minute });
    expect(created(1).targetLabel).toBe('😀'.repeat(64));
  });

  it('keys rows with an HMAC under the server secret, not a bare hash of what the row shows', async () => {
    const typo = 'hunter2-correct-horse';
    await recordFailedSignIn(request(), { username: typo, method: 'password', user: null, nowMs: minute });
    const row = created(0);
    // Everything else in the key is readable from the row; a bare hash of it would confirm a guess.
    const minuteBucket = Math.floor(minute / 60_000);
    for (const parts of [
      ['LOGIN_FAILED', 'password', minuteBucket, typo, row.ip],
      ['LOGIN_FAILED', 'password', minuteBucket, typo, row.ip, null],
      ['security-audit:LOGIN_FAILED', 'password', minuteBucket, typo, row.ip, null],
    ]) {
      expect(keyOf(0)).not.toBe(createHash('sha256').update(JSON.stringify(parts)).digest('hex'));
    }
    vi.stubEnv('JWT_SECRET', 'another-secret-entirely');
    await recordFailedSignIn(request(), { username: typo, method: 'password', user: null, nowMs: minute });
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('writes no row without a server secret, and does not throw', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('APP_PASSWORD', '');
    await expect(recordFailedSignIn(request(), { username: 'alice', method: 'password', user: alice })).resolves.toBeUndefined();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[SecurityAudit] Failed to write audit row: Error');
  });

  it('looks the name up when the caller does not know the account', async () => {
    mocks.findUser.mockResolvedValueOnce(alice).mockResolvedValueOnce(null);
    await recordFailedSignIn(request(), { username: 'alice', method: 'jellyfin', nowMs: minute });
    await recordFailedSignIn(request(), { username: 'stranger', method: 'jellyfin', nowMs: minute });

    expect(mocks.findUser).toHaveBeenCalledWith({
      where: { username: 'alice', status: 'active' },
      select: { id: true, username: true },
    });
    expect(created(0)).toMatchObject({ targetId: 'user-a', targetLabel: 'alice' });
    expect(created(1)).toMatchObject({ targetId: null, targetLabel: 'stranger' });
  });

  it('keeps a name Jellyfin accepted, and records the signed-in actor of a self-service failure', async () => {
    await recordFailedSignIn(request(), {
      username: 'jf-bob', method: 'jellyfin-wrong-account', nameIsAccount: true, actor: alice, nowMs: minute,
    });
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(created(0)).toMatchObject({
      actorUserId: 'user-a', actorUsername: 'alice', targetId: null, targetLabel: 'jf-bob', fields: ['jellyfin-wrong-account'],
    });
  });

  it('starts a new row for a new minute, username, network, method or actor', async () => {
    const at = (username: string, method: 'password' | 'jellyfin', nowMs: number, actor?: typeof alice) =>
      recordFailedSignIn(request(), { username, method, user: null, nowMs, actor });
    await at('alice', 'password', minute);
    await at('alice', 'password', minute + 60_000);
    await at('bob', 'password', minute);
    await at('alice', 'jellyfin', minute);
    await at('alice', 'password', minute, alice);
    mocks.clientIp.mockReturnValue('198.51.100.1');
    await at('alice', 'password', minute);
    // Same /24: the same row.
    mocks.clientIp.mockReturnValue('203.0.113.200');
    await at('alice', 'password', minute);

    const keys = mocks.upsert.mock.calls.map((_, index) => keyOf(index));
    expect(new Set(keys.slice(0, 6)).size).toBe(6);
    expect(keys[6]).toBe(keys[0]);
  });

  it('is fail-soft, also when the account lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.upsert.mockRejectedValue(new Error('db down'));
    await expect(recordFailedSignIn(request(), { username: 'alice', method: 'password', user: null })).resolves.toBeUndefined();
    mocks.findUser.mockRejectedValue(new Error('db down'));
    await expect(recordFailedSignIn(request(), { username: 'alice', method: 'jellyfin' })).resolves.toBeUndefined();
  });
});

describe('recordFailedLinkAttempt', () => {
  const minute = Date.UTC(2026, 10, 6, 12, 0, 0);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientIp.mockReturnValue('203.0.113.77');
    mocks.upsert.mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  function keyOf(call: number): string {
    return mocks.upsert.mock.calls[call][0].where.coalesceKey;
  }

  it('keeps one row per network and minute, with no actor, target or token', async () => {
    await recordFailedLinkAttempt(request(), minute + 1_000);
    await recordFailedLinkAttempt(request(), minute + 59_000);
    await recordFailedLinkAttempt(request(), minute + 60_000);
    mocks.clientIp.mockReturnValue('198.51.100.1');
    await recordFailedLinkAttempt(request(), minute);

    const args = mocks.upsert.mock.calls[0][0];
    expect(args.update).toEqual({ count: { increment: 1 } });
    expect(args.create).toMatchObject({
      actorUserId: null,
      action: 'INVITE_LINK_FAILED',
      targetType: 'user',
      targetId: null,
      targetLabel: null,
      ip: '203.0.113.0/24',
    });
    expect(keyOf(1)).toBe(keyOf(0));
    expect(new Set([keyOf(0), keyOf(2), keyOf(3)]).size).toBe(3);
  });

  it('is fail-soft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.upsert.mockRejectedValue(new Error('db down'));
    await expect(recordFailedLinkAttempt(request())).resolves.toBeUndefined();
  });
});

describe('typedUsernameLabel', () => {
  it('keeps ordinary text, emoji and accents as typed', () => {
    expect(typedUsernameLabel('Zoë 😀 smith')).toBe('Zoë 😀 smith');
  });

  it('removes format characters and separators, and names a label with nothing left', () => {
    expect(typedUsernameLabel('a\u00ADb\u061Cc\u2028d\u2029e\uFFF9f\u{E0041}g')).toBe('abcdefg');
    expect(typedUsernameLabel('\u200B\u202E')).toBe('(unprintable)');
  });
});
