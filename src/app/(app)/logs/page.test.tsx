// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullToRefresh: null as null | { onRefresh: () => unknown },
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({
  PullToRefresh: (props: { onRefresh: () => unknown }) => {
    mocks.pullToRefresh = props;
    return null;
  },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('./logs-toolbar', () => ({ LogsToolbar: () => null }));
vi.mock('./logs-files-sheet', () => ({ LogsFilesSheet: () => null }));

import LogsPage from './page';

let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({ files: [], entries: [] }));
  vi.stubGlobal('fetch', fetchMock);
});

it('pull to refresh refetches the log files and entries', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><LogsPage /></QueryClientProvider>);
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['logs'] });
  const paths = fetchMock.mock.calls.slice(2).map(([url]) => String(url).split('?')[0]);
  expect(paths.sort()).toEqual(['/api/logs/files', '/api/logs/search']);
});
