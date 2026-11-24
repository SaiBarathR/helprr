import { describe, expect, it } from 'vitest';
import { compareSearchResults, keepTopForEverySort } from '@/lib/prowlarr-search';

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
