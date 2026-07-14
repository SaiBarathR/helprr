import { assessReadiness, readExpectedMigrationNames, type ReadinessReport } from '@/lib/readiness';
import { redact, searchLogs, type LogEntry } from '@/lib/logger';

const MAX_SUPPORT_LOG_ENTRIES = 250;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(?:auth|authorization|cookie|credential|databaseurl|endpoint|jwt|p256dh|passw|private.?key|secret|session|token|api.?key|vapid)/i;
const ENV_SECRET_NAMES = [
  'DATABASE_URL',
  'REDIS_URL',
  'REDIS_PASSWORD',
  'APP_PASSWORD',
  'JWT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
] as const;

interface RawServiceConnection {
  type: string;
  label: string;
  isDefault: boolean;
  url: string;
  externalUrl: string | null;
  username: string | null;
  apiKey: string;
  accessToken: string | null;
  refreshToken: string | null;
  customHeaders: unknown;
}

interface SafeAppSettings {
  pollingIntervalSecs: number;
  activityRefreshIntervalSecs: number;
  torrentsRefreshIntervalSecs: number;
  cacheImagesEnabled: boolean;
  timeZone: string;
  logEnabled: boolean;
  logLevel: string;
  logMaxFileMb: number;
  logRetentionDays: number;
  notificationHistoryRetentionDays: number;
  notificationGroupingEnabled: boolean;
}

export interface SupportDatabaseSnapshot {
  services: RawServiceConnection[];
  settings: SafeAppSettings | null;
  counts: Record<string, number>;
  appliedMigrations: string[];
}

export interface SupportBundleDependencies {
  now?: () => Date;
  environment?: Readonly<Record<string, string | undefined>>;
  appVersion?: string;
  gitSha?: string;
  loadDatabase?: () => Promise<SupportDatabaseSnapshot>;
  readReadiness?: () => Promise<ReadinessReport>;
  readLogs?: () => Promise<LogEntry[]>;
}

export interface SupportBundle {
  schemaVersion: 1;
  generatedAt: string;
  redaction: {
    policy: string;
    logsIncluded: boolean;
  };
  application: {
    version: string;
    gitSha: string | null;
    nodeVersion: string;
    platform: string;
    architecture: string;
    uptimeSeconds: number;
  };
  readiness: ReadinessReport;
  database: {
    status: 'ok' | 'unavailable';
    counts?: Record<string, number>;
    settings?: SafeAppSettings | null;
    migrations: {
      expected: string[];
      applied?: string[];
    };
  };
  services: Array<{
    type: string;
    label: string;
    isDefault: boolean;
    configured: {
      url: boolean;
      externalUrl: boolean;
      username: boolean;
      apiKey: boolean;
      accessToken: boolean;
      refreshToken: boolean;
      customHeaders: number;
    };
  }>;
  logs: {
    status: 'included' | 'unavailable' | 'omitted';
    reason?: string;
    entries?: unknown[];
  };
}

function addSecret(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length < 4) return;
  target.add(trimmed);

  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.length >= 4) target.add(decoded);
  } catch {
    // Keep the original value only.
  }

  try {
    const encoded = encodeURIComponent(trimmed);
    if (encoded.length >= 4) target.add(encoded);
  } catch {
    // Keep the original value only.
  }
}

function addUrlSecrets(target: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  addSecret(target, value);
  try {
    const parsed = new URL(value);
    addSecret(target, parsed.username);
    addSecret(target, parsed.password);
  } catch {
    // A malformed service URL is still protected as one exact string above.
  }
}

function addStringLeaves(target: Set<string>, value: unknown, depth = 0): void {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    addSecret(target, value);
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item) => addStringLeaves(target, item, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value as Record<string, unknown>)
      .slice(0, 100)
      .forEach((item) => addStringLeaves(target, item, depth + 1));
  }
}

