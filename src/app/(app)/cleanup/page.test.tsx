// @vitest-environment jsdom

import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullToRefresh: null as null | { onRefresh: () => unknown; disabled?: boolean },
  role: 'admin' as 'admin' | 'member',
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({
  PullToRefresh: (props: { onRefresh: () => unknown; disabled?: boolean }) => {
    mocks.pullToRefresh = props;
    return null;
  },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true, useMe: () => ({ role: mocks.role }) }));
vi.mock('./_components/library-cleanup-tab', () => ({ LibraryCleanupTab: () => <p>Library tab</p> }));
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
  mocks.role = 'admin';
  resetRouteViewStateForTests();
  sessionStorage.clear();
});

it('pull to refresh refetches the cleanup queries, and asks first over unsaved cleaner edits', async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><CleanupPage /></QueryClientProvider>);
  expect(screen.getByRole('heading', { level: 1, name: 'Cleanup' }).className).toContain('sr-only');
  expect(screen.getByRole('tablist').dataset.variant).toBe('segmented');

  expect(mocks.pullToRefresh!.disabled).toBeFalsy();
  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cleanup'] });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  invalidate.mockClear();

  await user.click(screen.getByRole('tab', { name: /Queue/ }));
  expect(await screen.findByText('Queue tab')).toBeTruthy();
  expect(mocks.pullToRefresh!.disabled).toBeFalsy();

  // Over unsaved edits the pull asks first; Cancel keeps the edits.
  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  expect(await screen.findByRole('alertdialog', { name: 'Refresh with unsaved changes?' })).toBeTruthy();
  expect(invalidate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(invalidate).not.toHaveBeenCalled();

  // Confirming refetches.
  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  await user.click(await screen.findByRole('button', { name: 'Refresh' }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cleanup'] });
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('shows the Library tab to admins only, even when a member may manage cleanup', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<QueryClientProvider client={new QueryClient()}><CleanupPage /></QueryClientProvider>);
  await user.click(screen.getByRole('tab', { name: /Library/ }));
  expect(await screen.findByText('Library tab')).toBeTruthy();
  unmount();

  mocks.role = 'member';
  render(<QueryClientProvider client={new QueryClient()}><CleanupPage /></QueryClientProvider>);
  expect(screen.queryByRole('tab', { name: /Library/ })).toBeNull();
  // A remembered Library tab falls back to the dashboard.
  expect(screen.getByText('Dashboard tab')).toBeTruthy();
});
