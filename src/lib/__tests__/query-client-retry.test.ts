import { describe, expect, it } from 'vitest';
import { getQueryClient } from '@/lib/query-client';
import { ApiError } from '@/lib/query-fetch';

const retry = getQueryClient().getDefaultOptions().queries!.retry as (count: number, error: unknown) => boolean;

describe('default query retry', () => {
  it('never retries a refusal or another client error', () => {
    for (const status of [400, 401, 403, 404, 409]) expect(retry(0, new ApiError(status, 'x'))).toBe(false);
  });

  it('retries once for an outage, a timeout or a rate limit', () => {
    for (const status of [500, 502, 408, 429]) {
      expect(retry(0, new ApiError(status, 'x'))).toBe(true);
      expect(retry(1, new ApiError(status, 'x'))).toBe(false);
    }
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});
