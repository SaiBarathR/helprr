import { describe, expect, it, vi } from 'vitest';
import {
  buildSupportBundle,
  serializeSupportBundle,
  type SupportBundleDependencies,
  type SupportDatabaseSnapshot,
} from '@/lib/support-bundle';
import type { LogEntry } from '@/lib/logger';

const readiness = {
  status: 'ready' as const,
  checks: { database: 'ok' as const, redis: 'ok' as const, migrations: 'ok' as const },
};
const testServiceApiKey = ['sonarr', 'api', 'key', 'value'].join('-');

function databaseFixture(): SupportDatabaseSnapshot {
  return {
    services: [{
      type: 'SONARR',
      label: 'Main',
      isDefault: true,
      url: 'http://service-user:service-password@sonarr.internal:8989',
      externalUrl: 'https://sonarr.example.test',
      username: 'service-user',
      apiKey: testServiceApiKey,
      accessToken: 'service-access-token',
      refreshToken: 'service-refresh-token',
      customHeaders: { 'X-Proxy-Secret': 'proxy-header-secret' },
    }],
    settings: {
      pollingIntervalSecs: 30,
      activityRefreshIntervalSecs: 5,
      torrentsRefreshIntervalSecs: 5,
      cacheImagesEnabled: true,
      timeZone: 'Etc/UTC',
      logEnabled: true,
      logLevel: 'info',
      logMaxFileMb: 50,
      logRetentionDays: 30,
      notificationHistoryRetentionDays: 90,
      notificationGroupingEnabled: true,
    },
    counts: { users: 2, sessions: 3, serviceConnections: 1 },
    appliedMigrations: ['0001_init'],
  };
}

function logFixture(): LogEntry[] {
  return [{
    timestampUtc: '2026-07-14T12:00:00.000Z',
    timestampLocal: '2026-07-14 12:00:00',
    timeZone: 'Etc/UTC',
    level: 'error',
    source: 'server',
    message: `Failed with ${testServiceApiKey} and database-password-value`,
    metadata: {
      harmless: 'proxy-header-secret',
      passwordHash: 'scrypt-password-hash',
      nested: { value: 'service-access-token' },
      harmlessLong: '0123456789abcdef0123456789abcdef',
      harmlessBasic: 'Basic dXNlcjpvbGQtcGFzc3dvcmQ=',
      oldUrl: 'https://old-user:old-password@example.invalid/path',
    },
  }];
}

describe('support bundle', () => {
  it('includes useful diagnostics while removing runtime and service credentials', async () => {
    const database = databaseFixture();
    const dependencies: SupportBundleDependencies = {
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      appVersion: '1.0.0',
      gitSha: 'abcdef123456',
      environment: {
        DATABASE_URL: 'postgresql://postgres:database-password-value@db:5432/helprr',
        REDIS_URL: 'redis://redis:6379',
        REDIS_PASSWORD: 'redis-password-value',
        APP_PASSWORD: 'bootstrap-password-value',
        JWT_SECRET: 'jwt-secret-value-that-is-long-enough',
        VAPID_PRIVATE_KEY: 'vapid-private-value',
      },
      loadDatabase: async () => database,
      readReadiness: async () => readiness,
      readLogs: async () => logFixture(),
    };

    const bundle = await buildSupportBundle(dependencies);
    const serialized = serializeSupportBundle(bundle);

    expect(bundle.database).toMatchObject({
      status: 'ok',
      counts: { users: 2, sessions: 3, serviceConnections: 1 },
    });
    expect(bundle.services).toEqual([{
      type: 'SONARR',
      label: 'Main',
      isDefault: true,
      configured: {
        url: true,
        externalUrl: true,
        username: true,
        apiKey: true,
        accessToken: true,
        refreshToken: true,
        customHeaders: 1,
      },
    }]);
    expect(bundle.logs.status).toBe('included');
    for (const secret of [
      'database-password-value',
      'redis-password-value',
      'bootstrap-password-value',
      'jwt-secret-value-that-is-long-enough',
      'vapid-private-value',
      'service-user',
      'service-password',
      testServiceApiKey,
      'service-access-token',
      'service-refresh-token',
      'proxy-header-secret',
      'scrypt-password-hash',
      '0123456789abcdef0123456789abcdef',
      'dXNlcjpvbGQtcGFzc3dvcmQ=',
      'old-user',
      'old-password',
    ]) {
      expect(serialized, `bundle leaked ${secret}`).not.toContain(secret);
    }
    expect(serialized).not.toContain('sonarr.internal');
    expect(serialized).toContain('https://[REDACTED]@example.invalid/path');
    expect(serialized).toContain('[REDACTED]');
  });

  it('omits logs when the service credential inventory cannot be loaded', async () => {
    const readLogs = vi.fn(async () => logFixture());
    const bundle = await buildSupportBundle({
      environment: { JWT_SECRET: 'known-jwt-secret' },
      loadDatabase: async () => { throw new Error('database unavailable'); },
      readReadiness: async () => readiness,
      readLogs,
    });

    expect(bundle.database.status).toBe('unavailable');
    expect(bundle.services).toEqual([]);
    expect(bundle.logs).toEqual({
      status: 'omitted',
      reason: 'Service credential inventory unavailable',
    });
    expect(bundle.redaction.logsIncluded).toBe(false);
    expect(readLogs).not.toHaveBeenCalled();
  });

  it('bounds recent logs to 250 entries and redacts sensitive structured keys', async () => {
    const logs = Array.from({ length: 300 }, (_, index): LogEntry => ({
      timestampUtc: new Date(index).toISOString(),
      timestampLocal: String(index),
      timeZone: 'UTC',
      level: 'info',
      source: 'server',
      message: `entry-${index}`,
      metadata: { authorization: `Bearer credential-${index}` },
    }));
    const bundle = await buildSupportBundle({
      loadDatabase: async () => databaseFixture(),
      readReadiness: async () => readiness,
      readLogs: async () => logs,
    });

    expect(bundle.logs.status).toBe('included');
    expect(bundle.logs.entries).toHaveLength(250);
    expect(JSON.stringify(bundle.logs)).not.toContain('Bearer credential-');
  });
});
