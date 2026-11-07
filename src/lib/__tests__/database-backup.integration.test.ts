import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The real pg_dump and pg_restore against a disposable database, read only: the
// settings write and the audit row are mocked. Skipped without
// DATABASE_BACKUP_TEST_URL (a database whose name has "test" or "tmp" in it).
const url = process.env.DATABASE_BACKUP_TEST_URL;
const usable = Boolean(url && /test|tmp/.test(new URL(url).pathname));

vi.mock('@/lib/db', () => ({
  prisma: { appSettings: { findUnique: vi.fn(async () => ({ databaseBackupKeep: 2 })), updateMany: vi.fn(async () => ({ count: 1 })) } },
}));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const dir = mkdtempSync(path.join(tmpdir(), 'helprr-backup-integration-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!usable)('database backup with the real PostgreSQL client', () => {
  it('makes a custom-format dump that pg_restore reads in full, and keeps the newest', async () => {
    vi.stubEnv('BACKUP_DIR', dir);
    vi.stubEnv('DATABASE_URL', url!);
    vi.stubEnv('HELPRR_RUNTIME', '');
    const { startDatabaseBackup } = await import('@/lib/database-backup');

    const names: string[] = [];
    for (let run = 0; run < 3; run += 1) {
      const result = await startDatabaseBackup({ trigger: 'manual', actor: { id: 'a', username: 'admin' } });
      if (!result?.ok) throw new Error(`backup failed: ${JSON.stringify(result)}`);
      names.push(result.fileName);
      // A new name each second.
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    expect(readdirSync(dir).sort()).toEqual(names.slice(1).sort());
    const file = path.join(dir, names[2]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // Every table's data reads back.
    const listing = execFileSync('pg_restore', ['--list', file], { encoding: 'utf8' });
    expect(listing).toMatch(/TABLE DATA public AppSettings/);
    expect(listing).toMatch(/Format: CUSTOM/);
    execFileSync('pg_restore', ['--exit-on-error', '--file=/dev/null', file]);
  }, 60_000);

  it('fails cleanly with a wrong password, without printing it', async () => {
    const wrong = new URL(url!);
    wrong.password = 'definitely-not-the-password-123';
    vi.stubEnv('DATABASE_URL', wrong.toString());
    const { startDatabaseBackup } = await import('@/lib/database-backup');
    const before = readdirSync(dir).length;
    const result = await startDatabaseBackup({ trigger: 'scheduled', actor: null });
    expect(result).toMatchObject({ ok: false, reason: 'dump-failed' });
    expect(JSON.stringify(result)).not.toContain('definitely-not-the-password-123');
    expect(readdirSync(dir)).toHaveLength(before);
  }, 30_000);
});
