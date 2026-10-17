import { describe, expect, it } from 'vitest';
import { joinPath, lastPathSegment, parentPath } from '@/lib/paths';

describe('media path helpers', () => {
  it.each([
    ['/mnt/media/tv/Show (2020)', '/mnt/media/tv', 'Show (2020)'],
    ['/mnt/media/tv/Show (2020)/', '/mnt/media/tv', 'Show (2020)'],
    ['C:\\Media\\TV\\Show (2020)', 'C:\\Media\\TV', 'Show (2020)'],
    ['C:\\Media\\TV\\Show (2020)\\', 'C:\\Media\\TV', 'Show (2020)'],
    ['\\\\nas\\media\\Show', '\\\\nas\\media', 'Show'],
    ['Show', '', 'Show'],
  ])('splits %s', (path, parent, last) => {
    expect(parentPath(path)).toBe(parent);
    expect(lastPathSegment(path)).toBe(last);
  });

  it.each([
    ['/mnt/tv', 'Show', '/mnt/tv/Show'],
    ['/mnt/tv/', 'Show', '/mnt/tv/Show'],
    ['D:\\TV', 'Show', 'D:\\TV\\Show'],
    ['D:\\TV\\', 'Show', 'D:\\TV\\Show'],
  ])('joins %s and %s', (folder, segment, joined) => {
    expect(joinPath(folder, segment)).toBe(joined);
  });

  it('moves a Windows series to another root folder without keeping the old path', () => {
    const path = 'C:\\Media\\TV\\Show (2020)';
    expect(joinPath('D:\\Archive\\', lastPathSegment(path))).toBe('D:\\Archive\\Show (2020)');
  });
});
