import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prowlarr's proxied download link carries its API key, so the Arr clients drop
// release and history download links as they arrive (no route can pass them on).

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({ default: { create: mocks.create.mockImplementation(() => ({ get: mocks.get })) } }));

import { historyPageWithoutLinks, pageLinkWithoutKeys, withoutHistoryLinks, withoutReleaseLinks } from '@/lib/arr-release-links';
import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
// As Sonarr returns a Prowlarr-indexed release (trimmed).
const release = () => ({
  guid: 'https://tracker.example/details/42',
  indexerId: 8,
  indexer: 'Example (Prowlarr)',
  title: 'Show S01E03 1080p WEB H264-GRP',
  infoUrl: 'https://tracker.example/details/42',
  commentUrl: 'https://tracker.example/details/42#comments',
  downloadUrl: `http://prowlarr.local:9696/11/download?apikey=${KEY}&link=abc&file=Show`,
  magnetUrl: 'magnet:?xt=urn:btih:ABC&tr=https%3A%2F%2Ftracker.example%2Fannounce%2Fpasskey123',
  downloadAllowed: true,
});
// As Sonarr returns a grabbed history record (trimmed).
const historyRecord = () => ({
  id: 7,
  eventType: 'grabbed',
  sourceTitle: 'Show S01E03 1080p WEB H264-GRP',
  downloadId: 'ABCDEF',
  data: {
    indexer: 'Example (Prowlarr)',
    releaseGroup: 'GRP',
    nzbInfoUrl: 'https://tracker.example/details/42',
    downloadClient: 'qBittorrent',
    guid: `https://tracker.example/download/42?passkey=${KEY}`,
    downloadUrl: `http://prowlarr.local:9696/11/download?apikey=${KEY}&link=abc`,
  },
});
const page = () => ({ page: 1, pageSize: 20, sortKey: 'date', sortDirection: 'descending', totalRecords: 1, records: [historyRecord()] });

function expectClean(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(KEY);
  expect(JSON.stringify(value)).not.toContain('passkey123');
}
const keptRelease = { guid: 'https://tracker.example/details/42', indexerId: 8, infoUrl: 'https://tracker.example/details/42', downloadAllowed: true };
const keptData = { indexer: 'Example (Prowlarr)', releaseGroup: 'GRP', nzbInfoUrl: 'https://tracker.example/details/42', downloadClient: 'qBittorrent' };

beforeEach(() => mocks.get.mockReset());

describe('Arr clients drop release and history download links', () => {
  const cases = [
    ['Sonarr search', () => new SonarrClient('http://s', 'k').getReleases({ episodeId: 1 }), () => [release()]],
    ['Radarr search', () => new RadarrClient('http://r', 'k').getReleases(5), () => [release()]],
    ['Lidarr search', () => new LidarrClient('http://l', 'k').getReleases({ albumId: 2 }), () => [release()]],
  ] as const;
  it.each(cases)('%s', async (_name, call, payload) => {
    mocks.get.mockResolvedValue({ data: payload() });
    const [r] = await call() as unknown as Record<string, unknown>[];
    expectClean(r);
    expect(r).not.toHaveProperty('downloadUrl');
    expect(r).not.toHaveProperty('magnetUrl');
    expect(r).toMatchObject(keptRelease);
  });

  const historyCases = [
    ['Sonarr history', () => new SonarrClient('http://s', 'k').getHistory(), page, (r: { records: unknown[] }) => r.records],
    ['Sonarr series history', () => new SonarrClient('http://s', 'k').getSeriesHistory(3), () => [historyRecord()], (r: unknown[]) => r],
    ['Radarr history', () => new RadarrClient('http://r', 'k').getHistory(), page, (r: { records: unknown[] }) => r.records],
    ['Radarr movie history', () => new RadarrClient('http://r', 'k').getMovieHistory(5), () => [historyRecord()], (r: unknown[]) => r],
    ['Lidarr history', () => new LidarrClient('http://l', 'k').getHistory(), page, (r: { records: unknown[] }) => r.records],
    ['Lidarr artist history', () => new LidarrClient('http://l', 'k').getArtistHistory(4), () => [historyRecord()], (r: unknown[]) => r],
  ] as const;
  it.each(historyCases)('%s', async (_name, call, payload, recordsOf) => {
    mocks.get.mockResolvedValue({ data: payload() });
    const result = await call();
    const [record] = (recordsOf as (r: unknown) => Record<string, unknown>[])(result);
    expectClean(result);
    expect(record.data).toEqual(keptData);
    expect(record).toMatchObject({ id: 7, eventType: 'grabbed', downloadId: 'ABCDEF' });
  });

  it('keeps the page around the records', async () => {
    mocks.get.mockResolvedValue({ data: page() });
    expect(await new SonarrClient('http://s', 'k').getHistory()).toMatchObject({ page: 1, totalRecords: 1 });
  });
});

