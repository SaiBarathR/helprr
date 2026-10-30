import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  prowlarr: { getIndexers: vi.fn(), getHistory: vi.fn(), testAllIndexers: vi.fn() },
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
import { POST as testAllPost } from '@/app/api/prowlarr/indexers/testall/route';

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
        capabilities: { categories: [{ id: 2000, name: 'Movies' }, { id: 5000, name: 'TV' }], limitsMax: 100 },
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
        categories: ['Movies', 'TV'],
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
      totalRecords: 4,
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
        {
          id: 4,
          indexerId: 5,
          eventType: 'indexerQuery',
          successful: true,
          date: '2026-10-30T00:00:00Z',
          data: {
            url: `https://beyond-hd.example/api/torrents/${SECRET}`,
            infoUrl: `https://tracker.example/rss.php?rsskey=${SECRET}`,
            query: 'big buck bunny',
          },
        },
      ],
    });

    const res = await historyGet(new NextRequest('http://localhost/api/prowlarr/history?page=1&pageSize=50'));
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(body.totalRecords).toBe(4);
    expect(body.records[0].data.url).toBe('https://nekobt.example');
    expect(body.records[1].data.url).toBe('http://prowlarr:9696');
    expect(body.records[1].data.magnetUrl).toBe('magnet:[REDACTED]');
    expect(body.records[3].data).toEqual({
      url: 'https://beyond-hd.example',
      infoUrl: 'https://tracker.example',
      query: 'big buck bunny',
    });
    expect(body.records[0].data.host).toBe('sonarr');
    expect(body.records[1].data.title).toBe('Big Buck Bunny 1080p');
    expect(body.records[2]).not.toHaveProperty('data');
  });
});

describe('POST /api/prowlarr/indexers/testall', () => {
  it('passes on only the known result fields, with URLs in failure messages cut to their origin', async () => {
    mocks.prowlarr.testAllIndexers.mockResolvedValue({
      passed: 0,
      failed: 1,
      hasFailures: true,
      results: [{
        id: 5,
        isValid: false,
        settings: { apiKey: SECRET },
        validationFailures: [{
          propertyName: '',
          errorMessage: `Unable to connect to indexer: HTTP request failed: [503:ServiceUnavailable] [GET] at [https://beyond-hd.example/api/torrents/${SECRET}]`,
          severity: 'error',
          attemptedValue: SECRET,
        }],
      }],
    });

    const res = await testAllPost();
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text).results).toEqual([{
      id: 5,
      isValid: false,
      validationFailures: [{
        propertyName: '',
        errorMessage: 'Unable to connect to indexer: HTTP request failed: [503:ServiceUnavailable] [GET] at [https://beyond-hd.example]',
        severity: 'error',
      }],
    }]);
  });
});
