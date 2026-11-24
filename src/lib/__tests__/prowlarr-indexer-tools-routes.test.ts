import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Bulk delete, indexer proxies and the command status the Prowlarr page uses:
 * capability first, input refused before Prowlarr is called, and nothing of a
 * proxy's settings (host, login) in any answer.
 */
const mocks = vi.hoisted(() => ({
  prowlarr: {
    getIndexers: vi.fn(),
    deleteIndexers: vi.fn(),
    getIndexerProxies: vi.fn(),
    testIndexerProxy: vi.fn(),
    testAllIndexerProxies: vi.fn(),
    getCommand: vi.fn(),
  },
  requireUserCapability: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: vi.fn(async () => mocks.prowlarr) }));

import { DELETE as bulkDelete } from '@/app/api/prowlarr/indexers/bulk/route';
import { GET as proxiesGet } from '@/app/api/prowlarr/indexerproxies/route';
import { POST as proxyTest } from '@/app/api/prowlarr/indexerproxies/[id]/test/route';
import { POST as proxyTestAll } from '@/app/api/prowlarr/indexerproxies/testall/route';
import { GET as commandGet } from '@/app/api/prowlarr/command/[id]/route';

const forbidden = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
const upstream = () => Object.values(mocks.prowlarr);
const expectNoUpstreamCall = () => {
  for (const fn of upstream()) expect(fn).not.toHaveBeenCalled();
};

const del = (body: unknown) => bulkDelete(new NextRequest('http://localhost/api/prowlarr/indexers/bulk', {
  method: 'DELETE',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));

const indexer = (id: number, name: string, tags: number[] = []) => ({
  id, name, tags, enable: true, protocol: 'torrent', privacy: 'public', priority: 25,
  fields: [{ name: 'apiKey', value: 'indexer-secret' }],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'admin-1', role: 'admin' }, session: {} });
  mocks.prowlarr.deleteIndexers.mockResolvedValue(undefined);
});

describe('DELETE /api/prowlarr/indexers/bulk', () => {
  it('needs prowlarr.manage and calls nothing without it', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());

    const res = await del({ ids: [1] });

    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expectNoUpstreamCall();
  });

  it.each([
    ['not JSON', '{'],
    ['no ids', {}],
    ['an empty list', { ids: [] }],
    ['a zero id', { ids: [0] }],
    ['a negative id', { ids: [3, -1] }],
    ['a fractional id', { ids: [1.5] }],
    ['a string id', { ids: ['3'] }],
    ['another field', { ids: [3], deleteFiles: true }],
    ['too many ids', { ids: Array.from({ length: 201 }, (_, i) => i + 1) }],
    ['an array body', [3]],
  ])('refuses %s before calling Prowlarr', async (_label, body) => {
    const res = await del(body);

    expect(res.status).toBe(400);
    expectNoUpstreamCall();
  });

  it('refuses ids Prowlarr does not have, and deletes nothing', async () => {
    mocks.prowlarr.getIndexers.mockResolvedValue([indexer(1, 'A'), indexer(2, 'B')]);

    const res = await del({ ids: [1, 99] });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'That indexer no longer exists', unknownIds: [99] });
    expect(mocks.prowlarr.deleteIndexers).not.toHaveBeenCalled();
  });

  it('deletes the de-duplicated ids and reports each one from the list read again', async () => {
    mocks.prowlarr.getIndexers
      .mockResolvedValueOnce([indexer(1, 'A'), indexer(2, 'B'), indexer(3, 'C')])
      .mockResolvedValueOnce([indexer(3, 'C')]);

    const res = await del({ ids: [1, 2, 2] });

    expect(res.status).toBe(200);
    expect(mocks.prowlarr.deleteIndexers).toHaveBeenCalledWith([1, 2]);
    expect(await res.json()).toEqual({ deleted: [1, 2], failed: [] });
  });

  it('reports a partial delete truthfully when Prowlarr answers with an error', async () => {
    mocks.prowlarr.getIndexers
      .mockResolvedValueOnce([indexer(1, 'A'), indexer(2, 'B')])
      .mockResolvedValueOnce([indexer(2, 'B')]);
    mocks.prowlarr.deleteIndexers.mockRejectedValue(new Error('Request failed with status code 500'));

    const res = await del({ ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: [1], failed: [2] });
  });

  it('is a plain failure when nothing went', async () => {
    mocks.prowlarr.getIndexers.mockResolvedValue([indexer(1, 'A')]);
    mocks.prowlarr.deleteIndexers.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:9696'));

    const res = await del({ ids: [1] });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to delete indexers' });
  });

  it('trusts Prowlarr’s success when the list cannot be read again', async () => {
    mocks.prowlarr.getIndexers
      .mockResolvedValueOnce([indexer(1, 'A')])
      .mockRejectedValueOnce(new Error('timeout'));

    const res = await del({ ids: [1] });

    expect(await res.json()).toEqual({ deleted: [1], failed: [] });
  });
});

