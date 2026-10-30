import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  prowlarr: { bulkEditIndexers: vi.fn(), getHealth: vi.fn(), getAppProfiles: vi.fn(), getTags: vi.fn() },
  requireUserCapability: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getProwlarrClient: vi.fn(async () => mocks.prowlarr),
}));

import { PUT as bulkPut } from '@/app/api/prowlarr/indexers/bulk/route';
import { GET as healthGet } from '@/app/api/prowlarr/health/route';

function put(body: unknown) {
  return new NextRequest('http://localhost/api/prowlarr/indexers/bulk', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'admin-1', role: 'admin' }, session: {} });
  mocks.prowlarr.bulkEditIndexers.mockResolvedValue(undefined);
  mocks.prowlarr.getAppProfiles.mockResolvedValue([{ id: 1, name: 'Standard' }]);
  mocks.prowlarr.getTags.mockResolvedValue([{ id: 3, label: 'anime' }]);
});

describe('PUT /api/prowlarr/indexers/bulk', () => {
  it('requires prowlarr.manage and stops before Prowlarr when refused', async () => {
    mocks.requireUserCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const res = await bulkPut(put({ ids: [1], enable: false }));

    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expect(res.status).toBe(403);
    expect(mocks.prowlarr.bulkEditIndexers).not.toHaveBeenCalled();
  });

  it('sends only ids and enable, de-duplicated, and returns no upstream data', async () => {
    mocks.prowlarr.bulkEditIndexers.mockResolvedValue({ fields: [{ name: 'apiKey', value: 'secret' }] });

    const res = await bulkPut(put({ ids: [4, 4, 9], enable: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.prowlarr.bulkEditIndexers).toHaveBeenCalledWith({ ids: [4, 9], enable: false });
  });

  it.each([
    ['not JSON', '{'],
    ['an array', [1]],
    ['an unknown key', { ids: [1], enable: true, seedRatio: 1 }],
    ['nothing to change', { ids: [1] }],
    ['priority 0', { ids: [1], priority: 0 }],
    ['priority 51', { ids: [1], priority: 51 }],
    ['a fractional priority', { ids: [1], priority: 1.5 }],
    ['a zero app profile', { ids: [1], appProfileId: 0 }],
    ['tags without applyTags', { ids: [1], tags: [3] }],
    ['applyTags without tags', { ids: [1], applyTags: 'add' }],
    ['a bad applyTags', { ids: [1], tags: [3], applyTags: 'set' }],
    ['a bad tag', { ids: [1], tags: ['3'], applyTags: 'add' }],
    ['settings smuggled in', { ids: [1], enable: true, fields: [] }],
    ['no ids', { ids: [], enable: true }],
    ['too many ids', { ids: Array.from({ length: 201 }, (_, i) => i + 1), enable: true }],
    ['a zero id', { ids: [0], enable: true }],
    ['a fractional id', { ids: [1.5], enable: true }],
    ['a string id', { ids: ['1'], enable: true }],
    ['enable as a string', { ids: [1], enable: 'false' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await bulkPut(put(body));

    expect(res.status).toBe(400);
    expect(mocks.prowlarr.bulkEditIndexers).not.toHaveBeenCalled();
  });

  it('sends a valid priority, app profile and tag change', async () => {
    const res = await bulkPut(put({ ids: [2], priority: 10, appProfileId: 1, tags: [3, 3], applyTags: 'add' }));

    expect(res.status).toBe(200);
    expect(mocks.prowlarr.bulkEditIndexers).toHaveBeenCalledWith({
      ids: [2], priority: 10, appProfileId: 1, tags: [3], applyTags: 'add',
    });
  });

  it('allows clearing all tags without looking them up', async () => {
    const res = await bulkPut(put({ ids: [2], tags: [], applyTags: 'replace' }));

    expect(res.status).toBe(200);
    expect(mocks.prowlarr.getTags).not.toHaveBeenCalled();
  });

  it.each([
    ['an app profile', { ids: [1], appProfileId: 9 }, 'That app profile no longer exists'],
    ['a tag', { ids: [1], tags: [9], applyTags: 'add' }, 'That tag no longer exists'],
  ])('refuses %s Prowlarr does not have, since its bulk editor would save it', async (_label, body, error) => {
    const res = await bulkPut(put(body));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.prowlarr.bulkEditIndexers).not.toHaveBeenCalled();
  });

  it('reports a Prowlarr failure without its detail', async () => {
    mocks.prowlarr.bulkEditIndexers.mockRejectedValue(new Error('upstream detail http://prowlarr:9696/x?apikey=k'));

    const res = await bulkPut(put({ ids: [1], enable: true }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to enable indexer' });
  });
});

describe('GET /api/prowlarr/health', () => {
  it('requires prowlarr.view', async () => {
    mocks.requireUserCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const res = await healthGet();

    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.view');
    expect(res.status).toBe(403);
    expect(mocks.prowlarr.getHealth).not.toHaveBeenCalled();
  });

  it('passes on the four fields with messages redacted and only https help links', async () => {
    mocks.prowlarr.getHealth.mockResolvedValue([
      {
        source: 'IndexerLongTermStatusCheck',
        type: 'warning',
        message: 'Indexers unavailable due to failures for more than 6 hours: nekoBT',
        wikiUrl: 'https://wiki.servarr.com/prowlarr/system#indexers-are-unavailable-due-to-failures',
        id: 7,
      },
      {
        source: 'IndexerProxyStatusCheck',
        type: 'error',
        message: 'Proxy failed at https://flaresolverr.example/v1?apikey=secret-value',
        wikiUrl: 'javascript:alert(1)',
      },
    ]);

    const res = await healthGet();
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain('secret-value');
    expect(JSON.parse(text)).toEqual([
      {
        source: 'IndexerLongTermStatusCheck',
        type: 'warning',
        message: 'Indexers unavailable due to failures for more than 6 hours: nekoBT',
        wikiUrl: 'https://wiki.servarr.com/prowlarr/system#indexers-are-unavailable-due-to-failures',
      },
      {
        source: 'IndexerProxyStatusCheck',
        type: 'error',
        message: 'Proxy failed at https://flaresolverr.example',
        wikiUrl: '',
      },
    ]);
  });
});
