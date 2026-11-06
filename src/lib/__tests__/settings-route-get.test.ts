import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => null), requireAdmin: vi.fn() }));
vi.mock('@/lib/polling-service', () => ({ pollingService: {} }));
vi.mock('@/lib/cache/admin', () => ({ disableCachingAndPurgeCaches: vi.fn() }));
vi.mock('@/lib/cache/state', () => ({ setCachedAnilistTtlSettings: vi.fn(), setCachedCacheImagesEnabled: vi.fn() }));
vi.mock('@/lib/logger', () => ({ configureLogger: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ configureApiLogging: vi.fn(), withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/app-settings', () => ({
  getOrCreateAppSettings: vi.fn(async () => ({
    id: 'singleton',
    pollingIntervalSecs: 30,
    lastDatabaseBackupAt: new Date('2026-11-04T03:00:00.000Z'),
  })),
}));

const { GET } = await import('@/app/api/settings/route');

describe('GET /api/settings', () => {
  it('leaves out the database backup time, which is for admins only', async () => {
    const body = await (await (GET as () => Promise<Response>)()).json();
    expect(body.pollingIntervalSecs).toBe(30);
    expect(body).not.toHaveProperty('lastDatabaseBackupAt');
  });
});
