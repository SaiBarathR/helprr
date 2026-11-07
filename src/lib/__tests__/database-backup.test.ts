import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SpawnCall = { command: string; args: string[]; env: Record<string, string>; stdout: unknown };

const mocks = vi.hoisted(() => ({
  calls: [] as SpawnCall[],
  // What each client does: write to stdout, print stderr, exit with a code.
  behave: {} as Record<string, (call: SpawnCall) => { out?: string; err?: string; code: number; hold?: Promise<void> }>,
  findUnique: vi.fn(async () => ({ databaseBackupKeep: 7 } as unknown)),
  updateMany: vi.fn(async () => ({ count: 1 })),
  audit: vi.fn(async () => {}),
}));

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: { env: Record<string, string>; stdio: unknown[] }) => {
    const call = { command, args, env: options.env, stdout: options.stdio[1] };
    mocks.calls.push(call);
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() });
    const behaviour = mocks.behave[command]?.(call) ?? { code: 0 };
    void (async () => {
      await behaviour.hold;
      if (behaviour.out && typeof call.stdout === 'number') writeSync(call.stdout, behaviour.out);
      if (behaviour.err) child.stderr.write(behaviour.err);
      child.stderr.end();
      setImmediate(() => child.emit('close', behaviour.code));
    })();
    return child;
  },
}));
vi.mock('@/lib/db', () => ({ prisma: { appSettings: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.audit }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const backup = await import('@/lib/database-backup');

const PASSWORD = 'p@ss:w/rd s3cret';
const DATABASE_URL = `postgresql://helprr%20user:${encodeURIComponent(PASSWORD)}@helprr-db:5433/helprr?schema=public`;
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.behave = {
    pg_dump: () => ({ out: 'PGDMP archive', code: 0 }),
    pg_restore: () => ({ code: 0 }),
  };
  dir = mkdtempSync(path.join(tmpdir(), 'helprr-backup-test-'));
  vi.stubEnv('BACKUP_DIR', dir);
  vi.stubEnv('DATABASE_URL', DATABASE_URL);
  vi.stubEnv('HELPRR_RUNTIME', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('pgConnectionFromUrl', () => {
  it('passes the password only through PGPASSWORD, never in the arguments', () => {
    const connection = backup.pgConnectionFromUrl(DATABASE_URL);
    expect(connection.args).toEqual([
      '--host', 'helprr-db', '--port', '5433', '--dbname', 'helprr', '--username', 'helprr user', '--no-password',
    ]);
    expect(connection.args.join(' ')).not.toContain('s3cret');
    expect(connection.env).toEqual({ PGCONNECT_TIMEOUT: '10', PGPASSWORD: PASSWORD });
  });

  it('keeps sslmode, a socket host and an IPv6 address', () => {
    expect(backup.pgConnectionFromUrl('postgres://u:p@[::1]/db?sslmode=require').env.PGSSLMODE).toBe('require');
    expect(backup.pgConnectionFromUrl('postgres://u:p@[::1]/db').args.slice(0, 4)).toEqual(['--host', '::1', '--port', '5432']);
    expect(backup.pgConnectionFromUrl('postgresql://u@localhost/db?host=/var/run/postgresql').args[1]).toBe('/var/run/postgresql');
  });

  it('refuses a URL that is not PostgreSQL or names no database', () => {
    expect(() => backup.pgConnectionFromUrl('mysql://u:p@h/db')).toThrow();
    expect(() => backup.pgConnectionFromUrl('postgresql://u:p@h/')).toThrow();
    expect(() => backup.pgConnectionFromUrl('not a url')).toThrow();
  });
});

describe('startDatabaseBackup', () => {
  it('dumps in custom format to a 0600 file, validates it, records it and audits it', async () => {
    const result = await backup.startDatabaseBackup({ trigger: 'manual', actor: { id: 'a1', username: 'admin' } });
    expect(result).toMatchObject({ ok: true, sizeBytes: 'PGDMP archive'.length });
    if (!result?.ok) throw new Error('expected a backup');
    expect(result.fileName).toMatch(backup.BACKUP_FILE_PATTERN);
    expect(readdirSync(dir)).toEqual([result.fileName]);
    expect(statSync(path.join(dir, result.fileName)).mode & 0o777).toBe(0o600);

    const [dump, check] = mocks.calls;
    expect(dump.command).toBe('pg_dump');
    expect(dump.args).toEqual(expect.arrayContaining(['--format=custom', '--no-owner', '--no-privileges', '--no-password']));
    expect(typeof dump.stdout).toBe('number');
    // Nothing secret on the command line; only PATH and libpq settings in the environment.
    for (const call of mocks.calls) {
      expect(call.args.join(' ')).not.toContain('s3cret');
      expect(call.args.join(' ')).not.toContain('postgresql://');
    }
    expect(Object.keys(dump.env).sort()).toEqual(['PATH', 'PGCONNECT_TIMEOUT', 'PGPASSWORD']);
    expect(check.command).toBe('pg_restore');
    expect(check.args[0]).toBe('--list');
    expect(check.env.PGPASSWORD).toBeUndefined();

    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: 'singleton' }, data: { lastDatabaseBackupAt: expect.any(Date) } });
    expect(mocks.audit).toHaveBeenCalledWith(null, {
      actor: { id: 'a1', username: 'admin' },
      action: 'DATABASE_BACKUP_CREATED',
      targetType: 'backup',
      targetLabel: result.fileName,
      fields: ['manual', '1 KB'],
    });
    expect(backup.lastBackupResult()).toEqual(result);
  });

  it('runs one backup at a time', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    mocks.behave.pg_dump = () => ({ out: 'PGDMP', code: 0, hold });
    const first = backup.startDatabaseBackup({ trigger: 'scheduled', actor: null });
    expect(first).not.toBeNull();
    expect(backup.isBackupRunning()).toBe(true);
    expect(backup.startDatabaseBackup({ trigger: 'manual', actor: { id: 'a1', username: 'admin' } })).toBeNull();
    release();
    expect((await first)?.ok).toBe(true);
    expect(backup.isBackupRunning()).toBe(false);
    expect(mocks.calls.filter((c) => c.command === 'pg_dump')).toHaveLength(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(null, expect.objectContaining({
      actor: { id: null, username: 'system:backup-scheduler' },
      fields: ['scheduled', expect.any(String)],
    }));
  });

  it('reports a failed dump without the password and leaves no file', async () => {
    mocks.behave.pg_dump = () => ({
      out: 'partial',
      err: `pg_dump: error: connection to "${DATABASE_URL}" failed: password "${PASSWORD}" rejected\n`,
      code: 1,
    });
    const result = await backup.startDatabaseBackup({ trigger: 'manual', actor: { id: 'a1', username: 'admin' } });
    expect(result).toMatchObject({ ok: false, reason: 'dump-failed' });
    expect(JSON.stringify(result)).not.toContain('s3cret');
    expect(JSON.stringify(result)).not.toContain(encodeURIComponent(PASSWORD));
    expect(readdirSync(dir)).toEqual([]);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(null, expect.objectContaining({
      action: 'DATABASE_BACKUP_FAILED',
      fields: ['manual', 'dump-failed'],
    }));
  });

  it('refuses an archive that does not validate', async () => {
    mocks.behave.pg_restore = () => ({ err: 'pg_restore: error: input file is too short', code: 1 });
    const result = await backup.startDatabaseBackup({ trigger: 'manual', actor: { id: 'a1', username: 'admin' } });
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('says so when the backup folder is missing, and runs nothing', async () => {
    vi.stubEnv('BACKUP_DIR', path.join(dir, 'nope'));
    const result = await backup.startDatabaseBackup({ trigger: 'manual', actor: { id: 'a1', username: 'admin' } });
    expect(result).toMatchObject({ ok: false, reason: 'missing' });
    expect(mocks.calls).toHaveLength(0);
  });

  it('in the Docker image, refuses a folder that is not a mount', async () => {
    vi.stubEnv('HELPRR_RUNTIME', 'docker');
    expect(await backup.checkBackupDir(dir)).toEqual({ ok: false, reason: 'not-mounted' });
  });
});

describe('pruneBackups', () => {
  it('keeps the newest N of its own dumps and leaves other files alone', async () => {
    const names = ['20261101', '20261102', '20261103', '20261104'].map((d) => `helprr-backup-${d}-030000.dump`);
    for (const name of [...names, 'helprr-pre-upgrade-20261101-030000.dump', 'notes.txt']) writeFileSync(path.join(dir, name), 'x');
    expect(await backup.pruneBackups(dir, 2)).toBe(2);
    expect(readdirSync(dir).sort()).toEqual([
      'helprr-backup-20261103-030000.dump',
      'helprr-backup-20261104-030000.dump',
      'helprr-pre-upgrade-20261101-030000.dump',
      'notes.txt',
    ]);
  });

  it('removes partial files only once they are old', async () => {
    const old = path.join(dir, '.helprr-backup-20261101-030000-aaaa.partial');
    const fresh = path.join(dir, '.helprr-backup-20261107-030000-bbbb.partial');
    writeFileSync(old, 'x');
    writeFileSync(fresh, 'x');
    const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(old, day, day);
    await backup.pruneBackups(dir, 7);
    expect(readdirSync(dir)).toEqual([path.basename(fresh)]);
  });
});

describe('listBackups', () => {
  it('lists its own dumps newest first, with size and time', async () => {
    writeFileSync(path.join(dir, 'helprr-backup-20261101-030000.dump'), 'abc');
    writeFileSync(path.join(dir, 'helprr-backup-20261102-030000.dump'), 'abcdef');
    writeFileSync(path.join(dir, 'other.dump'), 'x');
    expect(await backup.listBackups(dir)).toEqual([
      { name: 'helprr-backup-20261102-030000.dump', sizeBytes: 6, createdAt: '2026-11-02T03:00:00.000Z' },
      { name: 'helprr-backup-20261101-030000.dump', sizeBytes: 3, createdAt: '2026-11-01T03:00:00.000Z' },
    ]);
  });
});

describe('sanitizeClientMessage', () => {
  it('removes secrets and connection URLs and keeps it short', () => {
    const text = backup.sanitizeClientMessage(`a ${PASSWORD} b postgres://x:y@h/db c\n\nsecond\nthird\nfourth`, [PASSWORD]);
    expect(text).toBe('a [redacted] b [redacted] c second third');
  });
});
