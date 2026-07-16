import { describe, expect, it } from 'vitest';
import { arrEditHref, arrFilesHref, arrManageHref } from '@/lib/arr-edit-href';

describe('arrEditHref', () => {
  it('builds movie edit href without instance', () => {
    expect(arrEditHref('movie', 11)).toBe('/movies/11/edit');
  });

  it('builds series edit href with instance', () => {
    expect(arrEditHref('series', 5, 'inst-abc')).toBe('/series/5/edit?instance=inst-abc');
  });

  it('builds music edit href', () => {
    expect(arrEditHref('music', 3, 'lid-1')).toBe('/music/3/edit?instance=lid-1');
  });
});

describe('arrManageHref', () => {
  it('includes title and instance for movies', () => {
    expect(arrManageHref('movie', 11, 'Inception', 'cmrkep2m')).toBe(
      '/movies/11/manage?title=Inception&instance=cmrkep2m',
    );
  });
});

describe('arrFilesHref', () => {
  it('builds music files href', () => {
    expect(arrFilesHref('music', 7, 'inst')).toBe('/music/7/files?instance=inst');
  });
});
