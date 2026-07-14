#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotsDir = path.join(root, 'prisma/release-snapshots');
const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

function fail(message) {
  throw new Error(message);
}

if (!databaseUrl) {
  fail('MIGRATION_TEST_DATABASE_URL is required and must point to a disposable test database.');
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  fail('MIGRATION_TEST_DATABASE_URL is not a valid URL.');
}
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  fail('MIGRATION_TEST_DATABASE_URL must use PostgreSQL.');
}
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ''));
if (databaseName !== 'helprr_migration_test') {
  fail('Refusing to reset a database not named exactly "helprr_migration_test".');
}

const redactions = [databaseUrl, parsedDatabaseUrl.password].filter(Boolean);
function redact(value) {
  return redactions.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
}

function runPrisma(args, { input, schema } = {}) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    command,
    ['--no-install', 'prisma', ...args, ...(schema ? ['--schema', schema] : [])],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl },
      input,
    },
  );
  if (result.stdout) process.stdout.write(redact(result.stdout));
  if (result.stderr) process.stderr.write(redact(result.stderr));
  if (result.status !== 0) {
    fail(`Prisma command failed: prisma ${args.join(' ')}`);
  }
}

function checksum(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function currentMigrationNames() {
  return readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const seedSql = `
INSERT INTO "User" (
  "id", "username", "displayName", "passwordHash", "role", "status",
  "template", "permissions", "createdAt", "updatedAt"
) VALUES (
  'migration-user', 'migration-user', 'Migration User', 'preserved-hash',
  'member', 'active', 'member', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "ServiceConnection" (
  "id", "type", "label", "isDefault", "url", "apiKey", "customHeaders",
  "createdAt", "updatedAt"
) VALUES (
  'migration-service', 'SONARR', 'Migration Sonarr', true,
  'http://sonarr.invalid', 'preserved-api-key', '{"X-Test":"preserved"}',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "CleanupHistory" (
  "id", "cleaner", "hash", "shortHash", "torrentName", "reason", "action",
  "filesDeleted", "reSearched", "triggeredBy", "createdAt"
) VALUES (
  'migration-cleanup', 'download', 'full-hash', 'short-hash', 'Preserved Torrent',
  'migration test', 'dryRunPreview', false, false, 'manual', CURRENT_TIMESTAMP
);

INSERT INTO "FileOperationAudit" (
  "id", "userId", "username", "service", "operation", "mediaType", "mediaId",
  "mediaTitle", "fileCount", "details", "success", "createdAt"
) VALUES (
  'migration-audit', 'migration-user', 'migration-user', 'SONARR', 'EDIT',
  'series', 42, 'Preserved Series', 1, '{"preserved":true}', true, CURRENT_TIMESTAMP
);
`;

function assertionSql(expectedMigrations) {
  return `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE "id" = 'migration-user' AND "username" = 'migration-user'
      AND "passwordHash" = 'preserved-hash'
  ) THEN
    RAISE EXCEPTION 'released user row was not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "ServiceConnection"
    WHERE "id" = 'migration-service' AND "apiKey" = 'preserved-api-key'
      AND "customHeaders" = '{"X-Test":"preserved"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'released service row was not preserved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CleanupHistory"
    WHERE "id" = 'migration-cleanup' AND "previewId" IS NULL
      AND "outcomeStatus" IS NULL AND "outcomeDetails" IS NULL
  ) THEN
    RAISE EXCEPTION 'cleanup migration did not preserve the released row';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "FileOperationAudit"
    WHERE "id" = 'migration-audit' AND "mediaId" = 42 AND "filesDeleted" IS NULL
  ) THEN
    RAISE EXCEPTION 'audit migration did not preserve the released row';
  END IF;

  IF (SELECT COUNT(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)
      <> ${expectedMigrations} THEN
    RAISE EXCEPTION 'unexpected applied migration count';
  END IF;

  IF EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'failed or rolled-back migration remains';
  END IF;
END $$;

INSERT INTO "FileOperationAudit" (
  "id", "username", "service", "operation", "mediaType", "mediaId",
  "mediaTitle", "fileCount", "filesDeleted", "success", "createdAt"
) VALUES (
  'migration-new-audit', 'migration-user', 'QBITTORRENT', 'DELETE_TORRENT',
  'torrent', NULL, 'New Audit Shape', 1, false, true, CURRENT_TIMESTAMP
);
`;
}

const cleanupSql = 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;';
const snapshotFiles = readdirSync(snapshotsDir)
  .filter((name) => name.endsWith('.json'))
  .sort();
if (snapshotFiles.length === 0) fail('No release migration snapshots were found.');

const currentCount = currentMigrationNames().length;
let failure = null;

try {
  for (const snapshotFile of snapshotFiles) {
    const snapshot = JSON.parse(readFileSync(path.join(snapshotsDir, snapshotFile), 'utf8'));
    if (!snapshot.release || !Array.isArray(snapshot.migrations) || snapshot.migrations.length === 0) {
      fail(`Invalid release snapshot: ${snapshotFile}`);
    }

    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'helprr-migration-snapshot-'));
    try {
      const temporaryPrisma = path.join(temporaryRoot, 'prisma');
      const temporaryMigrations = path.join(temporaryPrisma, 'migrations');
      mkdirSync(temporaryMigrations, { recursive: true });
      copyFileSync(
        path.join(root, 'prisma/migrations/migration_lock.toml'),
        path.join(temporaryMigrations, 'migration_lock.toml'),
      );
      copyFileSync(path.join(root, 'prisma/schema.prisma'), path.join(temporaryPrisma, 'schema.prisma'));

      for (const migration of snapshot.migrations) {
        const source = path.join(root, 'prisma/migrations', migration.name, 'migration.sql');
        if (checksum(source) !== migration.sha256) {
          fail(`${snapshot.release} migration changed after release: ${migration.name}`);
        }
        cpSync(path.dirname(source), path.join(temporaryMigrations, migration.name), { recursive: true });
      }

      process.stdout.write(`Testing upgrade from Helprr ${snapshot.release}...\n`);
      runPrisma(['migrate', 'reset', '--force', '--skip-seed', '--skip-generate'], {
        schema: path.join(temporaryPrisma, 'schema.prisma'),
      });
      runPrisma(['db', 'execute', '--stdin'], {
        input: seedSql,
        schema: path.join(temporaryPrisma, 'schema.prisma'),
      });
      runPrisma(['migrate', 'deploy'], { schema: path.join(root, 'prisma/schema.prisma') });
      runPrisma(['db', 'execute', '--stdin'], {
        input: assertionSql(currentCount),
        schema: path.join(root, 'prisma/schema.prisma'),
      });
      process.stdout.write(`Upgrade from Helprr ${snapshot.release} passed.\n`);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
} catch (error) {
  failure = error;
} finally {
  try {
    runPrisma(['db', 'execute', '--stdin'], {
      input: cleanupSql,
      schema: path.join(root, 'prisma/schema.prisma'),
    });
  } catch (cleanupError) {
    if (!failure) failure = cleanupError;
  }
}

if (failure) {
  process.stderr.write(`${redact(failure instanceof Error ? failure.message : String(failure))}\n`);
  process.exit(1);
}
