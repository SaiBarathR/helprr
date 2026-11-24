// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useRemoveQueriesOnUnmount } from '../use-remove-queries-on-unmount';

describe('useRemoveQueriesOnUnmount', () => {
  it('leaves a deleted title on screen without refetching it, and drops it from the cache on leaving', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = ['sonarr', 'detail', 'inst', 32];
    client.setQueryData(key, { id: 32 });
    const fetchTitle = vi.fn(async () => ({ id: 32 }));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender, unmount } = renderHook(() => {
      useQuery({ queryKey: key, queryFn: fetchTitle });
      return useRemoveQueriesOnUnmount();
    }, { wrapper });

    act(() => result.current(key));
    rerender();
    await act(async () => {});
    expect(fetchTitle).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual({ id: 32 });

    unmount();
    expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined();
    expect(fetchTitle).not.toHaveBeenCalled();
  });
});

describe('useRemoveQueriesOnUnmount after leaving', () => {
  it('removes at once when the delete finishes after the page is gone', () => {
    const client = new QueryClient();
    const key = ['radarr', 'detail', 'inst', 129];
    client.setQueryData(key, { id: 129 });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => useRemoveQueriesOnUnmount(), { wrapper });
    const remove = result.current;
    unmount();
    remove(key);
    expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined();
  });
});
