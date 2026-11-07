import { describe, expect, it } from 'vitest';
import { newTagProblem, parseTorrentTags } from './torrent-tags';

describe('parseTorrentTags', () => {
  it("splits qBittorrent's comma-joined tags and drops the empties", () => {
    expect(parseTorrentTags('movies, 4k ,  ')).toEqual(['movies', '4k']);
    expect(parseTorrentTags('')).toEqual([]);
    expect(parseTorrentTags(undefined)).toEqual([]);
  });
});

describe('newTagProblem', () => {
  it('refuses what qBittorrent cannot store as one tag', () => {
    expect(newTagProblem('  ')).toBe('Name the tag');
    expect(newTagProblem('a,b')).toBe("A tag can't contain a comma");
    expect(newTagProblem('x'.repeat(101))).toBe('Keep the tag under 100 characters');
    expect(newTagProblem(' keep ')).toBeNull();
  });
});
