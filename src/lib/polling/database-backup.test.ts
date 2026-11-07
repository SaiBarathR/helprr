import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CycleContext } from './shared';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  running: vi.fn(() => false),
  update: vi.fn(async () => ({})),
  admins: vi.fn(async () => [{ id: 'admin-1' }]),
  notify: vi.fn(async () => 1),
}));

vi.mock('@/lib/database-backup', () => ({ startDatabaseBackup: mocks.start, isBackupRunning: mocks.running }));
vi.mock('@/lib/db', () => ({ prisma: { appSettings: { update: mocks.update }, user: { findMany: mocks.admins } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('./shared', () => ({ notifyAndLog: mocks.notify }));

const { checkDatabaseBackup, isBackupOverdue, isScheduledBackupDue } = await import('./database-backup');

const DAY = 24 * 60 * 60 * 1000;
const base = {
  timeZone: 'UTC',
  databaseBackupSchedule: 'daily',
  databaseBackupHour: 3,
  databaseBackupDayOfWeek: 0,
  databaseBackupScheduledAt: null as Date | null,
  databaseBackupAlertDays: 7,
  databaseBackupAlertedAt: null as Date | null,
  lastDatabaseBackupAt: null as Date | null,
};

function context(settings: Partial<typeof base>, at: string): CycleContext {
  return {
    startedAtMs: Date.parse(at),
    getSettings: async () => ({ ...base, ...settings }),
  } as unknown as CycleContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.running.mockReturnValue(false);
});

describe('isScheduledBackupDue', () => {
  // 2026-11-08 is a Sunday.
  it.each([
    ['off', 'daily', '2026-11-08T05:00:00Z', null, false],
    ['before the hour', 'daily', '2026-11-08T02:59:00Z', null, false],
    ['at the hour', 'daily', '2026-11-08T03:00:00Z', null, true],
    ['later the same day (catch-up)', 'daily', '2026-11-08T22:00:00Z', null, true],
    ['already run today', 'daily', '2026-11-08T22:00:00Z', '2026-11-08T03:00:00Z', false],
    ['run yesterday', 'daily', '2026-11-08T03:00:00Z', '2026-11-07T03:00:00Z', true],
    ['weekly on its day', 'weekly', '2026-11-08T03:00:00Z', '2026-11-01T03:00:00Z', true],
    ['weekly on another day', 'weekly', '2026-11-09T03:00:00Z', null, false],
  ])('%s', (label, schedule, at, last, expected) => {
    const settings = { ...base, databaseBackupSchedule: label === 'off' ? 'off' : schedule, databaseBackupScheduledAt: last ? new Date(last) : null };
    expect(isScheduledBackupDue(settings, new Date(at), 'UTC')).toBe(expected);
  });

  it('uses the app time zone for the hour and the day', () => {
    // 03:30 in Kolkata is 22:00 UTC the day before.
    expect(isScheduledBackupDue(base, new Date('2026-11-07T22:00:00Z'), 'Asia/Kolkata')).toBe(true);
    expect(isScheduledBackupDue(base, new Date('2026-11-07T22:00:00Z'), 'UTC')).toBe(true);
    expect(isScheduledBackupDue(base, new Date('2026-11-07T21:00:00Z'), 'Asia/Kolkata')).toBe(false);
  });
});

describe('isBackupOverdue', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  it('alerts only while scheduled, once a backup is older than the alert', () => {
    const old = new Date(now - 8 * DAY);
    expect(isBackupOverdue({ ...base, lastDatabaseBackupAt: old }, now)).toBe(true);
    expect(isBackupOverdue({ ...base, lastDatabaseBackupAt: new Date(now - 6 * DAY) }, now)).toBe(false);
    // A weekly backup across a DST change, or one due in a few hours, is not overdue yet.
    expect(isBackupOverdue({ ...base, lastDatabaseBackupAt: new Date(now - 7 * DAY - 60 * 60 * 1000) }, now)).toBe(false);
    // backup.sh alone (no schedule) is never nagged, and 0 turns it off.
    expect(isBackupOverdue({ ...base, databaseBackupSchedule: 'off', lastDatabaseBackupAt: old }, now)).toBe(false);
    expect(isBackupOverdue({ ...base, databaseBackupAlertDays: 0, lastDatabaseBackupAt: old }, now)).toBe(false);
    // Never backed up: the failure push covers it.
    expect(isBackupOverdue(base, now)).toBe(false);
  });

  it('reminds at most once a day', () => {
    const old = new Date(now - 8 * DAY);
    expect(isBackupOverdue({ ...base, lastDatabaseBackupAt: old, databaseBackupAlertedAt: new Date(now - DAY / 2) }, now)).toBe(false);
    expect(isBackupOverdue({ ...base, lastDatabaseBackupAt: old, databaseBackupAlertedAt: new Date(now - DAY) }, now)).toBe(true);
  });
});

describe('checkDatabaseBackup', () => {
  it('claims the window, starts a scheduled backup without waiting, and pushes admins if it fails', async () => {
    let finish!: (value: unknown) => void;
    mocks.start.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await checkDatabaseBackup(context({}, '2026-11-08T03:00:00Z'));
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { databaseBackupScheduledAt: new Date('2026-11-08T03:00:00Z') } });
    expect(mocks.start).toHaveBeenCalledWith({ trigger: 'scheduled', actor: null });
    expect(mocks.notify).not.toHaveBeenCalled();

    finish({ ok: false, reason: 'dump-failed', message: 'pg_dump failed: no route to host', finishedAt: '' });
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'databaseBackup',
      title: 'Scheduled database backup failed',
      body: 'pg_dump failed: no route to host',
      userIds: ['admin-1'],
      url: '/settings/backup',
    }), expect.anything());
  });

  it('does not push when the scheduled backup succeeds', async () => {
    mocks.start.mockResolvedValue({ ok: true, fileName: 'f', sizeBytes: 1, finishedAt: '', removed: 0 });
    await checkDatabaseBackup(context({}, '2026-11-08T03:00:00Z'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('pushes admins once about an old backup, then waits a day', async () => {
    const at = '2026-11-08T12:00:00Z';
    const settings = { databaseBackupScheduledAt: new Date(at), lastDatabaseBackupAt: new Date(Date.parse(at) - 9 * DAY) };
    await checkDatabaseBackup(context(settings, at));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Database backup overdue',
      body: 'The last database backup was 9 days ago. Check Settings → Backup & Restore.',
      userIds: ['admin-1'],
    }), expect.anything());
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { databaseBackupAlertedAt: new Date(at) } });
  });

  it('does not report an old backup while one is running', async () => {
    mocks.running.mockReturnValue(true);
    const at = '2026-11-08T12:00:00Z';
    await checkDatabaseBackup(context({ databaseBackupScheduledAt: new Date(at), lastDatabaseBackupAt: new Date(Date.parse(at) - 9 * DAY) }, at));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
