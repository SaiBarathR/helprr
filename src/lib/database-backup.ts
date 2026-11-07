// In-app database backups: pg_dump of Helprr's own database into BACKUP_DIR (a
// mounted folder on the server, never served over HTTP), validated with
// pg_restore --list, kept 0600, pruned to the newest N. One run at a time per
// process: a manual run and a scheduled one never overlap.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordSecurityEvent, type SecurityAuditInput } from '@/lib/security-audit';

export const BACKUP_FILE_PATTERN = /^helprr-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;
const PARTIAL_PATTERN = /^\.helprr-backup-.*\.partial$/;
/** A partial file this old is left from a run that was killed (a live run writes its own, newer one). */
const STALE_PARTIAL_MS = 6 * 60 * 60 * 1000;
const DUMP_TIMEOUT_MS = 60 * 60 * 1000;
const VALIDATE_TIMEOUT_MS = 15 * 60 * 1000;
/** After SIGTERM, how long a client has before SIGKILL; the run ends then even if it never exits. */
const KILL_GRACE_MS = 30 * 1000;
const STDERR_MAX = 4096;
const MESSAGE_MAX = 300;
const LIST_MAX = 100;

export const BACKUP_SCHEDULES = new Set(['off', 'daily', 'weekly']);
export const BACKUP_KEEP_MAX = 100;
export const BACKUP_ALERT_DAYS_MAX = 365;

export type BackupTrigger = 'manual' | 'scheduled';
export type BackupFolderProblem = 'missing' | 'not-mounted' | 'not-writable';
export type BackupFailureReason =
  | BackupFolderProblem
  | 'config'
  | 'no-client'
  | 'dump-failed'
  | 'timeout'
  | 'empty'
  | 'invalid'
  | 'exists'
  | 'error';

export type BackupResult =
  | { ok: true; fileName: string; sizeBytes: number; finishedAt: string; removed: number }
  | { ok: false; reason: BackupFailureReason; message: string; finishedAt: string };

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

const FOLDER_MESSAGES: Record<BackupFolderProblem, string> = {
  missing: 'The backup folder does not exist.',
  'not-mounted': 'The backup folder is not mounted, so a backup would be lost on the next update.',
  'not-writable': 'Helprr cannot write to the backup folder.',
};

/** Where in-app backups go: BACKUP_DIR, else /app/backups (the Compose files mount a volume there). */
export function getBackupDir(): string {
  return process.env.BACKUP_DIR?.trim() || '/app/backups';
}

/** Mount points from /proc/self/mountinfo (field 5, with \040-style escapes); null off Linux. */
async function readMountPoints(): Promise<Set<string> | null> {
  try {
    const text = await fs.readFile('/proc/self/mountinfo', 'utf8');
    return new Set(text.split('\n').filter(Boolean).map((line) =>
      (line.split(' ')[4] ?? '').replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))));
  } catch {
    return null;
  }
}

/**
 * Whether a backup can be written. In the Docker image the folder must be a
 * mount: without one a dump would sit in the container and be lost on the next
 * update, so it is refused rather than made.
 */
export async function checkBackupDir(dir = getBackupDir()): Promise<{ ok: true } | { ok: false; reason: BackupFolderProblem }> {
  try {
    if (!(await fs.stat(dir)).isDirectory()) return { ok: false, reason: 'missing' };
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (process.env.HELPRR_RUNTIME === 'docker') {
    const mounts = await readMountPoints();
    if (mounts && !mounts.has(path.resolve(dir))) return { ok: false, reason: 'not-mounted' };
  }
  try {
    await fs.access(dir, constants.W_OK | constants.X_OK);
  } catch {
    return { ok: false, reason: 'not-writable' };
  }
  return { ok: true };
}

export interface PgConnection {
  /** Never holds the password or the connection. */
  args: string[];
  /** libpq's variables: the connection, with the password in PGPASSWORD. */
  env: Record<string, string>;
}

/**
 * pg_dump's connection from DATABASE_URL, all in libpq's environment variables:
 * nothing about it is in argv (so not in the process list), and a database name
 * is never read as a connection string.
 */
export function pgConnectionFromUrl(databaseUrl: string): PgConnection {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL is not a PostgreSQL URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const host = url.searchParams.get('host') || url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (!database || !host) throw new Error('DATABASE_URL has no host or database name');
  const env: Record<string, string> = { PGHOST: host, PGPORT: url.port || '5432', PGDATABASE: database, PGCONNECT_TIMEOUT: '10' };
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  // Never prompt: a missing password fails instead of hanging.
  return { args: ['--no-password'], env };
}

interface ChildResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
  spawnError?: NodeJS.ErrnoException;
}

