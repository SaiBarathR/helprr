import { prisma } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import { releaseCacheLock, tryAcquireCacheLock } from '@/lib/cache/state';

export type DashboardDevice = 'desktop' | 'mobile';

export interface ActiveLayout {
  id: string;
  name: string;
  widgets: unknown;
  isBuiltIn: boolean;
}

interface CacheEntry {
  device: DashboardDevice;
  layout: ActiveLayout | null;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

const TTL_SECONDS = 5 * 60;
const STALE_SECONDS = 24 * 60 * 60;

function buildKey(device: DashboardDevice): string {
  return `helprr:dashboard-layout:active:${device}`;
}

async function readEntry(key: string): Promise<CacheEntry | null> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;
    if (
      typeof parsed.fetchedAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.staleUntil !== 'number'
      || (parsed.device !== 'desktop' && parsed.device !== 'mobile')
    ) {
      return null;
    }
    return {
      device: parsed.device,
      layout: (parsed.layout ?? null) as ActiveLayout | null,
      fetchedAt: parsed.fetchedAt,
      expiresAt: parsed.expiresAt,
      staleUntil: parsed.staleUntil,
    };
  } catch {
    return null;
  }
}

async function writeEntry(key: string, entry: CacheEntry, nowMs: number): Promise<void> {
  try {
    const redis = await getRedisClient();
    const ttlSeconds = Math.max(1, Math.ceil((entry.staleUntil - nowMs) / 1000));
    await redis.set(key, JSON.stringify(entry), { EX: ttlSeconds });
  } catch {
    // noop — Redis is best-effort; on failure callers re-hit Postgres next time.
  }
}

async function fetchLayoutFromDb(device: DashboardDevice): Promise<ActiveLayout | null> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: {
      defaultDesktopLayoutId: true,
      defaultMobileLayoutId: true,
    },
  });
  const pointerId = device === 'desktop'
    ? settings?.defaultDesktopLayoutId
    : settings?.defaultMobileLayoutId;

  if (pointerId) {
    // Scope to a global (admin) layout so a stale pointer can't surface a
    // member's personal layout to the admin dashboard.
    const row = await prisma.dashboardLayout.findFirst({
      where: { id: pointerId, userId: null },
      select: { id: true, name: true, widgets: true, isBuiltIn: true },
    });
    if (row) return row as ActiveLayout;
  }

  // Pointer is null or stale — fall back to the oldest GLOBAL layout if any exist.
  const fallback = await prisma.dashboardLayout.findFirst({
    where: { userId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, widgets: true, isBuiltIn: true },
  });
  return (fallback as ActiveLayout | null) ?? null;
}

export async function getActiveLayoutCached(device: DashboardDevice): Promise<ActiveLayout | null> {
  const key = buildKey(device);
  const now = Date.now();

  const cached = await readEntry(key);
  if (cached && now < cached.expiresAt) {
    return cached.layout;
  }

  const lockToken = await tryAcquireCacheLock('dashboard-layout', device);
  if (!lockToken && cached && now < cached.staleUntil) {
    return cached.layout;
  }

  try {
    const layout = await fetchLayoutFromDb(device);
    const entry: CacheEntry = {
      device,
      layout,
      fetchedAt: now,
      expiresAt: now + TTL_SECONDS * 1000,
      staleUntil: now + (TTL_SECONDS + STALE_SECONDS) * 1000,
    };
    await writeEntry(key, entry, now);
    return layout;
  } catch (error) {
    if (cached && now < cached.staleUntil) {
      return cached.layout;
    }
    throw error;
  } finally {
    if (lockToken) {
      void releaseCacheLock('dashboard-layout', device, lockToken);
    }
  }
}

export async function invalidateLayoutCache(): Promise<void> {
  try {
    const redis = await getRedisClient();
    await Promise.all([
      redis.del(buildKey('desktop')),
      redis.del(buildKey('mobile')),
    ]);
  } catch {
    // noop
  }
}
