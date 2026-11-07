import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A small in-memory stand-in for the three tables the module touches. A
// transaction restores the snapshot when its callback throws, as PostgreSQL does.
const db = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = { users: [] as Row[], links: [] as Row[], sessions: [] as Row[], feeds: [] as Row[], codes: [] as Row[] };
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const client = {
    passwordLink: {
      upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const row = state.links.find((l) => matches(l, where));
        if (row) Object.assign(row, update);
        else state.links.push({ id: `link-${state.links.length + 1}`, ...create });
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = state.links.find((l) => matches(l, where));
        return row ? { ...row, user: { ...state.users.find((u) => u.id === row.userId)! } } : null;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = state.links.length;
        state.links = state.links.filter((l) => !matches(l, where));
        return { count: before - state.links.length };
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const row = state.links.find((l) => matches(l, where));
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        state.links = state.links.filter((l) => l !== row);
        return { purpose: row.purpose };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = state.users.find((u) => u.id === where.id);
        return row ? { totpEnabledAt: row.totpEnabledAt } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.users.filter((u) => matches(u, where));
        rows.forEach((u) => Object.assign(u, data));
        return { count: rows.length };
      }),
    },
    session: {
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.sessions.filter((s) => matches(s, where));
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      }),
    },
    calendarFeedToken: {
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = state.feeds.length;
        state.feeds = state.feeds.filter((f) => !matches(f, where));
        return { count: before - state.feeds.length };
      }),
    },
    recoveryCode: {
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = state.codes.length;
        state.codes = state.codes.filter((c) => !matches(c, where));
        return { count: before - state.codes.length };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const snapshot = structuredClone({ users: state.users, links: state.links, sessions: state.sessions, feeds: state.feeds, codes: state.codes });
      try {
        return await fn(client);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    }),
  };
  return { state, client };
});

vi.mock('@/lib/db', () => ({ prisma: db.client }));

import {
  INVITE_LINK_TTL_MS,
  RESET_LINK_TTL_MS,
  describePasswordLink,
  issuePasswordLink,
  passwordLinkPurposeFor,
  redeemPasswordLink,
  revokePasswordLink,
} from '@/lib/password-links';
import type { Prisma } from '@prisma/client';

const tx = db.client as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-11-07T12:00:00Z');
const BEFORE = new Date('2026-11-07T11:00:00Z');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function addUser(id: string, status: string, passwordHash: string | null = 'old-hash') {
  db.state.users.push({ id, username: id, displayName: id, role: 'member', status, passwordHash, totpEnabledAt: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.state.users = [];
  db.state.links = [];
  db.state.sessions = [];
  db.state.feeds = [];
  db.state.codes = [];
});

describe('issuing a link', () => {
  it('stores only the SHA-256 of a high-entropy token', async () => {
    addUser('u1', 'pending', null);
    const link = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });

    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.state.links).toHaveLength(1);
    expect(db.state.links[0].tokenHash).toBe(sha256(link.token));
    expect(JSON.stringify(db.state.links)).not.toContain(link.token);
  });

  it('expires invites after 7 days and resets after 24 hours', async () => {
    addUser('u1', 'pending', null);
    addUser('u2', 'active');
    const invite = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });
    const reset = await issuePasswordLink(tx, { userId: 'u2', purpose: 'reset', createdById: 'admin', now: NOW });
    expect(invite.expiresAt.getTime() - NOW.getTime()).toBe(INVITE_LINK_TTL_MS);
    expect(INVITE_LINK_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(reset.expiresAt.getTime() - NOW.getTime()).toBe(RESET_LINK_TTL_MS);
    expect(RESET_LINK_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('ends the old link when a new one is made', async () => {
    addUser('u1', 'pending', null);
    const first = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });
    const second = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });
    expect(db.state.links).toHaveLength(1);
    expect(await redeemPasswordLink(first.token, 'new-hash', NOW)).toBeNull();
    expect(await redeemPasswordLink(second.token, 'new-hash', NOW)).not.toBeNull();
  });

  it('gives pending users an invite, active local users a reset, and nobody else a link', () => {
    expect(passwordLinkPurposeFor({ status: 'pending', passwordHash: null })).toBe('invite');
    expect(passwordLinkPurposeFor({ status: 'active', passwordHash: 'h' })).toBe('reset');
    expect(passwordLinkPurposeFor({ status: 'active', passwordHash: null })).toBeNull();
    expect(passwordLinkPurposeFor({ status: 'disabled', passwordHash: 'h' })).toBeNull();
  });
});

