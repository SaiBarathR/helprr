import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => null),
  requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'member-1' }, session: {} })),
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  loadTaggedLibrary: vi.fn(async () => ({ movies: [], series: [] })),
}));
vi.mock('@/lib/anilist-client', () => ({
  getAnimeAiringSchedule: vi.fn(async () => []),
}));
vi.mock('@/lib/anilist-series-mapping', () => ({
  loadLibraryLinksForAnilistIds: vi.fn(async () => new Map()),
}));

import { GET } from '@/app/api/anime/schedule/route';

describe('GET /api/anime/schedule headers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the library-annotated schedule private to the session that asked', async () => {
    const res = await GET(new NextRequest(
      'http://localhost/api/anime/schedule?weekStart=1760000000&weekEnd=1760600000',
    ));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/^private,/);
    expect(res.headers.get('vary')).toContain('Cookie');
  });
});
