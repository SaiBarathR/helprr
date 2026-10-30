import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  prowlarr: { getIndexers: vi.fn(), getHistory: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'member-1', role: 'member' }, session: {} })),
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getProwlarrClient: vi.fn(async () => mocks.prowlarr),
}));

import * as indexersRoute from '@/app/api/prowlarr/indexers/route';
import { GET as historyGet } from '@/app/api/prowlarr/history/route';

const SECRET = 'S3cretIndexerKey0123456789abcdef';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/prowlarr/indexers', () => {
  it('returns only the summary, never the settings fields', async () => {
    mocks.prowlarr.getIndexers.mockResolvedValue([
      {
        id: 16,
        name: 'nekoBT',
        enable: true,
        protocol: 'torrent',
        privacy: 'public',
        priority: 25,
        implementationName: 'Cardigann',
        implementation: 'Cardigann',
        configContract: 'CardigannSettings',
        tags: [2],
        appProfileId: 1,
        indexerUrls: [`https://nekobt.example/?apikey=${SECRET}`],
        fields: [{ name: 'apikey', privacy: 'normal', value: SECRET }],
      },
    ]);

    const res = await indexersRoute.GET();
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual([
      {
        id: 16,
        name: 'nekoBT',
        enable: true,
        protocol: 'torrent',
        privacy: 'public',
        priority: 25,
        implementationName: 'Cardigann',
        tags: [2],
        appProfileId: 1,
      },
    ]);
  });

  it('no longer accepts POST (the unused add-indexer handler is gone)', () => {
    expect('POST' in indexersRoute).toBe(false);
  });
});

describe('GET /api/prowlarr/history', () => {
  it('removes credentials from record data before it leaves the server', async () => {
    mocks.prowlarr.getHistory.mockResolvedValue({
      page: 1,
      pageSize: 50,
      totalRecords: 3,
      records: [
        {
          id: 1,
          indexerId: 16,
          eventType: 'indexerRss',
          successful: true,
          date: '2026-10-30T00:00:00Z',
          data: { url: `https://nekobt.example/api?t=search&apikey=${SECRET}&limit=100`, host: 'sonarr', elapsedTime: '120' },
        },
        {
          id: 2,
          indexerId: 3,
          eventType: 'releaseGrabbed',
          successful: true,
          date: '2026-10-30T00:00:00Z',
          data: {
            url: `http://prowlarr:9696/3/download?apikey=${SECRET}&link=abc`,
            downloadUrl: `https://tracker.example/download.php?id=9&passkey=${SECRET}`,
            magnetUrl: `magnet:?xt=urn:btih:abc&tr=https://tracker.example/announce?pid=${SECRET}`,
            source: `https://user:${SECRET}@tracker.example/rss`,
            title: 'Big Buck Bunny 1080p',
          },
        },
        { id: 3, indexerId: 4, eventType: 'indexerQuery', successful: false, date: '2026-10-30T00:00:00Z' },
      ],
    });

    const res = await historyGet(new NextRequest('http://localhost/api/prowlarr/history?page=1&pageSize=50'));
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(body.totalRecords).toBe(3);
    expect(body.records[0].data.url).toBe('https://nekobt.example/api?t=search&apikey=[REDACTED]&limit=100');
    expect(body.records[0].data.host).toBe('sonarr');
    expect(body.records[1].data.title).toBe('Big Buck Bunny 1080p');
    expect(body.records[2]).not.toHaveProperty('data');
  });
});
