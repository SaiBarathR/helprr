// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullToRefresh: null as null | { onRefresh: () => unknown },
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({
  PullToRefresh: (props: NonNullable<typeof mocks.pullToRefresh>) => {
    mocks.pullToRefresh = props;
    return null;
  },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/widgets/widget-filter-controls', () => ({ DateRangeSelect: () => null }));
vi.mock('@/components/insights/kpi-row', () => ({ KpiRow: () => null }));
vi.mock('@/components/insights/service-health-strip', () => ({ ServiceHealthStrip: () => null }));
vi.mock('@/components/insights/library-gaps-card', () => ({ LibraryGapsCard: () => null }));
vi.mock('@/components/insights/storage-insights-card', () => ({ StorageInsightsCard: () => null }));
vi.mock('@/components/insights/seeding-economics-card', () => ({ SeedingEconomicsCard: () => null }));
vi.mock('@/components/insights/watch-stats-section', () => ({ WatchStatsSection: () => null }));
vi.mock('@/components/insights/jellyfin-libraries-card', () => ({ JellyfinLibrariesCard: () => null }));
vi.mock('@/components/insights/technical-breakdown-card', () => ({ TechnicalBreakdownCard: () => null }));
vi.mock('@/components/insights/quality-score-card', () => ({ QualityScoreCard: () => null }));
vi.mock('@/components/insights/file-explorer-card', () => ({ FileExplorerCard: () => null }));

import InsightsPage from './page';
import { queryKeys } from '@/lib/query-keys';

let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
});

it('pull to refresh refetches the insights cards', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><InsightsPage /></QueryClientProvider>);
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  const statsFetches = () => fetchMock.mock.calls.filter(([url]) => url === '/api/services/stats').length;
  expect(statsFetches()).toBe(1);

  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  expect(statsFetches()).toBe(2);
  expect(invalidate.mock.calls.map(([filters]) => filters)).toEqual([
    { queryKey: ['insights'] },
    { queryKey: queryKeys.libraryGaps() },
  ]);
});