describe('the strip helpers', () => {
  it('leave a non-list answer (a misconfigured *arr) for the caller to handle', () => {
    const html = '<html>' as unknown as object[];
    expect(withoutReleaseLinks(html)).toBe(html);
    expect(withoutHistoryLinks(html as unknown as { data?: unknown }[])).toBe(html);
    expect(historyPageWithoutLinks({ records: null } as unknown as { records: [] })).toEqual({ records: null });
  });

  it('keep records with no data object as they are', () => {
    const records = [{ id: 1 }, { id: 2, data: null }, null] as unknown as { data?: unknown }[];
    expect(withoutHistoryLinks(records)).toEqual(records);
  });

  it('do not change what they were given', () => {
    const input = [release()];
    withoutReleaseLinks(input);
    expect(input[0].downloadUrl).toContain(KEY);
  });
});

describe('indexer page links keep working without keys', () => {
  it('drop key-named query parameters and user info, and keep the rest', () => {
    expect(pageLinkWithoutKeys(`https://tracker.example/details.php?id=42&passkey=${KEY}&hit=1`)).toBe('https://tracker.example/details.php?id=42&hit=1');
    expect(pageLinkWithoutKeys(`https://u:${KEY}@tracker.example/t/42?apikey=${KEY}&api_key=${KEY}&API-KEY=${KEY}`)).toBe('https://tracker.example/t/42');
    expect(pageLinkWithoutKeys(`http://indexer.example/api?t=details&id=9&authkey=${KEY}&torrent_pass=${KEY}&rsskey=${KEY}&token=${KEY}&secret=${KEY}&password=${KEY}&sid=${KEY}`))
      .toBe('http://indexer.example/api?t=details&id=9');
    expect(pageLinkWithoutKeys('https://tracker.example/details/42#comments')).toBe('https://tracker.example/details/42#comments');
  });

  it.each([
    ['a ;-separated key', `https://t.example/d?id=1;passkey=${KEY}`, 'https://t.example/d'],
    ['a key with []', `https://t.example/d?id=1&passkey[]=${KEY}`, 'https://t.example/d?id=1'],
    ['an encoded name', `https://t.example/d?id=1&pass%6Bey=${KEY}`, 'https://t.example/d?id=1'],
    ['a name with a space', `https://t.example/d?id=1&%20passkey=${KEY}`, 'https://t.example/d?id=1'],
    ['a name with a NUL', `https://t.example/d?id=1&passkey%00=${KEY}`, 'https://t.example/d?id=1'],
    ['other key names', `https://t.example/d?id=1&rss_key=${KEY}&api_token=${KEY}&access_token=${KEY}&auth_key=${KEY}&key=${KEY}&pid=${KEY}&sig=${KEY}&signature=${KEY}&pass-key=${KEY}`, 'https://t.example/d?id=1'],
    ['a fragment with a value', `https://t.example/d?id=1#passkey=${KEY}`, 'https://t.example/d?id=1'],
    ['the rest kept as written', `https://t.example/d?q=a%20b~c/d&flag&passkey=${KEY}&x=1+2`, 'https://t.example/d?q=a%20b~c/d&flag&x=1+2'],
  ])('drop %s', (_label, link, kept) => {
    expect(pageLinkWithoutKeys(link)).toBe(kept);
  });

  it('leave a link with no key exactly as it was', () => {
    for (const link of ['https://t.example/d?q=a%20b~c/d&flag&x=1+2', 'https://t.example/details/42#comments', 'https://t.example/d?id=1&&p=2']) {
      expect(pageLinkWithoutKeys(link)).toBe(link);
    }
  });

  it('drop what is not an http(s) link', () => {
    for (const value of ['magnet:?xt=urn:btih:ABC', 'javascript:alert(1)', 'not a link', '', 42, null, undefined]) {
      expect(pageLinkWithoutKeys(value)).toBeNull();
    }
  });

  it('apply to search results and history as they arrive', async () => {
    mocks.get.mockResolvedValue({ data: [{ ...release(), infoUrl: `https://tracker.example/details.php?id=42&passkey=${KEY}`, commentUrl: 'javascript:alert(1)' }] });
    const [r] = await new SonarrClient('http://s', 'k').getReleases({ episodeId: 1 }) as unknown as Record<string, unknown>[];
    expect(r.infoUrl).toBe('https://tracker.example/details.php?id=42');
    expect(r).not.toHaveProperty('commentUrl');
    expectClean(r);

    const record = { ...historyRecord(), data: { ...historyRecord().data, nzbInfoUrl: `https://indexer.example/details/42?apikey=${KEY}` } };
    mocks.get.mockResolvedValue({ data: [record] });
    const [h] = await new RadarrClient('http://r', 'k').getMovieHistory(5) as unknown as { data: Record<string, unknown> }[];
    expect(h.data.nzbInfoUrl).toBe('https://indexer.example/details/42');
    expectClean(h);
  });
});
