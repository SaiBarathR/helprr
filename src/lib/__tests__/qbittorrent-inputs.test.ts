import { describe, expect, it, vi } from 'vitest';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { isInsideDownloadRoots, parseLocation, parseTags } from '@/lib/qbittorrent-inputs';

describe('parseLocation', () => {
  it('trims a usable folder', () => {
    expect(parseLocation('  /downloads/movies  ')).toBe('/downloads/movies');
  });

  it.each([
    ['not a string', 42],
    ['empty', '   '],
    ['too long', `/${'a'.repeat(4096)}`],
    ['a NUL byte', '/downloads/\u0000x'],
    ['a newline', '/downloads/\nx'],
  ])('refuses %s', (_label, value) => {
    expect(parseLocation(value)).toBeNull();
  });
});

describe('parseTags', () => {
  it('trims and deduplicates', () => {
    expect(parseTags([' 4k ', '4k', 'movies'])).toEqual(['4k', 'movies']);
  });

  it.each([
    ['no list', 'movies'],
    // removeTags with no tags would take every tag off the torrent.
    ['an empty list', []],
    ['an empty name', ['  ']],
    ['a comma, which qBittorrent splits on', ['a,b']],
    ['a non-string', [1]],
    ['a NUL byte', ['a\u0000']],
    ['a name over 100 characters', ['x'.repeat(101)]],
    ['more than 50 tags', Array.from({ length: 51 }, (_, i) => `t${i}`)],
  ])('refuses %s', (_label, value) => {
    expect(parseTags(value)).toBeNull();
  });
});

describe('isInsideDownloadRoots', () => {
  const client = {
    getDefaultSavePath: vi.fn().mockResolvedValue('/downloads/'),
    getCategories: vi.fn().mockResolvedValue({ tv: { name: 'tv', savePath: '/media/tv' }, none: { name: 'none', savePath: '' } }),
  } as unknown as QBittorrentClient;

  it('accepts the default save path, a category path, and folders under them', async () => {
    await expect(isInsideDownloadRoots(client, '/downloads')).resolves.toBe(true);
    await expect(isInsideDownloadRoots(client, '/downloads/movies/')).resolves.toBe(true);
    await expect(isInsideDownloadRoots(client, '/media/tv/Show')).resolves.toBe(true);
  });

  it('refuses folders outside them, look-alike prefixes and parent hops', async () => {
    await expect(isInsideDownloadRoots(client, '/etc')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(client, '/downloads-other')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(client, '/downloads/../etc')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(client, '/')).resolves.toBe(false);
  });
});
