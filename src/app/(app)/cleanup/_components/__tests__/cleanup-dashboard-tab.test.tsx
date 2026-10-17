// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));

import { CleanupDashboardTab } from '../cleanup-dashboard-tab';

// The strikes the server holds; tests shrink it between fetches.
let serverTotal = 65;
let strikePages: number[] = [];

beforeEach(() => {
  serverTotal = 65;
  strikePages = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.startsWith('/api/cleanup/stats')) {
      return json({ removedToday: 0, removedThisWeek: 0, removedAllTime: 0, queueTotal: 0, downloadTotal: 0, activeStrikes: serverTotal, totalStrikes: serverTotal, reSearchedAllTime: 0 });
    }
    if (url.startsWith('/api/cleanup/strikes')) {
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
      strikePages.push(page);
      const records = Array.from({ length: Math.max(0, Math.min(30, serverTotal - (page - 1) * 30)) }, (_, i) => ({
        id: `s${page}-${i}`, hash: `h${i}`, torrentName: `Torrent ${page}-${i}`, strikeType: 'stall', ruleId: null, ruleName: null, count: 1, maxStrikes: 3, lastSeenAt: new Date().toISOString(),
      }));
      return json({ records, total: serverTotal });
    }
    if (url.endsWith('/config')) return json({ enabled: false, autoRunMode: 'disabled', intervalMinutes: 30 });
    if (url.startsWith('/api/cleanup/scheduler-status')) return json({ queue: null, download: null });
    return new Response(null, { status: 404 });
  }));
});

describe('CleanupDashboardTab strike paging', () => {
  it('pages forward, and clamps back once strikes resolve past the current page', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CleanupDashboardTab onNavigate={() => {}} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(strikePages.at(-1)).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(strikePages.at(-1)).toBe(3));
    // It stays on the page asked for: no request falls back to page 1.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(strikePages).toEqual([1, 2, 3]);
    expect(screen.getByText('Torrent 3-0')).toBeTruthy();

    // Most strikes resolve: one page is left, and page 3 is past the end.
    serverTotal = 20;
    await act(() => client.invalidateQueries({ queryKey: ['cleanup', 'dashboard'] }));

    await waitFor(() => expect(strikePages.at(-1)).toBe(1));
    await waitFor(() => expect(screen.getByText('Torrent 1-0')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
  });
});
