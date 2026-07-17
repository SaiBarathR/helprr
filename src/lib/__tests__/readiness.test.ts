import { describe, expect, it, vi } from 'vitest';
import {
  assessReadiness,
  isMigrationHistoryCurrent,
  readExpectedMigrationNames,
  type ReadinessDependencies,
} from '@/lib/readiness';

function successfulDependencies(): ReadinessDependencies {
  return {
    database: vi.fn().mockResolvedValue(undefined),
    redis: vi.fn().mockResolvedValue(undefined),
    migrations: vi.fn().mockResolvedValue(undefined),
  };
}

function migration(
  migrationName: string,
  state: 'applied' | 'failed' | 'rolled_back' = 'applied',
) {
  return {
    migration_name: migrationName,
    finished_at: state === 'applied' ? new Date('2026-07-14T00:00:00Z') : null,
    rolled_back_at: state === 'rolled_back' ? new Date('2026-07-14T00:01:00Z') : null,
  };
}

describe('readiness assessment', () => {
  it('reports ready only when every dependency check succeeds', async () => {
    await expect(assessReadiness(successfulDependencies(), 50)).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', migrations: 'ok' },
    });
  });

  it('reports each failed component without exposing the underlying error', async () => {
    const secretError = 'postgresql://user:private-password@db.internal/helprr';
    const dependencies = successfulDependencies();
    dependencies.database = vi.fn().mockRejectedValue(new Error(secretError));
    dependencies.migrations = vi.fn().mockRejectedValue(new Error('private-migration-name'));

    const report = await assessReadiness(dependencies, 50);

    expect(report).toEqual({
      status: 'not_ready',
      checks: { database: 'error', redis: 'ok', migrations: 'error' },
    });
    expect(JSON.stringify(report)).not.toContain(secretError);
    expect(JSON.stringify(report)).not.toContain('private-migration-name');
  });

  it('bounds a dependency that does not settle', async () => {
    const dependencies = successfulDependencies();
    dependencies.redis = vi.fn(() => new Promise<void>(() => {}));

    const startedAt = Date.now();
    const report = await assessReadiness(dependencies, 10);

    expect(report.checks.redis).toBe('error');
    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});

describe('migration readiness', () => {
  it('accepts an exact applied migration history regardless of row order', () => {
    expect(
      isMigrationHistoryCurrent(
        ['0001_init', '0002_next'],
        [migration('0002_next'), migration('0001_init')],
      ),
    ).toBe(true);
  });

  it.each([
    ['pending migration', [migration('0001_init')]],
    ['failed migration', [migration('0001_init'), migration('0002_next', 'failed')]],
    ['unknown applied migration', [migration('0001_init'), migration('0002_next'), migration('0003_unknown')]],
  ])('rejects a %s', (_label, records) => {
    expect(isMigrationHistoryCurrent(['0001_init', '0002_next'], records)).toBe(false);
  });

  it('reads only the migration directories shipped with the application', async () => {
    const names = await readExpectedMigrationNames();
    expect(names).toContain('0001_init');
    expect(names).toContain('20260714140000_unified_operation_audit');
    expect(names).toContain('20260714170000_retention_session_index');
    expect(names).toContain('20260716100157_recommendation_events_taste_profile');
    expect(names).not.toContain('migration_lock.toml');
    expect(names).toHaveLength(8);
  });
});
