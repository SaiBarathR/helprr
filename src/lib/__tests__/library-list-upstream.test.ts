import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  clients: vi.fn(),
  library: vi.fn(),
  labels: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: async () => ({ ok: true, user: { id: 'u1' } }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: () => {} }));
vi.mock('@/lib/service-helpers', () => ({ getRadarrClient: vi.fn(), getRadarrClients: mocks.clients }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: vi.fn() }));
vi.mock('@/lib/cache/reference-labels', () => ({ getInstanceLabelMaps: mocks.labels, labelsFor: () => ({}) }));
vi.mock('@/lib/cache/tagged-library', () => ({
  getCachedTaggedLibrary: mocks.library,
  invalidateTaggedLibrary: vi.fn(),
  // The response cache is out of scope here: build the payload every time.
  getCachedTaggedLibraryJsonResponse: async (_request: unknown, headers: Record<string, string>, opts: { buildPayload: () => Promise<{ payload: unknown; itemCount: number }> }) => {
    const { payload, itemCount } = await opts.buildPayload();
    return { response: NextResponse.json(payload, { headers }), cached: false, itemCount };
  },
}));

import { GET } from '@/app/api/radarr/route';

const instance = (id: string) => ({ connection: { id, label: id }, client: {} });
const movie = { id: 1, title: 'Film', images: [], tags: [], qualityProfileId: 1, instanceId: 'r1', instanceLabel: 'r1' };
const list = () => GET(new NextRequest('http://localhost/api/radarr') as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.labels.mockResolvedValue(new Map());
});

describe('film list when Radarr instances fail', () => {
  it('answers an error, not an empty library, when every configured instance failed', async () => {
    mocks.clients.mockResolvedValue([instance('r1')]);
    mocks.library.mockImplementation(async (opts: { getInstances: () => Promise<unknown> }) => {
      await opts.getInstances();
      return { items: [], cached: false, available: false, complete: false };
    });

    const response = await list();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to fetch movies' });
  });

  it('answers an empty list when no Radarr is configured', async () => {
    mocks.clients.mockResolvedValue([]);
    mocks.library.mockResolvedValue({ items: [], cached: false, available: false, complete: false });

    const response = await list();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('keeps the films of the instances that answered', async () => {
    mocks.clients.mockResolvedValue([instance('r1'), instance('r2')]);
    mocks.library.mockResolvedValue({ items: [movie], cached: false, available: true, complete: false });

    const response = await list();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([expect.objectContaining({ id: 1, instanceId: 'r1' })]);
  });

  it('reads the labels alongside the films, not after them', async () => {
    mocks.clients.mockResolvedValue([instance('r1')]);
    let labelsStartedFirst = false;
    mocks.library.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      labelsStartedFirst = mocks.labels.mock.calls.length > 0;
      return { items: [movie], cached: false, available: true, complete: true };
    });

    await list();

    expect(labelsStartedFirst).toBe(true);
  });
});
