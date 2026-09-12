// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  usePathname: () => '/movies',
  useSearchParams: () => new URLSearchParams(),
}));
import { DataTable } from './data-table';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';

let root: Root;
const rows = Array.from({ length: 75 }, (_, index) => index + 1);
async function render(mounted = true, filter = 'all') {
  await act(async () => root.render(mounted ? <DataTable tableId="movies-test"
    columns={[{ id: 'title', label: 'Movie', width: 200, cell: (row: number) => `Movie ${row}` }]}
    rows={rows} rowKey={String} defaultPageSize={25} resetPageKey={filter} /> : null));
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); localStorage.clear(); resetRouteViewStateForTests();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); });

it('returns to the same table page and still resets pagination when filters change', async () => {
  await render();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
  expect(document.querySelector('tbody tr')?.textContent).toBe('Movie 26');
  await render(false); await render();
  expect(document.querySelector('tbody tr')?.textContent).toBe('Movie 26');
  await render(true, 'missing');
  expect(document.querySelector('tbody tr')?.textContent).toBe('Movie 1');
});