/** Run a PostgreSQL client with only PATH and the given variables in its environment. */
function runClient(command: string, args: string[], env: Record<string, string>, stdout: number | 'ignore', timeoutMs: number): Promise<ChildResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', ...env } as unknown as NodeJS.ProcessEnv,
      stdio: ['ignore', stdout, 'pipe'],
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A client stuck on a hung mount may ignore both signals: the run still ends,
      // so the lock is released and the failure is reported.
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ code: null, stderr, timedOut });
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_MAX) stderr += chunk.toString('utf8').slice(0, STDERR_MAX - stderr.length);
    });
    const finish = (result: ChildResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    child.on('error', (error: NodeJS.ErrnoException) => finish({ code: null, stderr, timedOut, spawnError: error }));
    child.on('close', (code) => finish({ code, stderr, timedOut }));
  });
}

/** The first lines of a client's error, without the password or the URL. */
export function sanitizeClientMessage(stderr: string, secrets: Array<string | undefined>): string {
  let text = stderr.trim();
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[redacted]');
  }
  text = text.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
  text = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' ');
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text;
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function createdAtFromName(name: string): string | null {
  const m = BACKUP_FILE_PATTERN.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

/** The in-app backups in the folder, newest first. */
export async function listBackups(dir = getBackupDir()): Promise<BackupFile[]> {
  const names = (await fs.readdir(dir)).filter((name) => BACKUP_FILE_PATTERN.test(name)).sort().reverse().slice(0, LIST_MAX);
  const files: BackupFile[] = [];
  for (const name of names) {
    try {
      const stat = await fs.lstat(path.join(dir, name));
      if (stat.isFile()) files.push({ name, sizeBytes: stat.size, createdAt: createdAtFromName(name)! });
    } catch {
      // Removed since the listing.
    }
  }
  return files;
}

/**
 * Keep the newest `keep` in-app dumps and remove the rest, plus partial files
 * left by a run that was killed. Only Helprr's own names are touched; other
 * files in the folder (such as a copy of a backup.sh dump) are left alone.
 */
export async function pruneBackups(dir: string, keep: number, nowMs = Date.now()): Promise<number> {
  const names = await fs.readdir(dir);
  const dumps = names.filter((name) => BACKUP_FILE_PATTERN.test(name)).sort().reverse();
  let removed = 0;
  for (const name of dumps.slice(Math.max(1, keep))) {
    try {
      await fs.unlink(path.join(dir, name));
      removed += 1;
    } catch (error) {
      logger.warn('Could not remove an old database backup', { file: name, error: (error as Error).message }, { scope: 'backup' });
    }
  }
  for (const name of names.filter((n) => PARTIAL_PATTERN.test(n))) {
    try {
      const stat = await fs.lstat(path.join(dir, name));
      if (nowMs - stat.mtimeMs > STALE_PARTIAL_MS) await fs.unlink(path.join(dir, name));
    } catch {
      // Gone already.
    }
  }
  return removed;
}

class BackupFailure extends Error {
  constructor(readonly reason: BackupFailureReason, message: string) {
    super(message);
  }
}

function clientFailure(result: ChildResult, step: 'dump' | 'validate', secrets: Array<string | undefined>): BackupFailure {
  if (result.spawnError?.code === 'ENOENT') {
    return new BackupFailure('no-client', 'The PostgreSQL client (pg_dump) is not installed in this Helprr image.');
  }
  if (result.timedOut) return new BackupFailure('timeout', step === 'dump' ? 'pg_dump took too long and was stopped.' : 'Checking the backup took too long.');
  const detail = sanitizeClientMessage(result.stderr, secrets) || `exit code ${result.code ?? 'unknown'}`;
  return step === 'dump'
    ? new BackupFailure('dump-failed', `pg_dump failed: ${detail}`)
    : new BackupFailure('invalid', `The backup did not pass validation: ${detail}`);
}

async function createBackup(dir: string, now: Date): Promise<{ fileName: string; sizeBytes: number }> {
  const folder = await checkBackupDir(dir);
  if (!folder.ok) throw new BackupFailure(folder.reason, FOLDER_MESSAGES[folder.reason]);

  let connection: PgConnection;
  try {
    connection = pgConnectionFromUrl(process.env.DATABASE_URL ?? '');
  } catch {
    throw new BackupFailure('config', 'DATABASE_URL could not be read as a PostgreSQL connection.');
  }
  const secrets = [connection.env.PGPASSWORD, process.env.DATABASE_URL];

  const fileName = `helprr-backup-${timestamp(now)}.dump`;
  const finalPath = path.join(dir, fileName);
  const partialPath = path.join(dir, `.helprr-backup-${timestamp(now)}-${randomBytes(4).toString('hex')}.partial`);
  // Created here, exclusive and 0600 whatever the umask, and handed to pg_dump as stdout.
  const handle = await fs.open(partialPath, 'wx', 0o600);
  try {
    // Custom format is compressed by default and is what pg_restore reads.
    const dump = await runClient(
      'pg_dump',
      [...connection.args, '--format=custom', '--no-owner', '--no-privileges', '--lock-wait-timeout=10s'],
      connection.env,
      handle.fd,
      DUMP_TIMEOUT_MS,
    );
    await handle.close();
    if (dump.code !== 0) throw clientFailure(dump, 'dump', secrets);

    const { size } = await fs.stat(partialPath);
    if (size === 0) throw new BackupFailure('empty', 'pg_dump wrote an empty backup.');

    // Catches a truncated or malformed archive; it is not a restore test.
    const check = await runClient('pg_restore', ['--list', partialPath], {}, 'ignore', VALIDATE_TIMEOUT_MS);
    if (check.code !== 0) throw clientFailure(check, 'validate', secrets);

    try {
      // A hard link never replaces an existing file.
      await fs.link(partialPath, finalPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new BackupFailure('exists', `Could not save ${fileName}: a file with that name already exists.`);
      // A share or drive without hard links: rename, once the name is checked free
      // (runs are one at a time, so nothing else takes it in between).
      if (await fs.lstat(finalPath).then(() => true, () => false)) {
        throw new BackupFailure('exists', `Could not save ${fileName}: a file with that name already exists.`);
      }
      try {
        await fs.rename(partialPath, finalPath);
      } catch (renameError) {
        throw new BackupFailure('error', `Could not save ${fileName} in the backup folder (${(renameError as NodeJS.ErrnoException).code ?? 'error'}).`);
      }
    }
    return { fileName, sizeBytes: size };
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(partialPath).catch(() => {});
  }
}

export interface BackupRunOptions {
  trigger: BackupTrigger;
  /** The admin who asked, or null for the scheduler (recorded as system:backup-scheduler). */
  actor: { id: string; username: string } | null;
  /** The API request, for the audit row's network and browser. */
  request?: NextRequest | null;
}

interface BackupState {
  running: Promise<BackupResult> | null;
  last: BackupResult | null;
}

// On globalThis like the polling service: the API route and the poll loop are
// separate bundles in dev and must share one lock.
const globalForBackup = globalThis as unknown as { __helprrDatabaseBackup?: BackupState };
const state: BackupState = globalForBackup.__helprrDatabaseBackup ?? { running: null, last: null };
globalForBackup.__helprrDatabaseBackup = state;

export function isBackupRunning(): boolean {
  return state.running !== null;
}

/** The outcome of the last run in this process (the UI shows it after "Back up now"). */
export function lastBackupResult(): BackupResult | null {
  return state.last;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function runBackup(options: BackupRunOptions): Promise<BackupResult> {
  const dir = getBackupDir();
  const startedAt = new Date();
  const audit = (input: Pick<SecurityAuditInput, 'action' | 'targetLabel' | 'fields'>) =>
    recordSecurityEvent(options.request ?? null, {
      actor: options.actor ?? { id: null, username: 'system:backup-scheduler' },
      targetType: 'backup',
      ...input,
    });
  try {
    const { fileName, sizeBytes } = await createBackup(dir, startedAt);
    const finishedAt = new Date();
    let removed = 0;
    try {
      const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { databaseBackupKeep: true } });
      removed = await pruneBackups(dir, settings?.databaseBackupKeep ?? 7);
    } catch (error) {
      logger.warn('Could not prune old database backups', { error: (error as Error).message }, { scope: 'backup' });
    }
    try {
      await prisma.appSettings.updateMany({ where: { id: 'singleton' }, data: { lastDatabaseBackupAt: finishedAt } });
    } catch (error) {
      logger.warn('Database backup made, but its time could not be recorded', { file: fileName, error: (error as Error).message }, { scope: 'backup' });
    }
    await audit({ action: 'DATABASE_BACKUP_CREATED', targetLabel: fileName, fields: [options.trigger, formatSize(sizeBytes)] });
    logger.info('Database backup created', {
      file: fileName,
      sizeBytes,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      trigger: options.trigger,
      removed,
    }, { scope: 'backup' });
    return { ok: true, fileName, sizeBytes, finishedAt: finishedAt.toISOString(), removed };
  } catch (error) {
    const failure = error instanceof BackupFailure
      ? error
      : new BackupFailure('error', sanitizeClientMessage(error instanceof Error ? error.message : String(error), [process.env.DATABASE_URL]) || 'The backup failed.');
    await audit({ action: 'DATABASE_BACKUP_FAILED', targetLabel: 'Database backup', fields: [options.trigger, failure.reason] });
    logger.warn('Database backup failed', { reason: failure.reason, message: failure.message, trigger: options.trigger }, { scope: 'backup' });
    return { ok: false, reason: failure.reason, message: failure.message, finishedAt: new Date().toISOString() };
  }
}

/**
 * Start a backup unless one is running. Returns the run's promise, or null when
 * one is already running (the caller reports "busy"; nothing is audited).
 */
export function startDatabaseBackup(options: BackupRunOptions): Promise<BackupResult> | null {
  if (state.running) return null;
  const run = runBackup(options).then((result) => {
    state.last = result;
    return result;
  }).finally(() => {
    state.running = null;
  });
  state.running = run;
  return run;
}
