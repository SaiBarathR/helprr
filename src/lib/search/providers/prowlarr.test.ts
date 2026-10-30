import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getHistory: vi.fn(), getIndexers: vi.fn() }));

vi.mock('@/lib/service-helpers', () => ({
  getProwlarrClient: vi.fn(async () => ({ getHistory: mocks.getHistory, getIndexers: mocks.getIndexers })),
}));

import { searchProwlarr } from './prowlarr';

const search = (query: string) => searchProwlarr({ query, limit: 10 } as Parameters<typeof searchProwlarr>[0]);

beforeEach(() => {
  mocks.getIndexers.mockResolvedValue([
    { id: 7, name: 'YTS', implementationName: 'Cardigann', enable: true },
    { id: 8, name: 'EZTV', implementationName: 'Cardigann', enable: false },
  ]);
  // The shape Prowlarr 2.5.2 returns: no top-level query or indexer name.
  mocks.getHistory.mockResolvedValue({
    records: [
      { id: 1, indexerId: 7, eventType: 'indexerQuery', successful: true, date: '', data: { query: 'big buck bunny' } },
      { id: 2, indexerId: 8, eventType: 'indexerRss', successful: false, date: '', data: {} },
    ],
  });
});

describe('searchProwlarr', () => {
  it('matches history on the searched text and names the indexer', async () => {
    const { results } = await search('buck bunny');

    expect(results).toEqual([expect.objectContaining({
      id: 'prowlarr:history:1',
      title: 'big buck bunny',
      subtitle: 'YTS · indexerQuery · OK',
      route: '/prowlarr',
    })]);
  });

  it('matches history on the indexer name when a record has no search text', async () => {
    const { results } = await search('eztv');

    expect(results[0]).toEqual(expect.objectContaining({
      id: 'prowlarr:history:2',
      title: 'EZTV',
      subtitle: 'EZTV · indexerRss · Failed',
    }));
  });

  it('links an indexer result to its sheet', async () => {
    mocks.getHistory.mockResolvedValue({ records: [] });

    const { results } = await search('yts');

    expect(results).toEqual([expect.objectContaining({ id: 'prowlarr:indexer:7', route: '/prowlarr?indexer=7' })]);
  });
});
