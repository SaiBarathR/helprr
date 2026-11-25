import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// A member given one settings page by an admin may save exactly that page's
// fields; a neighbouring page's grant does not reach them.

type TestUser = { id: string; role: 'admin' | 'member'; template: string; permissions: Record<string, boolean> };

const mocks = vi.hoisted(() => ({
  user: null as unknown as TestUser,
  findUnique: vi.fn(),
  upsert: vi.fn(),
  purge: vi.fn(),
  audit: vi.fn(),
}));

const forbidden = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => null),
  requireUser: vi.fn(async () => ({ ok: true, user: mocks.user })),
  // The real any-of check, over the test's user.
  requireUserAnyCapability: vi.fn(async (caps: Capability[]) =>
    caps.some((cap) => can(mocks.user as never, cap)) ? { ok: true, user: mocks.user } : forbidden()),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    appSettings: { findUnique: mocks.findUnique, upsert: mocks.upsert },
  },
}));
vi.mock('@/lib/polling-service', () => ({ pollingService: { restart: vi.fn() } }));
vi.mock('@/lib/cache/admin', () => ({ disableCachingAndPurgeCaches: mocks.purge }));
vi.mock('@/lib/cache/state', () => ({ setCachedAnilistTtlSettings: vi.fn(), setCachedCacheImagesEnabled: vi.fn() }));
vi.mock('@/lib/logger', () => ({ configureLogger: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ configureApiLogging: vi.fn(), withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/timezone', () => ({ getEnvTimeZone: () => 'UTC', isValidTimeZone: () => true, setAppTimeZone: vi.fn(), toZonedDate: (date: Date) => date }));
vi.mock('@/lib/security-audit', () => ({ recordSettingsUpdated: mocks.audit }));
vi.mock('@/lib/app-settings', () => ({
  getOrCreateAppSettings: vi.fn(async () => ({ qbtBandwidthSchedule: { rules: [] }, timeZone: 'UTC' })),
}));

const { PUT } = await import('@/app/api/settings/route');
const bandwidth = await import('@/app/api/qbittorrent/bandwidth-schedule/route');

const putSettings = PUT as unknown as (request: NextRequest) => Promise<Response>;
const getSchedule = bandwidth.GET as unknown as () => Promise<Response>;
const putSchedule = bandwidth.PUT as unknown as (request: NextRequest) => Promise<Response>;

function member(...caps: Capability[]): TestUser {
  return { id: 'm1', role: 'member', template: 'member', permissions: Object.fromEntries(caps.map((cap) => [cap, true])) };
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/settings', { method: 'PUT', body: JSON.stringify(body) });
}

const STORED = {
  id: 'singleton',
  logLevel: 'debug',
  cacheImagesEnabled: true,
  timeZone: 'UTC',
  logEnabled: true,
  logMaxFileMb: 50,
  logRetentionDays: 30,
  logFailedRequestBodies: false,
  logFailedResponseBodies: false,
  lastDatabaseBackupAt: new Date('2026-11-04T03:00:00.000Z'),
  databaseBackupSchedule: 'daily',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(STORED);
  mocks.upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({ ...STORED, ...update }));
  mocks.purge.mockResolvedValue({ deletedTotalBytes: 0 });
});

describe('PUT /api/settings for a member', () => {
  it('saves the Logging page with settings.logging, without the admin-only backup fields', async () => {
    mocks.user = member('settings.logging');
    const res = await putSettings(request({ logLevel: 'warn' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logLevel).toBe('warn');
    expect(Object.keys(body).filter((key) => /databaseBackup/i.test(key))).toEqual([]);
    // Audited: who, and the key it wrote (never the value).
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), mocks.user, 'Server settings', ['logLevel']);
  });

  it('keeps the failed request/response body switches admin-only, even with settings.logging', async () => {
    mocks.user = member('settings.logging', 'settings.storage');
    for (const body of [
      { logFailedRequestBodies: true },
      { logFailedResponseBodies: true },
      { logLevel: 'warn', logFailedRequestBodies: true },
    ]) {
      expect((await putSettings(request(body))).status).toBe(403);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    // The rest of the Logging page still saves for that member.
    for (const body of [{ logEnabled: false }, { logMaxFileMb: 20 }, { logRetentionDays: 7 }, { logClientConsoleEnabled: false }]) {
      expect((await putSettings(request(body))).status).toBe(200);
    }
    mocks.user = { id: 'a1', role: 'admin', template: 'admin', permissions: {} };
    expect((await putSettings(request({ logFailedRequestBodies: true, logFailedResponseBodies: true }))).status).toBe(200);
    expect(mocks.audit).toHaveBeenLastCalledWith(
      expect.anything(), mocks.user, 'Server settings', ['logFailedRequestBodies', 'logFailedResponseBodies'],
    );
  });

  it('saves the Storage page switch with settings.storage', async () => {
    mocks.user = member('settings.storage');
    const res = await putSettings(request({ cacheImagesEnabled: false }));
    expect(res.status).toBe(200);
    expect(mocks.purge).toHaveBeenCalledOnce();
  });

  it('refuses without the capability, and for the neighbouring one', async () => {
    for (const [user, body] of [
      [member(), { logLevel: 'warn' }],
      [member('settings.storage'), { logLevel: 'warn' }],
      [member('settings.logging'), { cacheImagesEnabled: false }],
      [member('settings.preferences'), { watchProviderRegion: 'IN' }],
    ] as const) {
      mocks.user = user;
      expect((await putSettings(request(body))).status).toBe(403);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('fails closed on an admin-only, unknown or missing field', async () => {
    mocks.user = member('settings.logging', 'settings.storage');
    for (const body of [
      { logLevel: 'warn', pollingIntervalSecs: 60 },
      { logLevel: 'warn', somethingNew: true },
      {},
      [],
      null,
    ]) {
      expect((await putSettings(request(body))).status).toBe(403);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('takes the logging switches only as real booleans', async () => {
    mocks.user = { id: 'a1', role: 'admin', template: 'admin', permissions: {} };
    for (const field of ['logEnabled', 'logClientConsoleEnabled', 'logFailedRequestBodies', 'logFailedResponseBodies']) {
      expect((await putSettings(request({ [field]: 'false' }))).status).toBe(400);
      expect((await putSettings(request({ [field]: 1 }))).status).toBe(400);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect((await putSettings(request({ logFailedResponseBodies: false }))).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { logFailedResponseBodies: false } }));
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('lets an admin write any field, and audits each key written', async () => {
    mocks.user = { id: 'a1', role: 'admin', template: 'admin', permissions: {} };
    expect((await putSettings(request({ pollingIntervalSecs: 60, logLevel: 'info' }))).status).toBe(200);
    const [, actor, label, keys] = mocks.audit.mock.calls[0];
    expect([actor, label, [...keys].sort()]).toEqual([mocks.user, 'Server settings', ['logLevel', 'pollingIntervalSecs']]);
  });

  it('audits nothing for a save refused for a bad value', async () => {
    mocks.user = { id: 'a1', role: 'admin', template: 'admin', permissions: {} };
    expect((await putSettings(request({ logLevel: 'loud' }))).status).toBe(400);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('the bandwidth schedule for Settings → Downloads', () => {
  const schedule = () => new NextRequest('http://localhost/api/qbittorrent/bandwidth-schedule', {
    method: 'PUT',
    body: JSON.stringify({ rules: [] }),
  });

  it('reads and saves with settings.downloads alone', async () => {
    mocks.user = member('settings.downloads');
    expect((await getSchedule()).status).toBe(200);
    expect((await putSchedule(schedule())).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), mocks.user, 'Bandwidth schedule', ['qbtBandwidthSchedule']);
  });

  const rule = {
    id: 'r1', name: 'Night', enabled: true, daysOfWeek: [0, 6], startHour: 22, startMinute: 0,
    endHour: 6, endMinute: 0, downloadLimitKbps: 300, uploadLimitKbps: 100,
  };
  const save = (rules: unknown[]) => putSchedule(new NextRequest('http://localhost/api/qbittorrent/bandwidth-schedule', {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  }));

  it('keeps which limits each rule sets, and a rule without the choice on the global limits', async () => {
    mocks.user = member('settings.downloads');
    const res = await save([{ ...rule, target: 'active' }, { ...rule, id: 'r2' }]);
    expect(res.status).toBe(200);
    expect((await res.json()).schedule.rules.map((r: { target: string }) => r.target)).toEqual(['active', 'global']);
    expect(mocks.upsert.mock.calls[0][0].update.qbtBandwidthSchedule.rules.map((r: { target: string }) => r.target))
      .toEqual(['active', 'global']);
  });

  it.each(['alternative', '', null, 1])('refuses a rule that sets %j', async (target) => {
    mocks.user = member('settings.downloads');
    expect((await save([{ ...rule, target }])).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('refuses without it, and for a neighbouring settings page', async () => {
    for (const user of [member(), member('settings.storage')]) {
      mocks.user = user;
      expect((await getSchedule()).status).toBe(403);
      expect((await putSchedule(schedule())).status).toBe(403);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
