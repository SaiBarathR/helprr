// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => '/series/anime-hook' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { queryKeys } from '@/lib/query-keys';
import { useSeriesAnime } from '../use-series-anime';

const detail = (id: number) => ({ id, title: `Entry ${id}`, nextAiringEpisode: null });
const payload = (ids: number[]) => ({ mapping: { state: 'AUTO_MATCH', entries: ids.map((id) => ({ anilistMediaId: id, titleSnapshot: `Entry ${id}` })) }, details: [detail(ids[0])] });

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(String(input), 'http://helprr.test');
    const seriesId = Number(url.pathname.split('/')[3]);
    if (url.searchParams.get('full') === '1') return Response.json({ ...payload([seriesId * 10, seriesId * 10 + 1]), details: [detail(seriesId * 10), detail(seriesId * 10 + 1)] });
    return Response.json(payload([seriesId * 10, seriesId * 10 + 1]));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('a series anime state', () => {
  it("keeps the remap drawer's hydrated set to the series it was loaded for", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ id }) => useSeriesAnime({ series: { id, seriesType: 'anime' } as never, seriesId: id, instance: undefined }), { wrapper, initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.animeEntries).toHaveLength(2));
    // Before the drawer hydrates, it gets whatever details are loaded (the primary).
    expect(result.current.animeDetails.map((entry) => entry.id)).toEqual([10]);

    act(() => result.current.setShowAniListRemap(true));
    await waitFor(() => expect(result.current.animeDetails.map((entry) => entry.id)).toEqual([10, 11]));

    // Another series (the page stays mounted, the drawer closed): series 1's hydrated set is not offered.
    act(() => result.current.setShowAniListRemap(false));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.animeEntries.map((entry) => entry.anilistMediaId)).toEqual([20, 21]));
    expect(result.current.animeDetails.map((entry) => entry.id)).toEqual([20]);

    // Series 1's data is refetched meanwhile (primary only); back on it, its old hydrated set is gone too.
    await act(() => client.refetchQueries({ queryKey: queryKeys.anime(1, undefined) }));
    rerender({ id: 1 });
    await waitFor(() => expect(result.current.animeEntries.map((entry) => entry.anilistMediaId)).toEqual([10, 11]));
    expect(result.current.animeDetails.map((entry) => entry.id)).toEqual([10]);
  });
});
