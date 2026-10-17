import { describe, expect, it } from 'vitest';
import { joinPath, lastPathSegment, parentPath, pathInRootFolder } from '@/lib/paths';

describe('media path helpers', () => {
  it.each([
    ['/mnt/media/tv/Show (2020)', '/mnt/media/tv', 'Show (2020)'],
    ['/mnt/media/tv/Show (2020)/', '/mnt/media/tv', 'Show (2020)'],
    ['/tv/Show\\Name', '/tv', 'Show\\Name'], // a backslash is a legal POSIX character
    ['/Show', '/', 'Show'],
    ['C:\\Media\\TV\\Show (2020)', 'C:\\Media\\TV', 'Show (2020)'],
    ['C:\\Media\\TV\\Show (2020)\\', 'C:\\Media\\TV', 'Show (2020)'],
    ['C:\\Show', 'C:\\', 'Show'],
    ['\\\\nas\\media\\Show', '\\\\nas\\media', 'Show'],
  ])('splits %s', (path, parent, last) => {
    expect(parentPath(path)).toBe(parent);
    expect(lastPathSegment(path)).toBe(last);
  });

  it.each([
    ['/mnt/tv', 'Show', '/mnt/tv/Show'],
    ['/mnt/tv/', 'Show', '/mnt/tv/Show'],
    ['D:\\TV', 'Show', 'D:\\TV\\Show'],
    ['D:\\TV\\', 'Show', 'D:\\TV\\Show'],
    ['C:\\', 'Show', 'C:\\Show'],
  ])('joins %s and %s', (folder, segment, joined) => {
    expect(joinPath(folder, segment)).toBe(joined);
  });

  describe('moving to a root folder', () => {
    it.each([
      // The folder it is already in, written either way, leaves the path alone.
      ['/movies/Film', '/movies'],
      ['/movies/Film', '/movies/'],
      ['/movies/Film/', '/movies'],
      ['C:\\Show', 'C:\\'],
      ['/tv/Show\\Name', '/tv'],
      ['/movies/Film', ''],
    ])('keeps %s where it is in %s', (path, root) => {
      expect(pathInRootFolder(path, root)).toBeNull();
    });

    it.each([
      ['/movies/Film (2020)', '/archive', '/archive/Film (2020)'],
      ['/tv/Show\\Name', '/archive/', '/archive/Show\\Name'],
      ['C:\\Media\\TV\\Show (2020)', 'D:\\Archive\\', 'D:\\Archive\\Show (2020)'],
      ['C:\\Show', 'D:\\', 'D:\\Show'],
    ])('moves %s to %s', (path, root, moved) => {
      expect(pathInRootFolder(path, root)).toBe(moved);
    });
  });
});
