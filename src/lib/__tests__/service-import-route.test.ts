import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), discover: vi.fn(), importServices: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-import', () => ({ discoverImportCandidates: mocks.discover, importServices: mocks.importServices }));

import { GET, POST } from '@/app/api/services/import/route';

const post = (body: unknown) =>
  POST(new NextRequest('http://helprr.test/api/services/import', { method: 'POST', body: JSON.stringify(body) }));

describe('/api/services/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: 'admin-1', role: 'admin' }, session: { id: 's' } });
    mocks.discover.mockResolvedValue({ candidates: [], sources: { seerr: 'missing', prowlarr: 'missing' } });
    mocks.importServices.mockResolvedValue([]);
  });

  it('refuses a member before reading or adding anything', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await GET()).status).toBe(403);
    expect((await post({ items: [{ id: 'prowlarr:1' }] })).status).toBe(403);
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.importServices).not.toHaveBeenCalled();
  });

  it('lists what it found, uncached', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('passes the chosen apps on', async () => {
    const items = [{ id: 'seerr:sonarr:0' }, { id: 'prowlarr:5', url: 'http://nas:8990', apiKey: 'k', label: 'Anime' }];
    expect((await post({ items })).status).toBe(200);
    expect(mocks.importServices).toHaveBeenCalledWith(items);
  });

  it.each([
    ['no items', { items: [] }],
    ['too many', { items: Array.from({ length: 21 }, (_, i) => ({ id: `prowlarr:${i}` })) }],
    ['an item without an id', { items: [{ url: 'http://x' }] }],
    ['a key that is not text', { items: [{ id: 'prowlarr:1', apiKey: 42 }] }],
    ['no body', null],
  ])('refuses %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.importServices).not.toHaveBeenCalled();
  });
});
