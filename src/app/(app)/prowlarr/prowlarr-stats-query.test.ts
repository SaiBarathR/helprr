import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_STATS_FILTERS, prowlarrStatsQuery, statsSearchParams } from './prowlarr-stats-query';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe('Prowlarr stats query', () => {
  it('counts a range back from now with no end day', () => {
    expect(Object.fromEntries(statsSearchParams('7d'))).toEqual({ startDate: new Date(2026, 10, 18, 12, 0, 0).toISOString() });
  });

  it('counts a range back from the end of the end day', () => {
    const params = Object.fromEntries(statsSearchParams('7d', { ...NO_STATS_FILTERS, endDate: '2026-11-10' }));
    expect(params).toEqual({
      startDate: new Date(2026, 10, 3, 23, 59, 59, 999).toISOString(),
      endDate: new Date(2026, 10, 10, 23, 59, 59, 999).toISOString(),
    });
  });

  it('sends the indexers, tags and protocol it is given', () => {
    const params = statsSearchParams('all', { endDate: '', indexers: [3, 1], tags: [2], protocol: 'usenet' });
    expect(Object.fromEntries(params)).toEqual({ indexers: '3,1', tags: '2', protocols: 'usenet' });
  });

  it('keeps the unfiltered key the indexer sheet shares', () => {
    expect(prowlarrStatsQuery('7d').queryKey).toEqual(['prowlarr', 'stats', '7d']);
    expect(prowlarrStatsQuery('7d', { ...NO_STATS_FILTERS, protocol: 'torrent' }).queryKey).toHaveLength(4);
  });
});
