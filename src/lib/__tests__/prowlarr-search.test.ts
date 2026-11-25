import { describe, expect, it } from 'vitest';
import {
  compareSearchResults,
  keepTopForEverySort,
  parseProwlarrCategoryTree,
  prowlarrCategoryIds,
  releaseCategoryNames,
  releaseFlags,
} from '@/lib/prowlarr-search';

const row = (id: number, seeders: number | null, size: number, publishDate: string | null) => ({ id, seeders, size, publishDate });

describe('keepTopForEverySort', () => {
  it('keeps each sort’s best rows, in the order they came', () => {
    const rows = [
      row(1, 50, 1, '2020-01-01'), // most seeded
      row(2, 1, 99, '2020-01-01'), // largest
      row(3, null, 2, '2026-01-01'), // newest, Usenet
      row(4, 2, 3, '2021-01-01'), // best at nothing
    ];

    expect(keepTopForEverySort(rows, 1).map(({ id }) => id)).toEqual([1, 2, 3]);
  });

  it('keeps every row when there are fewer than the limit', () => {
    const rows = [row(1, 1, 1, null), row(2, 2, 2, null)];
    expect(keepTopForEverySort(rows, 100)).toEqual(rows);
  });
});

describe('compareSearchResults', () => {
  it('puts a missing date last under Newest', () => {
    const sorted = [row(1, 0, 0, null), row(2, 0, 0, '2026-01-01')].sort((a, b) => compareSearchResults(a, b, 'age'));
    expect(sorted.map(({ id }) => id)).toEqual([2, 1]);
  });
});

describe('parseProwlarrCategoryTree', () => {
  // Shaped like Prowlarr 3.0's GET /api/v1/indexer/categories.
  const raw = [
    { id: 2000, name: 'Movies', subCategories: [{ id: 2040, name: 'Movies/HD', subCategories: [] }, { id: 2045, name: 'Movies/UHD', subCategories: [] }] },
    { id: 8000, name: 'Other', subCategories: [{ id: 8010, name: 'Other/Misc', subCategories: [] }] },
    { id: 0, name: 'Other', subCategories: [{ id: 10, name: 'Other/Misc', subCategories: [] }] },
  ];

  it('keeps ids and names, one level of subcategories, and leaves out the id-0 placeholder', () => {
    expect(parseProwlarrCategoryTree(raw)).toEqual([
      { id: 2000, name: 'Movies', subCategories: [{ id: 2040, name: 'Movies/HD' }, { id: 2045, name: 'Movies/UHD' }] },
      { id: 8000, name: 'Other', subCategories: [{ id: 8010, name: 'Other/Misc' }] },
    ]);
  });

  it('drops entries without a whole id or a name, and anything that is not a list', () => {
    expect(parseProwlarrCategoryTree({ id: 2000 })).toEqual([]);
    expect(parseProwlarrCategoryTree([
      { id: '2000', name: 'Movies' },
      { id: 3000, name: '' },
      { id: 5000, name: 'TV', subCategories: [{ id: 5070.5, name: 'x' }, { id: 5070, name: 'TV/Anime', extra: 'kept off' }, null] },
      { id: 7000, name: 'Books', subCategories: 'none' },
    ])).toEqual([
      { id: 5000, name: 'TV', subCategories: [{ id: 5070, name: 'TV/Anime' }] },
      { id: 7000, name: 'Books', subCategories: [] },
    ]);
  });

  it('lists every top-level and sub id for the allow-list', () => {
    expect([...prowlarrCategoryIds(parseProwlarrCategoryTree(raw))].sort()).toEqual([2000, 2040, 2045, 8000, 8010]);
  });
});

describe('releaseCategoryNames', () => {
  it('puts subcategories first, drops their parent and an indexer\'s own unnamed ones', () => {
    expect(releaseCategoryNames([
      { id: 2000, name: 'Movies' }, { id: 2040, name: 'Movies/HD' }, { id: 3101000, subCategories: [] }, { id: 5000, name: 'TV' },
    ])).toEqual(['Movies/HD', 'TV']);
  });

  it('keeps a parent with none of its own subcategories, and stops at the limit', () => {
    expect(releaseCategoryNames([{ id: 5000, name: 'TV' }])).toEqual(['TV']);
    expect(releaseCategoryNames([{ id: 2040, name: 'Movies/HD' }, { id: 5040, name: 'TV/HD' }, { id: 5070, name: 'TV/Anime' }], 2)).toHaveLength(2);
    expect(releaseCategoryNames(undefined)).toEqual([]);
  });

  it('after a search in some categories, names only the release\'s categories in them', () => {
    const anime = [{ id: 5000, name: 'TV' }, { id: 5070, name: 'TV/Anime' }, { id: 2020, name: 'Movies/Other' }];
    expect(releaseCategoryNames(anime, 2, [5070])).toEqual(['TV/Anime']);
    // A picked parent covers its subcategories; a picked subcategory keeps its parent.
    expect(releaseCategoryNames(anime, 2, [2000])).toEqual(['Movies/Other']);
    expect(releaseCategoryNames([{ id: 5000, name: 'TV' }, { id: 2020, name: 'Movies/Other' }], 2, [5070])).toEqual(['TV']);
  });

  it('keeps all of a release\'s categories when none is in the search', () => {
    expect(releaseCategoryNames([{ id: 2040, name: 'Movies/HD' }, { id: 8000, name: 'Other' }], 2, [5070])).toEqual(['Movies/HD', 'Other']);
  });
});

describe('releaseFlags', () => {
  it('keeps known flags only, once each, in lower case', () => {
    expect(releaseFlags(['FreeLeech', 'internal', 'internal', 'apikey=x', 7], false)).toEqual(['freeleech', 'internal']);
  });

  it('drops the ratio flags on a public tracker, where every release has them', () => {
    expect(releaseFlags(['freeleech', 'halfleech', 'doubleupload', 'scene', 'nuked'], true)).toEqual(['scene', 'nuked']);
  });

  it('takes nothing from a value that is not a list', () => {
    expect(releaseFlags('freeleech', false)).toEqual([]);
  });
});
