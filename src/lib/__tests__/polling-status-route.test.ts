import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), health: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.admin }));
vi.mock('@/lib/polling-service', () => ({ pollingService: { getHealth: mocks.health } }));

const { GET } = await import('@/app/api/admin/polling-status/route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.health.mockReturnValue({ running: true, intervalMs: 30000, cycleInProgress: false, lastCycle: null, sources: [] });
});

describe('/api/admin/polling-status', () => {
  it('returns the polling health to an admin, uncached', async () => {
    mocks.admin.mockResolvedValue({ ok: true, user: { id: 'a', role: 'admin' } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await res.json()).intervalMs).toBe(30000);
  });

  it('refuses anyone else before reading anything', async () => {
    mocks.admin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect(mocks.health).not.toHaveBeenCalled();
  });
});
