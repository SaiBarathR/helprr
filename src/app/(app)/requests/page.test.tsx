// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ canApprove: false, tab: 'users' as 'requests' | 'users' }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => (cap === 'requests.approve' ? mocks.canApprove : true) }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ useExternalUrls: () => ({}) }));
vi.mock('@/lib/store', () => ({
  useUIStore: (select: (state: Record<string, unknown>) => unknown) => select({
    requestsTab: mocks.tab, setRequestsTab: vi.fn(),
    requestsFilter: 'pending', setRequestsFilter: vi.fn(),
    requestsUserFilter: null, setRequestsUserFilter: vi.fn(),
    requestsTypeFilter: [], setRequestsTypeFilter: vi.fn(),
    requestsSort: 'added', setRequestsSort: vi.fn(),
    requestsSortDirection: 'desc', setRequestsSortDirection: vi.fn(),
  }),
}));
vi.mock('@/components/seerr/requests-filter-menu', () => ({
  RequestsFilterMenu: () => null,
  useRequestsActiveFilters: () => [],
}));
vi.mock('@/components/seerr/requests-sort-menu', () => ({ RequestsSortMenu: () => null }));
vi.mock('@/components/ui/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('@/components/widgets/requests-list-widget', () => ({ RequestsListWidget: () => <p>requests list</p> }));
vi.mock('@/components/widgets/requests-users-widget', () => ({ RequestsUsersWidget: () => <p>users list</p> }));

import RequestsPage from './page';

let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(
    <QueryClientProvider client={client}><TooltipProvider><RequestsPage /></TooltipProvider></QueryClientProvider>,
  ));
}
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); });
const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn(async () => Response.json({ pending: 3 }));
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('RequestsPage', () => {
  it('shows a non-approver only their requests, even with Users saved as the tab, and asks for no counts', async () => {
    mocks.canApprove = false;
    mocks.tab = 'users';
    render();
    await flush();
    expect(tabs()).toEqual(['Requests']);
    expect(document.body.textContent).toContain('requests list');
    expect(document.body.textContent).not.toContain('users list');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives an approver both tabs and the pending count', async () => {
    mocks.canApprove = true;
    mocks.tab = 'requests';
    render();
    await flush();
    expect(tabs()).toEqual(['Requests3', 'Users']);
    expect(fetchMock).toHaveBeenCalledWith('/api/seerr/requests/count', expect.anything());
  });
});
