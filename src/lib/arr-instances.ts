import type { ServiceConnection, ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';

export type ArrServiceType = 'SONARR' | 'RADARR' | 'LIDARR';
export const ARR_TYPES: ArrServiceType[] = ['SONARR', 'RADARR', 'LIDARR'];

export function isArrType(type: ServiceType): type is ArrServiceType {
  return type === 'SONARR' || type === 'RADARR' || type === 'LIDARR';
}

// Hot-path memo: connection rows are read on nearly every API request but only
// change via the settings CRUD routes, which call clearConnectionMemo(). The
// short TTL bounds staleness for any edit path that misses the clear.
const CONNECTION_MEMO_TTL_MS = 10_000;
const connectionMemo = new Map<string, { value: unknown; at: number }>();

function memoGet<T>(key: string): T | undefined {
  const entry = connectionMemo.get(key);
  if (!entry || Date.now() - entry.at > CONNECTION_MEMO_TTL_MS) return undefined;
  return entry.value as T;
}

function memoSet(key: string, value: unknown): void {
  connectionMemo.set(key, { value, at: Date.now() });
}

/** Drop memoized connection rows. Call after any ServiceConnection mutation. */
export function clearConnectionMemo(): void {
  connectionMemo.clear();
}

/** All connections of a type, default first, then alphabetical by label. */
export async function listConnections(type: ServiceType): Promise<ServiceConnection[]> {
  const key = `list:${type}`;
  const memo = memoGet<ServiceConnection[]>(key);
  if (memo) return memo;
  const rows = await prisma.serviceConnection.findMany({
    where: { type },
    orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
  });
  memoSet(key, rows);
  return rows;
}

/** The default connection for a type (or the oldest if no flag is set), or null. */
export async function getDefaultConnection(type: ServiceType): Promise<ServiceConnection | null> {
  const key = `default:${type}`;
  const memo = memoGet<ServiceConnection>(key);
  if (memo) return memo;
  const def = await prisma.serviceConnection.findFirst({ where: { type, isDefault: true } });
  const row = def ?? (await prisma.serviceConnection.findFirst({ where: { type }, orderBy: { createdAt: 'asc' } }));
  // Only memoize hits: a memoized "not configured" would hide a just-added
  // connection for the whole TTL if a clear was missed.
  if (row) memoSet(key, row);
  return row;
}

/**
 * Resolve a specific instance by id (validated against `type`), else the type's
 * default. Throws a configuration error if nothing matches — same message shape
 * the old singleton getters threw, so callers' catch/skip logic is unchanged.
 */
export async function resolveConnection(type: ServiceType, instanceId?: string | null): Promise<ServiceConnection> {
  if (instanceId) {
    const key = `id:${instanceId}`;
    const memoized = memoGet<ServiceConnection>(key);
    const conn = memoized ?? (await prisma.serviceConnection.findUnique({ where: { id: instanceId } }));
    if (!conn || conn.type !== type) {
      throw new Error(`No ${type} instance found for id "${instanceId}".`);
    }
    if (!memoized) memoSet(key, conn);
    return conn;
  }
  const def = await getDefaultConnection(type);
  if (!def) {
    throw new Error(`${type} is not configured. Please add a connection in Settings.`);
  }
  return def;
}

/** Ensure the type has exactly one default. Call after create/delete. Promotes the oldest. */
export async function ensureDefaultForType(type: ServiceType): Promise<void> {
  const all = await prisma.serviceConnection.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });
  if (all.length === 0) return;
  const defaults = all.filter((c) => c.isDefault);
  if (defaults.length === 1) return;
  const keep = defaults[0] ?? all[0];
  await prisma.$transaction([
    prisma.serviceConnection.updateMany({ where: { type, id: { not: keep.id } }, data: { isDefault: false } }),
    prisma.serviceConnection.update({ where: { id: keep.id }, data: { isDefault: true } }),
  ]);
  clearConnectionMemo();
}

/** Make `id` the sole default for its type. */
export async function setDefaultConnection(id: string): Promise<void> {
  const conn = await prisma.serviceConnection.findUnique({ where: { id } });
  if (!conn) throw new Error('Connection not found');
  await prisma.$transaction([
    prisma.serviceConnection.updateMany({ where: { type: conn.type }, data: { isDefault: false } }),
    prisma.serviceConnection.update({ where: { id }, data: { isDefault: true } }),
  ]);
  clearConnectionMemo();
}
