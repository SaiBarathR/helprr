import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: {} as Record<string, boolean>,
  connections: new Set<string>(),
  handler: vi.fn(async () => ({ results: [] })),
}));
vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ ok: true, user: { role: 'member', template: 'custom', permissions: null } }) }));
vi.mock('@/lib/permissions', () => ({ can: (_user: unknown, cap: string) => mocks.caps[cap] === true }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { count: async ({ where }: { where: { type: string } }) => (mocks.connections.has(where.type) ? 1 : 0) } },
}));
vi.mock('@/lib/search/providers/registry', () => ({ getProviderHandler: () => mocks.handler }));

import { GET } from './route';

const search = (provider: string) =>
  GET(new NextRequest(`http://localhost/api/search/providers/${provider}?q=pluribus`), { params: Promise.resolve({ provider }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connections = new Set(['TMDB', 'SEERR']);
});

describe('GET /api/search/providers/[provider]', () => {
  it('lets a member who can request and open title pages search TMDB without Discover', async () => {
    mocks.caps = { 'requests.create': true, 'series.view': true };
    expect((await search('tmdb')).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalled();
  });

  it('lets a Discover holder search TMDB on an install without Seerr', async () => {
    mocks.caps = { 'discover.view': true };
    mocks.connections = new Set(['TMDB']);
    expect((await search('tmdb')).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalled();
  });

  it('refuses that member when Seerr is not connected, and anyone who cannot request', async () => {
    mocks.caps = { 'requests.create': true, 'series.view': true };
    mocks.connections = new Set(['TMDB']);
    expect((await search('tmdb')).status).toBe(403);

    mocks.connections = new Set(['TMDB', 'SEERR']);
    mocks.caps = { 'series.view': true };
    expect((await search('tmdb')).status).toBe(403);
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it('opens no other provider to a requester', async () => {
    mocks.caps = { 'requests.create': true, 'series.view': true };
    expect((await search('anilist')).status).toBe(403);
  });
});
