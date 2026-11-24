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
    ['a C1 control', '/downloads/..\u0085'],
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
    ['a C1 control', ['a\u0085']],
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
    // qBittorrent trims U+0085 (JS trim() keeps it), then reads "/downloads/.." as "/".
    await expect(isInsideDownloadRoots(client, '/downloads/..\u0085')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(client, '\u0085/downloads/x')).resolves.toBe(true);
  });

  // qBittorrent 5.1.4 on Linux keeps "/downloads\\x" as it is: a folder named "downloads\\x" beside /downloads.
  it('refuses a backslash under a Linux root', async () => {
    await expect(isInsideDownloadRoots(client, '/downloads\\x')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(client, '/downloads/a\\..\\..\\etc')).resolves.toBe(false);
  });

  it('refuses parts made of dots and spaces, which Windows reads as a parent hop', async () => {
    await expect(isInsideDownloadRoots(client, '/downloads/.. /x')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(client, '/downloads/.../x')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(client, '/downloads/./x')).resolves.toBe(true);
  });

  it('reads backslashes as separators under a Windows root', async () => {
    const windows = {
      getDefaultSavePath: vi.fn().mockResolvedValue('C:\\Downloads'),
      getCategories: vi.fn().mockResolvedValue({}),
    } as unknown as QBittorrentClient;
    await expect(isInsideDownloadRoots(windows, 'C:\\Downloads\\Movies')).resolves.toBe(true);
    await expect(isInsideDownloadRoots(windows, 'C:/Downloads/Movies')).resolves.toBe(true);
    await expect(isInsideDownloadRoots(windows, 'C:\\Downloads\\..\\Windows')).resolves.toBe(false);
    await expect(isInsideDownloadRoots(windows, 'C:\\Downloads-other')).resolves.toBe(false);
  });

  it('ignores a category root qBittorrent would read differently', async () => {
    const odd = {
      getDefaultSavePath: vi.fn().mockResolvedValue('/downloads'),
      getCategories: vi.fn().mockResolvedValue({ odd: { name: 'odd', savePath: '/data\\odd' } }),
    } as unknown as QBittorrentClient;
    await expect(isInsideDownloadRoots(odd, '/data/odd/x')).resolves.toBe(false);
  });
});
