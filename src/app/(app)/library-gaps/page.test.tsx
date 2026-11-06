// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullToRefresh: null as null | { onRefresh: () => unknown; disabled?: boolean },
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({
  PullToRefresh: (props: { onRefresh: () => unknown; disabled?: boolean }) => {
    mocks.pullToRefresh = props;
    return null;
  },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true, useMe: () => ({ role: 'admin' }) }));

import LibraryGapsPage from './page';
import { queryKeys } from '@/lib/query-keys';

let fetchMock: ReturnType<typeof vi.fn<() => Promise<Response>>>;
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({
    sections: [{ id: 'missingEpisodes', available: true, count: 0, items: [] }],
  }));
  vi.stubGlobal('fetch', fetchMock);
});

it('pull to refresh refetches the gaps, even when none are left', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><LibraryGapsPage /></QueryClientProvider>);
  expect(await screen.findByText(/No gaps/)).toBeTruthy();

  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.libraryGaps() });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(mocks.pullToRefresh!.disabled).toBe(false);
});