function collectKnownSecrets(
  environment: Readonly<Record<string, string | undefined>>,
  services: RawServiceConnection[],
): string[] {
  const secrets = new Set<string>();
  for (const name of ENV_SECRET_NAMES) {
    const value = environment[name];
    addSecret(secrets, value);
    if (name.endsWith('_URL')) addUrlSecrets(secrets, value);
  }

  for (const service of services) {
    addUrlSecrets(secrets, service.url);
    addUrlSecrets(secrets, service.externalUrl);
    addSecret(secrets, service.username);
    addSecret(secrets, service.apiKey);
    addSecret(secrets, service.accessToken);
    addSecret(secrets, service.refreshToken);
    addStringLeaves(secrets, service.customHeaders);
  }

  return [...secrets].sort((a, b) => b.length - a.length);
}

function redactKnownSecrets(
  value: string,
  secrets: readonly string[],
  aggressive = false,
): string {
  let output = redact(value) as string;
  for (const secret of secrets) {
    if (output.includes(secret)) output = output.split(secret).join(REDACTED);
  }
  if (aggressive) {
    // Historical logs may contain a credential that was rotated out of the
    // current database. Remove common standalone credential shapes as a final
    // support-bundle-only backstop. Request UUIDs remain intact.
    output = output
      .replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, `$1${REDACTED}`)
      .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, `$1${REDACTED}@`)
      .replace(/(?<![A-Za-z0-9])[A-Fa-f0-9]{24,}(?![A-Za-z0-9])/g, REDACTED)
      .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, REDACTED);
  }
  return output;
}

function sanitizeSupportValue(
  value: unknown,
  secrets: readonly string[],
  depth = 0,
  seen = new WeakSet<object>(),
  aggressiveStrings = false,
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactKnownSecrets(value, secrets, aggressiveStrings);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return sanitizeSupportValue(
      { name: value.name, message: value.message },
      secrets,
      depth + 1,
      seen,
      aggressiveStrings,
    );
  }
  if (depth > 8) return '[MaxDepth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 250).map((item) => (
      sanitizeSupportValue(item, secrets, depth + 1, seen, aggressiveStrings)
    ));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 250)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      && typeof item !== 'boolean'
      && typeof item !== 'number'
      ? REDACTED
      : sanitizeSupportValue(item, secrets, depth + 1, seen, aggressiveStrings);
  }
  return output;
}

