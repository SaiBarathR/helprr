// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  usePathname: () => '/browse',
  useSearchParams: () => new URLSearchParams(),
}));
import { useRestorableInfiniteQuery } from './use-restorable-infinite-query';
import { resetRouteViewStateForTests } from './use-route-view-state';

let root: Root;
let client: QueryClient;
const fetchPage = vi.fn(async (page: number) => ({ page }));
function Page({ filter = 'all', enabled = true }) {
  const query = useRestorableInfiniteQuery({
    queryKey: ['items', filter],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.page < 4 ? last.page + 1 : undefined,
    enabled,
  });
  return <button onClick={() => void query.fetchNextPage()}>{query.data?.pages.map((page) => page.page).join(',')}</button>;
}
async function render(mounted = true, filter = 'all', enabled = true) {
  await act(async () => root.render(<QueryClientProvider client={client}>{mounted && <Page filter={filter} enabled={enabled} />}</QueryClientProvider>));
}
async function until(text: string) {
  for (let i = 0; i < 50 && document.querySelector('button')?.textContent !== text; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  expect(document.querySelector('button')?.textContent).toBe(text);
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); resetRouteViewStateForTests(); fetchPage.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); });

it('rebuilds previously loaded pages after the query payload cache expires', async () => {
  await render(); await until('1');
  await act(async () => document.querySelector('button')!.click()); await until('1,2');
  await act(async () => document.querySelector('button')!.click()); await until('1,2,3');
  await render(false); client.clear(); fetchPage.mockClear();
  await render(); await until('1,2,3');
  expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  // Changing filters is a fresh result, so it does not inherit the old depth.
  await render(true, 'other'); await until('1');
});

it('does not load extra pages for a new view or fetch a disabled query', async () => {
  await render(); await until('1');
  expect(fetchPage).toHaveBeenCalledTimes(1);
  await render(true, 'disabled', false);
  expect(fetchPage).toHaveBeenCalledTimes(1);
});
