import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import {
  BACKUP_ALERT_DAYS_MAX,
  BACKUP_KEEP_MAX,
  BACKUP_SCHEDULES,
  checkBackupDir,
  isBackupRunning,
  lastBackupResult,
  listBackups,
  startDatabaseBackup,
} from '@/lib/database-backup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const SCHEDULE_SELECT = {
  lastDatabaseBackupAt: true,
  databaseBackupSchedule: true,
  databaseBackupHour: true,
  databaseBackupDayOfWeek: true,
  databaseBackupKeep: true,
  databaseBackupAlertDays: true,
} as const;

type ScheduleRow = Prisma.AppSettingsGetPayload<{ select: typeof SCHEDULE_SELECT }>;

function scheduleOf(row: ScheduleRow | null) {
  return {
    schedule: row?.databaseBackupSchedule ?? 'off',
    hour: row?.databaseBackupHour ?? 3,
    dayOfWeek: row?.databaseBackupDayOfWeek ?? 0,
    keep: row?.databaseBackupKeep ?? 7,
    alertDays: row?.databaseBackupAlertDays ?? 7,
  };
}

// The last database backup (from scripts/backup.sh or the app), the in-app
// backup folder and its dumps (names and sizes only: dumps are never served),
// and the schedule. Admin-only, like the backups.
async function getHandler(): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { ...SCHEDULE_SELECT, timeZone: true },
  });
  const folder = await checkBackupDir();
  let backups: Awaited<ReturnType<typeof listBackups>> = [];
  if (folder.ok) {
    try {
      backups = await listBackups();
    } catch {
      // Unreadable since the check: shown as none.
    }
  }
  return NextResponse.json(
    {
      lastBackupAt: settings?.lastDatabaseBackupAt?.toISOString() ?? null,
      folder: folder.ok ? { ok: true } : { ok: false, reason: folder.reason },
      backups,
      running: isBackupRunning(),
      lastRun: lastBackupResult(),
      // The schedule's hours are in the app's time zone, as the poller reads them.
      timeZone: settings?.timeZone ?? 'UTC',
      ...scheduleOf(settings),
    },
    { headers: NO_STORE },
  );
}

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// Change the schedule, retention or alert. Only the fields sent change.
async function putHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected an object' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const data: Record<string, string | number> = {};
  const fields: Array<[string, string, number, number]> = [
    ['hour', 'databaseBackupHour', 0, 23],
    ['dayOfWeek', 'databaseBackupDayOfWeek', 0, 6],
    ['keep', 'databaseBackupKeep', 1, BACKUP_KEEP_MAX],
    ['alertDays', 'databaseBackupAlertDays', 0, BACKUP_ALERT_DAYS_MAX],
  ];
  if (input.schedule !== undefined) {
    if (typeof input.schedule !== 'string' || !BACKUP_SCHEDULES.has(input.schedule)) {
      return NextResponse.json({ error: 'schedule must be off, daily or weekly' }, { status: 400 });
    }
    data.databaseBackupSchedule = input.schedule;
  }
  for (const [key, column, min, max] of fields) {
    if (input[key] === undefined) continue;
    const value = intIn(input[key], min, max);
    if (value === null) {
      return NextResponse.json({ error: `${key} must be a whole number from ${min} to ${max}` }, { status: 400 });
    }
    data[column] = value;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }
  const row = await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
    select: SCHEDULE_SELECT,
  });
  return NextResponse.json(scheduleOf(row), { headers: NO_STORE });
}

// Back up now: starts a backup and returns at once (a dump can take minutes);
// the page follows it through GET. 409 while one is running.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const run = startDatabaseBackup({
    trigger: 'manual',
    actor: { id: admin.user.id, username: admin.user.username },
    request,
  });
  if (!run) {
    return NextResponse.json({ error: 'A backup is already running' }, { status: 409, headers: NO_STORE });
  }
  // The run records its own outcome (audit row, log line, lastRun); never unhandled.
  void run.catch(() => {});
  return NextResponse.json({ started: true }, { status: 202, headers: NO_STORE });
}

export const GET = withApiLogging(getHandler, 'api/admin/database-backup', { logBodies: false });
export const PUT = withApiLogging(putHandler, 'api/admin/database-backup', { logBodies: false });
export const POST = withApiLogging(postHandler, 'api/admin/database-backup', { logBodies: false });
