import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCollectionMovie } from './collection-detail-drawer';
import type { CollectionSummary } from '@/types';

afterEach(() => vi.unstubAllGlobals());

describe('addCollectionMovie', () => {
  it('leaves the search to the collection’s own “search on add” setting', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await addCollectionMovie({ id: 7, instanceId: 'r1' } as CollectionSummary, 42);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ collectionId: 7, tmdbId: 42, instanceId: 'r1' });
  });
});
