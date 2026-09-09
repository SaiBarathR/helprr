import { measureServer } from '@/lib/server-perf';
// Short-lived, bounded read cache. Callers authenticate and resolve the current
// Jellyfin connection/user BEFORE entering this cache. No session lives here.
type Entry = { until: number; promise: Promise<unknown> };
const globalCache = globalThis as typeof globalThis & { __helprrJellyfinCatalog?: Map<string, Entry> };
const rows = globalCache.__helprrJellyfinCatalog ??= new Map<string, Entry>();
export function invalidateJellyfinCatalog(userId: string): void {
  for (const key of rows.keys()) if (key.startsWith(`${userId}:`)) rows.delete(key);
}
export async function cachedJellyfinCatalog<T>(userId: string, identity: string, section: string, read: () => Promise<T>): Promise<T> {
  const key = `${userId}:${identity}:${section}`;
  const existing = rows.get(key);
  if (existing && existing.until > Date.now()) return existing.promise as Promise<T>;
  const entry = { until: Date.now() + 10_000, promise: Promise.resolve().then(() => measureServer('upstream', read)) };
  rows.set(key, entry);
  if (rows.size > 256) rows.delete(rows.keys().next().value!);
  try { return await entry.promise; }
  catch (error) { if (rows.get(key) === entry) rows.delete(key); throw error; }
}
