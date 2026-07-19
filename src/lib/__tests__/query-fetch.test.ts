import { describe, expect, it } from 'vitest';
import { ApiError, ensureArray, nullOn404 } from '@/lib/query-fetch';

describe('nullOn404', () => {
  it('passes through a resolved value', async () => {
    await expect(nullOn404(Promise.resolve({ id: 1 }))).resolves.toEqual({ id: 1 });
  });

  it('maps a 404 ApiError to null', async () => {
    await expect(nullOn404(Promise.reject(new ApiError(404, 'GET /x → 404')))).resolves.toBeNull();
  });

  it('rethrows non-404 ApiErrors', async () => {
    await expect(nullOn404(Promise.reject(new ApiError(500, 'GET /x → 500')))).rejects.toMatchObject(
      { status: 500 },
    );
  });

  it('rethrows non-ApiError failures', async () => {
    await expect(nullOn404(Promise.reject(new Error('network')))).rejects.toThrow('network');
  });
});

describe('ensureArray', () => {
  it('keeps arrays and coerces non-arrays to []', () => {
    expect(ensureArray([1, 2])).toEqual([1, 2]);
    expect(ensureArray<number>(undefined)).toEqual([]);
    expect(ensureArray({} as unknown as number[])).toEqual([]);
  });
});