describe('using a link', () => {
  it('activates an invited user with the chosen password, once', async () => {
    addUser('u1', 'pending', null);
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });

    await expect(describePasswordLink(token, NOW)).resolves.toEqual({ purpose: 'invite', username: 'u1', displayName: 'u1' });
    const used = await redeemPasswordLink(token, 'chosen-hash', NOW);
    expect(used).toMatchObject({ id: 'u1', purpose: 'invite' });
    expect(db.state.users[0]).toMatchObject({ status: 'active', passwordHash: 'chosen-hash' });
    expect(db.state.links).toHaveLength(0);

    expect(await redeemPasswordLink(token, 'other-hash', NOW)).toBeNull();
    await expect(describePasswordLink(token, NOW)).resolves.toBeNull();
    expect(db.state.users[0].passwordHash).toBe('chosen-hash');
  });

  it('a reset link sets the password and revokes every session of the user', async () => {
    addUser('u1', 'active');
    db.state.sessions.push(
      { id: 's1', userId: 'u1', revokedAt: null },
      { id: 's2', userId: 'u1', revokedAt: null },
      { id: 's3', userId: 'someone-else', revokedAt: null },
    );
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'reset', createdById: 'admin', now: NOW });

    db.state.feeds.push({ id: 'f1', userId: 'u1' }, { id: 'f2', userId: 'someone-else' });

    const used = await redeemPasswordLink(token, 'new-hash', NOW);
    expect(used).toMatchObject({ purpose: 'reset', revokedSessions: 2, feedRevoked: true, mfaEnabled: false, mfaDisabled: false });
    expect(db.state.users[0].passwordHash).toBe('new-hash');
    expect(db.state.sessions.filter((s) => s.revokedAt !== null).map((s) => s.id)).toEqual(['s1', 's2']);
    // The calendar feed link ends with the sessions.
    expect(db.state.feeds.map((f) => f.id)).toEqual(['f2']);
  });

  function withTwoStep(userId: string) {
    Object.assign(db.state.users.find((u) => u.id === userId)!, { totpSecret: 'enc:v1:x', totpEnabledAt: BEFORE, totpLastUsedStep: 9 });
    db.state.codes.push({ id: `c-${userId}-1`, userId }, { id: `c-${userId}-2`, userId });
  }

  it("a reset link an admin made turns two-step sign-in off with the new password", async () => {
    addUser('u1', 'active');
    addUser('u2', 'active');
    withTwoStep('u1');
    withTwoStep('u2');
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'reset', createdById: 'admin', now: NOW });

    expect(await redeemPasswordLink(token, 'new-hash', NOW)).toMatchObject({ mfaEnabled: false, mfaDisabled: true });
    expect(db.state.users[0]).toMatchObject({ passwordHash: 'new-hash', totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null });
    expect(db.state.codes.map((c) => c.userId)).toEqual(['u2', 'u2']);
    expect(db.state.users[1].totpEnabledAt).toBe(BEFORE);
  });

  it('a reset link the user made for themselves leaves two-step sign-in on', async () => {
    addUser('u1', 'active');
    withTwoStep('u1');
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'reset', createdById: 'u1', now: NOW });
    expect(await redeemPasswordLink(token, 'new-hash', NOW)).toMatchObject({ mfaEnabled: true, mfaDisabled: false });
    expect(db.state.users[0]).toMatchObject({ passwordHash: 'new-hash', totpEnabledAt: BEFORE });
    expect(db.state.codes).toHaveLength(2);
  });

  it('a reset link made before two-step sign-in was turned on leaves it on', async () => {
    addUser('u1', 'active');
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'reset', createdById: 'admin', now: BEFORE });
    withTwoStep('u1');
    db.state.users[0].totpEnabledAt = NOW;
    expect(await redeemPasswordLink(token, 'new-hash', NOW)).toMatchObject({ mfaEnabled: true, mfaDisabled: false });
    expect(db.state.users[0]).toMatchObject({ passwordHash: 'new-hash', totpEnabledAt: NOW });
    expect(db.state.codes).toHaveLength(2);
  });

  it('an invite leaves two-step sign-in on and says so', async () => {
    addUser('u1', 'pending', null);
    withTwoStep('u1');
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });
    expect(await redeemPasswordLink(token, 'new-hash', NOW)).toMatchObject({ mfaEnabled: true, mfaDisabled: false });
    expect(db.state.users[0].totpEnabledAt).toBe(BEFORE);
  });

  it('counts two-step sign-in turned on after the link was read, and leaves it on', async () => {
    addUser('u1', 'active');
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'reset', createdById: 'admin', now: BEFORE });
    const read = await db.client.passwordLink.findUnique({ where: { tokenHash: sha256(token) } });
    db.client.passwordLink.findUnique.mockImplementationOnce(async () => {
      withTwoStep('u1');
      db.state.users[0].totpEnabledAt = NOW;
      return read;
    });
    expect(await redeemPasswordLink(token, 'new-hash', NOW)).toMatchObject({ mfaEnabled: true, mfaDisabled: false });
    expect(db.state.users[0].totpEnabledAt).toBe(NOW);
    expect(db.state.codes).toHaveLength(2);
  });

  it('a reset that loses the race to another use leaves two-step sign-in on', async () => {
    addUser('u1', 'active');
    withTwoStep('u1');
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'reset', createdById: 'admin', now: NOW });
    // The link is consumed by the other request between the read and the delete.
    db.client.passwordLink.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await redeemPasswordLink(token, 'new-hash', NOW)).toBeNull();
    expect(db.state.users[0]).toMatchObject({ passwordHash: 'old-hash', totpEnabledAt: BEFORE });
    expect(db.state.codes).toHaveLength(2);
  });

  it('a second use of a reset link racing the first writes nothing', async () => {
    addUser('u1', 'active');
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'reset', createdById: 'admin', now: NOW });
    // The second request read the link before the first one consumed it.
    const staleRead = await db.client.passwordLink.findUnique({ where: { tokenHash: sha256(token) } });
    await redeemPasswordLink(token, 'first-hash', NOW);
    db.client.passwordLink.findUnique.mockResolvedValueOnce(staleRead);

    expect(await redeemPasswordLink(token, 'second-hash', NOW)).toBeNull();
    expect(db.state.users[0].passwordHash).toBe('first-hash');
  });

  it('refuses an expired link without writing anything', async () => {
    addUser('u1', 'pending', null);
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });
    const later = new Date(NOW.getTime() + INVITE_LINK_TTL_MS);

    await expect(describePasswordLink(token, later)).resolves.toBeNull();
    expect(await redeemPasswordLink(token, 'new-hash', later)).toBeNull();
    expect(db.state.users[0]).toMatchObject({ status: 'pending', passwordHash: null });
    expect(db.client.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a link once the user is no longer in the state it was made for', async () => {
    addUser('u1', 'pending', null);
    addUser('u2', 'active');
    const invite = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });
    const reset = await issuePasswordLink(tx, { userId: 'u2', purpose: 'reset', createdById: 'admin', now: NOW });
    db.state.users[0].status = 'disabled';
    db.state.users[1].status = 'pending';

    expect(await redeemPasswordLink(invite.token, 'h', NOW)).toBeNull();
    expect(await redeemPasswordLink(reset.token, 'h', NOW)).toBeNull();
    expect(db.state.users.map((u) => u.status)).toEqual(['disabled', 'pending']);
  });

  it('refuses a revoked link', async () => {
    addUser('u1', 'pending', null);
    const { token } = await issuePasswordLink(tx, { userId: 'u1', purpose: 'invite', createdById: 'admin', now: NOW });

    await expect(revokePasswordLink(tx, 'u1')).resolves.toBe('invite');
    await expect(revokePasswordLink(tx, 'u1')).resolves.toBeNull();
    expect(await redeemPasswordLink(token, 'h', NOW)).toBeNull();
    expect(db.state.users[0].status).toBe('pending');
  });

  it('refuses malformed and unknown tokens alike, without a lookup for the malformed', async () => {
    expect(await redeemPasswordLink('short', 'h', NOW)).toBeNull();
    expect(await redeemPasswordLink(undefined, 'h', NOW)).toBeNull();
    await expect(describePasswordLink({ token: 'x' }, NOW)).resolves.toBeNull();
    expect(db.client.passwordLink.findUnique).not.toHaveBeenCalled();

    expect(await redeemPasswordLink('A'.repeat(43), 'h', NOW)).toBeNull();
    expect(db.client.passwordLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha256('A'.repeat(43)) } }),
    );
  });
});
