import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// An import with a users section (admins, roles, password hashes, Jellyfin
// links), or one that gives Jellyfin another address or key, needs the
// importer's password (and code). Other imports are unchanged. A new Jellyfin
// address signs out the Jellyfin-linked accounts, audited with counts.

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  stepUp: vi.fn(),
  apply: vi.fn(),
  findFirst: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/server/confirm-password', () => ({ confirmAdminStepUp: mocks.stepUp }));
vi.mock('@/lib/settings-import/run-import', () => ({ applySettingsImport: mocks.apply }));
vi.mock('@/lib/settings-import/follow-ups', () => ({ runImportFollowUps: vi.fn(async () => []) }));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  serviceTargetLabel: () => 'Jellyfin',
}));

import { POST as importSettings } from '@/app/api/settings/import/route';

const admin = { ok: true, user: { id: 'admin-1', username: 'boss', role: 'admin' }, session: { id: 'sess-admin' } };
const users = { accounts: [{ username: 'other-admin', role: 'admin', passwordHash: '$argon2id$...' }] };
const stored = { url: 'http://jellyfin.lan:8096', apiKey: 'stored-key' };
const jellyfin = (url: string, apiKey?: string) => ({ type: 'JELLYFIN', url, ...(apiKey ? { apiKey } : {}) });

const run = (body: Record<string, unknown>) =>
  importSettings(new NextRequest('http://helprr.test/api/settings/import', { method: 'POST', body: JSON.stringify(body) }));

const refusal = () => NextResponse.json({ error: 'needs password', needsStepUp: true, needsCode: false }, { status: 403 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(admin);
  mocks.stepUp.mockResolvedValue(null);
  mocks.findFirst.mockResolvedValue(stored);
  mocks.apply.mockResolvedValue({
    applied: { appSettings: false, services: [], users: 1 },
    skipped: [],
    discoverLayoutApplied: false,
    followUps: {},
    jellyfinSignOut: null,
  });
});

describe('an import with a users section', () => {
  it('is refused, and nothing applied, when the step-up refuses', async () => {
    mocks.stepUp.mockResolvedValue(refusal());
    const res = await run({ users });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ needsStepUp: true });
    expect(mocks.stepUp).toHaveBeenCalledWith(expect.anything(), admin.user, expect.anything(), 'import-users', 'Importing user accounts');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('asks even for an empty accounts list: the section is there', async () => {
    mocks.stepUp.mockResolvedValue(refusal());
    expect((await run({ users: { accounts: [] } })).status).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('applies once confirmed, without passing the password or code on', async () => {
    const res = await run({ users, currentPassword: 'secret', code: '123456' });
    expect(res.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith({ users }, 'admin-1', 'sess-admin');
  });
});

describe('an import with a Jellyfin connection', () => {
  it.each([
    ['another address', [jellyfin('http://evil.example:8096', 'k')]],
    ['another key', [jellyfin('http://jellyfin.lan:8096/', 'new-key')]],
  ])('with %s asks for the step-up', async (_label, serviceConnections) => {
    mocks.stepUp.mockResolvedValue(refusal());
    expect((await run({ serviceConnections })).status).toBe(403);
    expect(mocks.stepUp).toHaveBeenCalledWith(expect.anything(), admin.user, expect.anything(), 'import-jellyfin', 'Importing the Jellyfin connection');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('adding Jellyfin where there is none asks too', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.stepUp.mockResolvedValue(refusal());
    expect((await run({ serviceConnections: [jellyfin('http://jellyfin.lan:8096', 'k')] })).status).toBe(403);
  });

  it('the same address and key (or none in the file) is unchanged: no step-up', async () => {
    expect((await run({ serviceConnections: [jellyfin('http://jellyfin.lan:8096', 'stored-key')] })).status).toBe(200);
    expect((await run({ serviceConnections: [jellyfin('http://jellyfin.lan:8096/')] })).status).toBe(200);
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });

  it('records the sign-out of Jellyfin-linked accounts with its counts', async () => {
    mocks.apply.mockResolvedValue({
      applied: { appSettings: false, services: ['JELLYFIN'], users: 0 },
      skipped: [],
      discoverLayoutApplied: false,
      followUps: {},
      jellyfinSignOut: { sessions: 4, accounts: 3 },
    });
    expect((await run({ serviceConnections: [jellyfin('http://new.lan:8096', 'k')] })).status).toBe(200);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'SESSION_REVOKED', targetType: 'service', count: 4, fields: ['url', 'accounts: 3'],
    }));
  });
});

describe('other imports are unchanged', () => {
  it('app settings and an arr connection need no step-up', async () => {
    const res = await run({ appSettings: { pollingIntervalSecs: 30 }, serviceConnections: [{ type: 'SONARR', url: 'http://x', apiKey: 'k' }] });
    expect(res.status).toBe(200);
    expect(mocks.stepUp).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("a member's own watchlist needs no step-up", async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: 'm1', username: 'kid', role: 'member' }, session: { id: 's' } });
    expect((await run({ watchlist: { items: [], tags: [] } })).status).toBe(200);
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });

  it('a member with users in the file is still refused as before, before any step-up', async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: 'm1', username: 'kid', role: 'member' }, session: { id: 's' } });
    expect((await run({ users })).status).toBe(403);
    expect(mocks.stepUp).not.toHaveBeenCalled();
  });
});
