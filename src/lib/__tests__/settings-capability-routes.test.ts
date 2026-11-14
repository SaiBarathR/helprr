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
vi.mock('@/lib/timezone', () => ({ getEnvTimeZone: () => 'UTC', isValidTimeZone: () => true, setAppTimeZone: vi.fn() }));
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
    const res = await putSettings(request({ logLevel: 'warn', logFailedRequestBodies: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logLevel).toBe('warn');
    expect(Object.keys(body).filter((key) => /databaseBackup/i.test(key))).toEqual([]);
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

  it('lets an admin write any field', async () => {
    mocks.user = { id: 'a1', role: 'admin', template: 'admin', permissions: {} };
    expect((await putSettings(request({ pollingIntervalSecs: 60, logLevel: 'info' }))).status).toBe(200);
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