async function loadDatabaseSnapshot(): Promise<SupportDatabaseSnapshot> {
  const { prisma } = await import('@/lib/db');
  const [
    services,
    settings,
    users,
    sessions,
    pushSubscriptions,
    notifications,
    scheduledAlerts,
    scheduledOccurrences,
    pendingRequests,
    cleanupHistory,
    operationAudit,
    diskSnapshots,
    migrations,
  ] = await Promise.all([
    prisma.serviceConnection.findMany({
      orderBy: [{ type: 'asc' }, { label: 'asc' }],
      select: {
        type: true,
        label: true,
        isDefault: true,
        url: true,
        externalUrl: true,
        username: true,
        apiKey: true,
        accessToken: true,
        refreshToken: true,
        customHeaders: true,
      },
    }),
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: {
        pollingIntervalSecs: true,
        activityRefreshIntervalSecs: true,
        torrentsRefreshIntervalSecs: true,
        cacheImagesEnabled: true,
        timeZone: true,
        logEnabled: true,
        logLevel: true,
        logMaxFileMb: true,
        logRetentionDays: true,
        notificationHistoryRetentionDays: true,
        notificationGroupingEnabled: true,
      },
    }),
    prisma.user.count(),
    prisma.session.count(),
    prisma.pushSubscription.count(),
    prisma.notificationHistory.count(),
    prisma.scheduledAlert.count(),
    prisma.scheduledAlertOccurrence.count(),
    prisma.pendingRequest.count(),
    prisma.cleanupHistory.count(),
    prisma.fileOperationAudit.count(),
    prisma.diskUsageSnapshot.count(),
    prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY started_at ASC
    `,
  ]);

  return {
    services,
    settings,
    counts: {
      users,
      serviceConnections: services.length,
      sessions,
      pushSubscriptions,
      notificationHistory: notifications,
      scheduledAlerts,
      scheduledAlertOccurrences: scheduledOccurrences,
      pendingRequests,
      cleanupHistory,
      operationAudit,
      diskUsageSnapshots: diskSnapshots,
    },
    appliedMigrations: migrations.map((migration) => migration.migration_name),
  };
}

function safeReadinessFailure(): ReadinessReport {
  return {
    status: 'not_ready',
    checks: { database: 'error', redis: 'error', migrations: 'error' },
  };
}

function configuredService(service: RawServiceConnection): SupportBundle['services'][number] {
  const customHeaders = service.customHeaders && typeof service.customHeaders === 'object'
    ? Object.keys(service.customHeaders as Record<string, unknown>).length
    : 0;
  return {
    type: service.type,
    label: service.label,
    isDefault: service.isDefault,
    configured: {
      url: service.url.trim().length > 0,
      externalUrl: Boolean(service.externalUrl?.trim()),
      username: Boolean(service.username?.trim()),
      apiKey: service.apiKey.trim().length > 0,
      accessToken: Boolean(service.accessToken?.trim()),
      refreshToken: Boolean(service.refreshToken?.trim()),
      customHeaders,
    },
  };
}

export async function buildSupportBundle(
  dependencies: SupportBundleDependencies = {},
): Promise<SupportBundle> {
  const now = dependencies.now?.() ?? new Date();
  const environment = dependencies.environment ?? process.env;
  const [readiness, expectedMigrations, databaseResult] = await Promise.all([
    (dependencies.readReadiness ?? assessReadiness)().catch(safeReadinessFailure),
    readExpectedMigrationNames().catch(() => []),
    (dependencies.loadDatabase ?? loadDatabaseSnapshot)()
      .then((value) => ({ ok: true as const, value }))
      .catch(() => ({ ok: false as const })),
  ]);

  const services = databaseResult.ok ? databaseResult.value.services : [];
  const secrets = collectKnownSecrets(environment, services);

  let logs: SupportBundle['logs'];
  if (!databaseResult.ok) {
    // Without the stored service-secret inventory, exact-value redaction cannot
    // prove logs are safe. Omit them rather than falling back to weaker output.
    logs = { status: 'omitted', reason: 'Service credential inventory unavailable' };
  } else {
    try {
      const entries = await (dependencies.readLogs ?? (() => searchLogs({ limit: MAX_SUPPORT_LOG_ENTRIES })))();
      logs = {
        status: 'included',
        entries: sanitizeSupportValue(
          entries.slice(0, MAX_SUPPORT_LOG_ENTRIES),
          secrets,
          0,
          new WeakSet<object>(),
          true,
        ) as unknown[],
      };
    } catch {
      logs = { status: 'unavailable', reason: 'Server logs could not be read' };
    }
  }

  const bundle: SupportBundle = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    redaction: {
      policy: 'Known runtime and service credentials removed; sensitive structured fields redacted',
      logsIncluded: logs.status === 'included',
    },
    application: {
      version: dependencies.appVersion ?? process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',
      gitSha: (dependencies.gitSha ?? process.env.NEXT_PUBLIC_GIT_SHA) || null,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
    },
    readiness,
    database: databaseResult.ok
      ? {
          status: 'ok',
          counts: databaseResult.value.counts,
          settings: databaseResult.value.settings,
          migrations: {
            expected: expectedMigrations,
            applied: databaseResult.value.appliedMigrations,
          },
        }
      : {
          status: 'unavailable',
          migrations: { expected: expectedMigrations },
        },
    services: services.map(configuredService),
    logs,
  };

  // Apply one final whole-bundle pass so a secret accidentally copied into a
  // future diagnostic field is still removed before the route serializes it.
  return sanitizeSupportValue(bundle, secrets) as SupportBundle;
}

export function serializeSupportBundle(bundle: SupportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
