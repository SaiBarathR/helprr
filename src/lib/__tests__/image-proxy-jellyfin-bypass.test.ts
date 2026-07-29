import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findMany: vi.fn(),
  fetchImageWithServerCache: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findMany: mocks.findMany } },
}));
vi.mock('@/lib/cache/image-cache', () => ({
  fetchImageWithServerCache: mocks.fetchImageWithServerCache,
}));
vi.mock('@/lib/service-connection-secrets', () => ({
  getConnectionHeaders: vi.fn(),
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { GET } from '@/app/api/image/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    ok: true,
    user: { id: 'user-1' },
    session: {},
  });
});

describe('generic image proxy Jellyfin bypass prevention', () => {
  it.each([
    'http://jellyfin.internal:8096/Items/abc123/Images/Primary',
    'https://media.example.com/jellyfin/Items/abc123/Images/Backdrop/0',
  ])('rejects Jellyfin image paths before connection or cache work: %s', async (src) => {
    const url = new URL('http://helprr.local/api/image');
    url.searchParams.set('src', src);
    url.searchParams.set('service', 'jellyfin');

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.fetchImageWithServerCache).not.toHaveBeenCalled();
  });
});
