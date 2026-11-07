import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  checkDir: vi.fn(),
  list: vi.fn(),
  start: vi.fn(),
  running: vi.fn(() => false),
  last: vi.fn(() => null),
}));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.admin }));
vi.mock('@/lib/db', () => ({ prisma: { appSettings: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));
vi.mock('@/lib/database-backup', () => ({
  BACKUP_SCHEDULES: new Set(['off', 'daily', 'weekly']),
  BACKUP_KEEP_MAX: 100,
  BACKUP_ALERT_DAYS_MAX: 365,
  checkBackupDir: mocks.checkDir,
  listBackups: mocks.list,
  startDatabaseBackup: mocks.start,
  isBackupRunning: mocks.running,
  lastBackupResult: mocks.last,
}));

const { GET, PUT, POST } = await import('@/app/api/admin/database-backup/route');

const ADMIN = { ok: true, user: { id: 'a', username: 'admin', role: 'admin' } };
const ROW = {
  lastDatabaseBackupAt: new Date('2026-11-04T03:00:00.000Z'),
  databaseBackupSchedule: 'daily',
  databaseBackupHour: 3,
  databaseBackupDayOfWeek: 0,
  databaseBackupKeep: 7,
  databaseBackupAlertDays: 7,
  timeZone: 'Europe/Berlin',
};

function put(body: unknown) {
  return PUT(new NextRequest('http://localhost/api/admin/database-backup', {
    method: 'PUT',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

function post() {
  return POST(new NextRequest('http://localhost/api/admin/database-backup', { method: 'POST' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue(ADMIN);
  mocks.checkDir.mockResolvedValue({ ok: true });
  mocks.list.mockResolvedValue([]);
});

describe('GET /api/admin/database-backup', () => {
  it('returns the last backup, the folder, the dumps and the schedule to an admin, uncached', async () => {
    mocks.findUnique.mockResolvedValue(ROW);
    mocks.list.mockResolvedValue([{ name: 'helprr-backup-20261104-030000.dump', sizeBytes: 10, createdAt: '2026-11-04T03:00:00.000Z' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      lastBackupAt: '2026-11-04T03:00:00.000Z',
      folder: { ok: true },
      backups: [{ name: 'helprr-backup-20261104-030000.dump', sizeBytes: 10, createdAt: '2026-11-04T03:00:00.000Z' }],
      running: false,
      lastRun: null,
      timeZone: 'Europe/Berlin',
      schedule: 'daily',
      hour: 3,
      dayOfWeek: 0,
      keep: 7,
      alertDays: 7,
    });
  });

  it('says why the folder cannot be used, and lists nothing', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.checkDir.mockResolvedValue({ ok: false, reason: 'not-mounted' });
    const body = await (await GET()).json();
    expect(body).toMatchObject({ lastBackupAt: null, folder: { ok: false, reason: 'not-mounted' }, backups: [], schedule: 'off' });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/database-backup', () => {
  // A Sunday, 13:00 in Berlin: past the default 03:00 backup hour.
  const NOW = new Date('2026-11-08T12:00:00.000Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.upsert.mockResolvedValue(ROW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('turned on after today\'s hour, waits for the next one instead of backing up at once', async () => {
    mocks.findUnique.mockResolvedValue({ ...ROW, databaseBackupSchedule: 'off', databaseBackupScheduledAt: null });
    expect((await put({ schedule: 'daily' })).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { databaseBackupSchedule: 'daily', databaseBackupScheduledAt: NOW },
    }));
  });

  it('turned on before today\'s hour, backs up at that hour today', async () => {
    mocks.findUnique.mockResolvedValue({ ...ROW, databaseBackupSchedule: 'off', databaseBackupScheduledAt: null });
    await put({ schedule: 'daily', hour: 20 });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { databaseBackupSchedule: 'daily', databaseBackupHour: 20 },
    }));
  });

  it('leaves a catch-up that was already due (the server was down at the hour)', async () => {
    mocks.findUnique.mockResolvedValue({ ...ROW, databaseBackupScheduledAt: new Date('2026-11-07T02:00:00.000Z') });
    await put({ hour: 4 });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { databaseBackupHour: 4 } }));
  });

  it('saves only the fields sent', async () => {
    mocks.upsert.mockResolvedValue({ ...ROW, databaseBackupSchedule: 'weekly', databaseBackupDayOfWeek: 5 });
    const res = await put({ schedule: 'weekly', dayOfWeek: 5 });
    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { databaseBackupSchedule: 'weekly', databaseBackupDayOfWeek: 5 },
    }));
    expect(await res.json()).toMatchObject({ schedule: 'weekly', dayOfWeek: 5 });
  });

  it.each([
    [{ schedule: 'hourly' }],
    [{ schedule: 1 }],
    [{ hour: 24 }],
    [{ hour: 2.5 }],
    [{ dayOfWeek: -1 }],
    [{ keep: 0 }],
    [{ keep: 101 }],
    [{ keep: '7' }],
    [{ alertDays: 366 }],
    [{}],
    [[]],
    ['not json'],
  ])('refuses %j', async (body) => {
    expect((await put(body)).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/database-backup', () => {
  it('starts a backup as the admin and returns at once', async () => {
    mocks.start.mockReturnValue(new Promise(() => {}));
    const res = await post();
    expect(res.status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'manual',
      actor: { id: 'a', username: 'admin' },
    }));
  });

  it('says so when one is already running', async () => {
    mocks.start.mockReturnValue(null);
    expect((await post()).status).toBe(409);
  });
});

describe('authorization', () => {
  it('refuses anyone else before reading, saving or starting anything', async () => {
    for (const status of [401, 403]) {
      mocks.admin.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
      expect((await GET()).status).toBe(status);
      expect((await put({ schedule: 'daily' })).status).toBe(status);
      expect((await post()).status).toBe(status);
    }
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.checkDir).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