const PROXY_SECRET = 'proxy-password-123';
const proxy = (id: number, name: string, tags: number[]) => ({
  id, name, tags, implementation: 'FlareSolverr', implementationName: 'FlareSolverr', configContract: 'FlareSolverrSettings',
  onHealthIssue: false, includeHealthWarnings: false,
  fields: [{ name: 'host', value: 'http://10.0.0.9:8191/' }, { name: 'username', value: 'me' }, { name: 'password', value: PROXY_SECRET }],
});

describe('GET /api/prowlarr/indexerproxies', () => {
  it('needs prowlarr.view', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());

    expect((await proxiesGet()).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.view');
    expectNoUpstreamCall();
  });

  it('sends name, type, tags and the indexers sharing a tag, and no settings', async () => {
    mocks.prowlarr.getIndexerProxies.mockResolvedValue([proxy(1, 'FlareSolverr', [5]), proxy(2, 'Spare', [])]);
    mocks.prowlarr.getIndexers.mockResolvedValue([indexer(10, '1337x', [5, 6]), indexer(11, 'YTS'), indexer(12, 'EZTV', [6])]);

    const res = await proxiesGet();
    const text = await res.text();

    expect(text).not.toMatch(/fields|host|8191|10\.0\.0\.9|password|username|indexer-secret|configContract/);
    expect(text).not.toContain(PROXY_SECRET);
    expect(JSON.parse(text)).toEqual([
      { id: 1, name: 'FlareSolverr', implementation: 'FlareSolverr', implementationName: 'FlareSolverr', tags: [5], indexers: [{ id: 10, name: '1337x' }] },
      { id: 2, name: 'Spare', implementation: 'FlareSolverr', implementationName: 'FlareSolverr', tags: [], indexers: [] },
    ]);
  });
});

describe('POST /api/prowlarr/indexerproxies/[id]/test', () => {
  const test = (id: string) => proxyTest(
    new NextRequest(`http://localhost/api/prowlarr/indexerproxies/${id}/test`, { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  );

  it('needs prowlarr.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());

    expect((await test('1')).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expectNoUpstreamCall();
  });

  it.each(['0', 'abc', '-1', '1.5', '12345678901'])('refuses id %j', async (id) => {
    expect((await test(id)).status).toBe(400);
    expectNoUpstreamCall();
  });

  it('passes with a fixed answer', async () => {
    mocks.prowlarr.testIndexerProxy.mockResolvedValue(undefined);

    const res = await test('1');

    expect(mocks.prowlarr.testIndexerProxy).toHaveBeenCalledWith(1);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('fails without Prowlarr’s text, which can name the host', async () => {
    mocks.prowlarr.testIndexerProxy.mockRejectedValue(new Error('Unable to reach 10.0.0.9:8191'));

    const res = await test('1');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Test failed' });
  });
});

describe('POST /api/prowlarr/indexerproxies/testall', () => {
  it('needs prowlarr.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());

    expect((await proxyTestAll()).status).toBe(403);
    expectNoUpstreamCall();
  });

  it('passes on pass or fail per proxy only', async () => {
    mocks.prowlarr.testAllIndexerProxies.mockResolvedValue({
      passed: 1, failed: 1, hasFailures: true,
      results: [
        { id: 1, isValid: true, validationFailures: [] },
        { id: 2, isValid: false, validationFailures: [{ propertyName: 'Host', errorMessage: 'Unable to reach http://10.0.0.9:8191', severity: 'error' }] },
      ],
    });

    const res = await proxyTestAll();
    const text = await res.text();

    expect(text).not.toMatch(/10\.0\.0\.9|8191|Unable/);
    expect(JSON.parse(text)).toEqual({
      passed: 1, failed: 1, hasFailures: true,
      results: [{ id: 1, isValid: true, validationFailures: [] }, { id: 2, isValid: false, validationFailures: [] }],
    });
  });
});

describe('GET /api/prowlarr/command/[id]', () => {
  const get = (id: string) => commandGet(
    new NextRequest(`http://localhost/api/prowlarr/command/${id}`),
    { params: Promise.resolve({ id }) },
  );

  it('needs prowlarr.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());

    expect((await get('5')).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expectNoUpstreamCall();
  });

  it.each(['0', 'x', '-2', '1e3'])('refuses id %j', async (id) => {
    expect((await get(id)).status).toBe(400);
    expectNoUpstreamCall();
  });

  it('passes on only the id, name and status', async () => {
    mocks.prowlarr.getCommand.mockResolvedValue({
      id: 5, name: 'CheckHealth', commandName: 'Check Health', status: 'completed',
      body: { path: '/config/secret' }, message: 'Completed on http://10.0.0.9',
    });

    const res = await get('5');

    expect(mocks.prowlarr.getCommand).toHaveBeenCalledWith(5);
    expect(await res.json()).toEqual({ id: 5, name: 'CheckHealth', status: 'completed' });
  });
});
