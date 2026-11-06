// @vitest-environment jsdom

import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('./_components/cleanup-dashboard-tab', () => ({ CleanupDashboardTab: () => <p>Dashboard tab</p> }));
vi.mock('./_components/download-cleaner-tab', () => ({ DownloadCleanerTab: () => null }));
vi.mock('./_components/cleanup-history-tab', () => ({ CleanupHistoryTab: () => null }));
// Stands in for a Queue Cleaner form holding unsaved edits.
vi.mock('./_components/queue-cleaner-tab', () => ({
  QueueCleanerTab: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => {
    useEffect(() => onDirtyChange(true), [onDirtyChange]);
    return <p>Queue tab</p>;
  },
}));

import CleanupPage from './page';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';

beforeEach(() => {
  resetRouteViewStateForTests();
  sessionStorage.clear();
});

it('pull to refresh refetches the cleanup queries, but not over unsaved cleaner edits', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><CleanupPage /></QueryClientProvider>);

  expect(mocks.pullToRefresh!.disabled).toBe(false);
  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cleanup'] });

  await user.click(screen.getByRole('tab', { name: /Queue/ }));
  expect(await screen.findByText('Queue tab')).toBeTruthy();
  expect(mocks.pullToRefresh!.disabled).toBe(true);
});
