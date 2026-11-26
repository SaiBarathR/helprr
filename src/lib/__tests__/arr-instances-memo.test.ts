import { beforeEach, describe, expect, it, vi } from 'vitest';

// Each API route and the poller load their own copy of arr-instances. Saving an
// instance clears the memo in the services route's copy; the poller's copy must
// see that, or its cache warm-up rebuilds the combined library without the new
// instance and caches it for the full TTL.
const findMany = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findMany } } }));

const row = (id: string) => ({ id, type: 'SONARR', label: id, isDefault: id === 'main' });

beforeEach(() => {
  findMany.mockReset();
});

describe('connection memo', () => {
  it('is cleared for every copy of the module, not only the one that saved the instance', async () => {
    vi.resetModules();
    const poller = await import('@/lib/arr-instances');
    findMany.mockResolvedValue([row('main')]);
    expect((await poller.listConnections('SONARR')).map((c) => c.id)).toEqual(['main']);

    vi.resetModules();
    const servicesRoute = await import('@/lib/arr-instances');
    expect(servicesRoute).not.toBe(poller);
    findMany.mockResolvedValue([row('main'), row('anime')]);
    servicesRoute.clearConnectionMemo();

    expect((await poller.listConnections('SONARR')).map((c) => c.id)).toEqual(['main', 'anime']);
  });
});
