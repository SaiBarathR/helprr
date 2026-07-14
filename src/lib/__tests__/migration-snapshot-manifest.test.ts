import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface ReleaseSnapshot {
  release: string;
  migrations: Array<{ name: string; sha256: string }>;
}

describe('released migration snapshot manifests', () => {
  it('pins the exact migrations shipped in Helprr 1.0.0', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), 'prisma/release-snapshots/v1.0.0.json'), 'utf8'),
    ) as ReleaseSnapshot;

    expect(manifest.release).toBe('1.0.0');
    expect(manifest.migrations.map((migration) => migration.name)).toEqual([
      '0001_init',
      '20260706224508_polling_state_queue_baseline_nullable',
      '20260707010000_notification_history_dedupe_unique',
      '20260708155457_add_custom_headers',
    ]);

    for (const migration of manifest.migrations) {
      const sql = readFileSync(
        path.join(process.cwd(), 'prisma/migrations', migration.name, 'migration.sql'),
      );
      expect(createHash('sha256').update(sql).digest('hex'), migration.name).toBe(migration.sha256);
    }
  });
});
