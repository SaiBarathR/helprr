import { describe, it, expect } from 'vitest';
import {
  coercePositiveInt,
  coercePositiveIntArray,
  sanitizeTitle,
  checkOwnership,
} from '@/lib/manage-files-guard';

describe('coercePositiveInt', () => {
  it('accepts positive integers (number or numeric string)', () => {
    expect(coercePositiveInt(5)).toBe(5);
    expect(coercePositiveInt('12')).toBe(12);
  });

  it('rejects zero, negatives, floats, and junk', () => {
    expect(coercePositiveInt(0)).toBeNull();
    expect(coercePositiveInt(-3)).toBeNull();
    expect(coercePositiveInt(1.5)).toBeNull();
    expect(coercePositiveInt('abc')).toBeNull();
    expect(coercePositiveInt(null)).toBeNull();
    expect(coercePositiveInt(undefined)).toBeNull();
  });
});

describe('coercePositiveIntArray', () => {
  it('accepts a non-empty array of positive integers', () => {
    expect(coercePositiveIntArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('rejects empty arrays, non-arrays, and arrays with invalid members', () => {
    expect(coercePositiveIntArray([])).toBeNull();
    expect(coercePositiveIntArray('1,2')).toBeNull();
    expect(coercePositiveIntArray([1, -2])).toBeNull();
    expect(coercePositiveIntArray([1, 'x'])).toBeNull();
  });
});

describe('sanitizeTitle', () => {
  it('passes through reasonable titles and rejects non-strings', () => {
    expect(sanitizeTitle('Breaking Bad')).toBe('Breaking Bad');
    expect(sanitizeTitle(42)).toBeNull();
    expect(sanitizeTitle(undefined)).toBeNull();
  });
});

describe('checkOwnership (cross-media id injection guard)', () => {
  const existing = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it('matches when every requested id belongs to the media item', () => {
    const r = checkOwnership([1, 3], existing);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matched.map((f) => f.id)).toEqual([1, 3]);
  });

  it('reports ids that belong to a different media item', () => {
    const r = checkOwnership([1, 999], existing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual([999]);
  });

  it('rejects when nothing exists to own', () => {
    const r = checkOwnership([1], []);
    expect(r.ok).toBe(false);
  });
});
