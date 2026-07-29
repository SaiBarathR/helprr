import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  findMany: vi.fn(),
  fetchImageWithServerCache: vi.fn(),
  getConnectionHeaders: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: {
      findMany: mocks.findMany,
    },
  },
}));
vi.mock('@/lib/cache/image-cache', () => ({
  fetchImageWithServerCache: mocks.fetchImageWithServerCache,
}));
vi.mock('@/lib/service-connection-secrets', () => ({
  getConnectionHeaders: mocks.getConnectionHeaders,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { GET } from '@/app/api/image/route';

const connections = [
  {
    type: 'LIDARR',
    url: 'http://lidarr.internal:8686',
    apiKey: 'lidarr-api-key',
    customHeaders: null,
  },
  {
    type: 'LIDARR',
    url: 'https://media.example.com/lidarr',
    apiKey: 'proxied-lidarr-api-key',
    customHeaders: { 'X-Proxy-Token': 'proxy-token' },
  },
  {
    type: 'RADARR',
    url: 'http://radarr.internal:7878',
    apiKey: 'radarr-api-key',
    customHeaders: null,
  },
];

function imageRequest(src: string, service: 'lidarr' | 'radarr' = 'lidarr'): NextRequest {
  const url = new URL('http://helprr.local/api/image');
  url.searchParams.set('src', src);
  url.searchParams.set('service', service);
  return new NextRequest(url);
}

function lastUpstreamOptions(): {
  upstreamUrl: string;
  upstreamHeaders?: Record<string, string>;
  timeoutMs?: number;
} {
  const call = mocks.fetchImageWithServerCache.mock.lastCall;
  if (!call) throw new Error('Image cache fetch was not called');
  return call[0];
}

describe('Lidarr image proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue(connections);
    mocks.getConnectionHeaders.mockImplementation(
      (connection: { customHeaders: Record<string, string> | null }) =>
        connection.customHeaders ?? {},
    );
    mocks.fetchImageWithServerCache.mockResolvedValue({
      status: 200,
      body: Buffer.from('image'),
      contentType: 'image/jpeg',
      cacheStatus: 'MISS',
    });
  });

  it('fetches a local artist image through Lidarr authenticated API', async () => {
    const response = await GET(imageRequest(
      'http://lidarr.internal:8686/MediaCover/4/poster.jpg?lastWrite=123',
    ));

    expect(response.status).toBe(200);
    expect(lastUpstreamOptions()).toMatchObject({
      upstreamUrl:
        'http://lidarr.internal:8686/api/v1/mediacover/artist/4/poster.jpg?lastWrite=123',
      upstreamHeaders: { 'X-Api-Key': 'lidarr-api-key' },
      timeoutMs: 20_000,
    });
  });

  it('fetches a local album cover through Lidarr authenticated API', async () => {
    await GET(imageRequest(
      'http://lidarr.internal:8686/MediaCover/Albums/7/cover.jpg?lastWrite=456',
    ));

    expect(lastUpstreamOptions()).toMatchObject({
      upstreamUrl:
        'http://lidarr.internal:8686/api/v1/mediacover/album/7/cover.jpg?lastWrite=456',
      upstreamHeaders: { 'X-Api-Key': 'lidarr-api-key' },
      timeoutMs: 20_000,
    });
  });

  it('preserves the URL base and custom headers for proxied Lidarr', async () => {
    await GET(imageRequest(
      'https://media.example.com/lidarr/MediaCover/11/poster.png?lastWrite=789',
    ));

    expect(lastUpstreamOptions()).toMatchObject({
      upstreamUrl:
        'https://media.example.com/lidarr/api/v1/mediacover/artist/11/poster.png?lastWrite=789',
      upstreamHeaders: {
        'X-Proxy-Token': 'proxy-token',
        'X-Api-Key': 'proxied-lidarr-api-key',
      },
      timeoutMs: 20_000,
    });
  });

  it('leaves external Lidarr CDN images unchanged and unauthenticated', async () => {
    const src = 'https://images.lidarr.audio/cover/artist.jpg';

    await GET(imageRequest(src));

    expect(lastUpstreamOptions()).toMatchObject({
      upstreamUrl: src,
      upstreamHeaders: undefined,
      timeoutMs: undefined,
    });
  });

  it('does not change existing Radarr media-cover behavior', async () => {
    const src = 'http://radarr.internal:7878/MediaCover/3/poster.jpg?lastWrite=321';

    await GET(imageRequest(src, 'radarr'));

    expect(lastUpstreamOptions()).toMatchObject({
      upstreamUrl: src,
      upstreamHeaders: { 'X-Api-Key': 'radarr-api-key' },
      timeoutMs: undefined,
    });
  });
});
