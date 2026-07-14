import { readdir } from 'fs/promises';
import path from 'path';

export type ReadinessCheckName = 'database' | 'redis' | 'migrations';
export type ReadinessCheckStatus = 'ok' | 'error';

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: Record<ReadinessCheckName, ReadinessCheckStatus>;
}

interface MigrationRecord {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export interface ReadinessDependencies {
  database: () => Promise<void>;
  redis: () => Promise<void>;
  migrations: () => Promise<void>;
}

const DEFAULT_CHECK_TIMEOUT_MS = 3_000;

export function isMigrationHistoryCurrent(
  expectedNames: readonly string[],
  records: readonly MigrationRecord[],
): boolean {
  if (expectedNames.length === 0 || new Set(expectedNames).size !== expectedNames.length) {
    return false;
  }

  const hasFailedMigration = records.some(
    (record) => record.finished_at === null && record.rolled_back_at === null,
  );
  if (hasFailedMigration) return false;

  const appliedNames = new Set(
    records
      .filter((record) => record.finished_at !== null && record.rolled_back_at === null)
      .map((record) => record.migration_name),
  );
  const expected = new Set(expectedNames);

  return (
    appliedNames.size === expected.size &&
    [...expected].every((migrationName) => appliedNames.has(migrationName))
  );
}

export async function readExpectedMigrationNames(
  migrationsDirectory = path.join(process.cwd(), 'prisma', 'migrations'),
): Promise<string[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function checkDatabase(): Promise<void> {
  // Keep the Prisma client behind the request boundary so importing the route
  // during `next build` does not initialize a database connection.
  const { prisma } = await import('@/lib/db');
  await prisma.$queryRaw`SELECT 1`;
}

async function checkRedis(): Promise<void> {
  const { getRedisClient } = await import('@/lib/redis');
  const redis = await getRedisClient();
  const response = await redis.ping();
  if (response !== 'PONG') throw new Error('Redis readiness check failed');
}

async function checkMigrations(): Promise<void> {
  const [{ prisma }, expectedNames] = await Promise.all([
    import('@/lib/db'),
    readExpectedMigrationNames(),
  ]);
  const records = await prisma.$queryRaw<MigrationRecord[]>`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
  `;
  if (!isMigrationHistoryCurrent(expectedNames, records)) {
    throw new Error('Database migration history is not current');
  }
}

const defaultDependencies: ReadinessDependencies = {
  database: checkDatabase,
  redis: checkRedis,
  migrations: checkMigrations,
};

async function runBoundedCheck(check: () => Promise<void>, timeoutMs: number): Promise<ReadinessCheckStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Readiness check timed out')), timeoutMs);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function assessReadiness(
  dependencies: ReadinessDependencies = defaultDependencies,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const [database, redis, migrations] = await Promise.all([
    runBoundedCheck(dependencies.database, timeoutMs),
    runBoundedCheck(dependencies.redis, timeoutMs),
    runBoundedCheck(dependencies.migrations, timeoutMs),
  ]);
  const checks = { database, redis, migrations };

  return {
    status: Object.values(checks).every((status) => status === 'ok') ? 'ready' : 'not_ready',
    checks,
  };
}
