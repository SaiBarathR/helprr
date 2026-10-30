import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  prowlarr: { getApplications: vi.fn(), testApplication: vi.fn(), testAllApplications: vi.fn() },
  requireUserCapability: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: vi.fn(async () => mocks.prowlarr) }));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findMany: mocks.findMany } } }));

import { GET as listGet } from '@/app/api/prowlarr/applications/route';
import { POST as testPost } from '@/app/api/prowlarr/applications/[id]/test/route';
import { POST as testAllPost } from '@/app/api/prowlarr/applications/testall/route';

const SECRET = 'arr-api-key-0123456789';
const test = (id: string) => testPost(
  new NextRequest(`http://localhost/api/prowlarr/applications/${id}/test`, { method: 'POST' }),
  { params: Promise.resolve({ id }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'u1', role: 'admin' }, session: {} });
  mocks.prowlarr.getApplications.mockResolvedValue([{
    id: 1, name: 'Sonarr', implementation: 'Sonarr', implementationName: 'Sonarr', syncLevel: 'fullSync', enable: true,
    fields: [{ name: 'baseUrl', value: 'http://sonarr:8989' }, { name: 'apiKey', value: SECRET }],
  }]);
  mocks.findMany.mockResolvedValue([
    { type: 'SONARR', url: 'http://100.1.1.1:8989', label: 'Sonarr' },
    { type: 'RADARR', url: 'http://internal.example:7878', label: 'Radarr' },
  ]);
});

describe('GET /api/prowlarr/applications', () => {
  it('sends no settings or addresses, and names the arr with no app', async () => {
    const res = await listGet();
    const text = await res.text();

    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.view');
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/8989|7878|internal\.example|fields/);
    expect(JSON.parse(text)).toEqual({
      applications: [{ id: 1, name: 'Sonarr', implementationName: 'Sonarr', syncLevel: 'fullSync', enable: true }],
      unsynced: [{ type: 'RADARR', label: 'Radarr' }],
    });
  });
});

describe('POST /api/prowlarr/applications/[id]/test', () => {
  it('needs prowlarr.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });

    expect((await test('1')).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expect(mocks.prowlarr.testApplication).not.toHaveBeenCalled();
  });

  it.each(['0', 'abc', '-1', '1.5'])('rejects id %j', async (id) => {
    expect((await test(id)).status).toBe(400);
    expect(mocks.prowlarr.testApplication).not.toHaveBeenCalled();
  });

  it('hides failure detail', async () => {
    mocks.prowlarr.testApplication.mockRejectedValue(new Error('Unable to reach http://internal.example:8989'));

    const res = await test('1');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Test failed' });
  });
});

describe('POST /api/prowlarr/applications/testall', () => {
  it('passes on only known result fields, with URLs cut', async () => {
    mocks.prowlarr.testAllApplications.mockResolvedValue({
      passed: 0, failed: 1, hasFailures: true,
      results: [{ id: 1, isValid: false, validationFailures: [{ propertyName: 'BaseUrl', errorMessage: `Failed at http://sonarr:8989/api?apikey=${SECRET}`, severity: 'error', attemptedValue: SECRET }] }],
    });

    const text = await (await testAllPost()).text();

    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expect(text).not.toContain(SECRET);
  });
});
