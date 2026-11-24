import { describe, expect, it } from 'vitest';
import { folderNameError, joinPath, lastPathSegment, parentPath, pathInRootFolder } from '@/lib/paths';

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

  describe('renaming the folder', () => {
    it.each([
      ['/movies/Film', '/movies', 'Film (2020)', '/movies/Film (2020)'],
      ['/movies/Film/', '/movies/', 'Film (2020)', '/movies/Film (2020)'],
      ['/movies/Film', '/archive', 'Film (2020)', '/archive/Film (2020)'],
      ['C:\\Media\\Film', 'C:\\Media', 'Film (2020)', 'C:\\Media\\Film (2020)'],
    ])('renames %s in %s to %s', (path, root, folder, renamed) => {
      expect(pathInRootFolder(path, root, folder)).toBe(renamed);
    });

    it('leaves the path alone when neither the root folder nor the name changes', () => {
      expect(pathInRootFolder('/movies/Film', '/movies/', 'Film')).toBeNull();
    });
  });

  describe('folder names', () => {
    it.each(['Film (2020)', 'Amélie (2001)', 'a..b', 'Mr. Robot', 'x'.repeat(255), 'é'.repeat(127)])('accepts %s', (name) => {
      expect(folderNameError(name)).toBeNull();
    });

    it.each([
      ['an empty name', ''],
      ['a slash', 'a/b'],
      ['a backslash', 'a\\b'],
      ['the parent folder', '..'],
      ['the folder itself', '.'],
      ['a leading dot', '.hidden'],
      ['a trailing dot', 'Film.'],
      ['a leading space', ' Film'],
      ['a trailing space', 'Film '],
      ['a newline', 'Fi\nlm'],
      ['a NUL', 'Fi\u0000lm'],
      ['a DEL', 'Fi\u007flm'],
      ['more than 255 bytes', 'x'.repeat(256)],
      ['more than 255 bytes of UTF-8', 'é'.repeat(128)],
    ])('refuses %s', (_label, name) => {
      expect(folderNameError(name)).toEqual(expect.any(String));
    });
  });
});
