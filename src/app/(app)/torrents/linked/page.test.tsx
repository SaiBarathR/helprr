// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), urls: [] as string[] }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

import LinkedDownloadsPage from './page';

const now = new Date().toISOString();
const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status, service: 'RADARR', instanceLabel: 'radarr-4k', arrItemTitle: `Film ${id}`, releaseTitle: `Release.${id}`,
  lastError: null, updatedAt: now, ...extra,
});

beforeEach(() => {
  mocks.push.mockReset();
  mocks.urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    mocks.urls.push(url);
    const filter = new URL(url, 'http://x').searchParams.get('filter');
    const downloads = filter === 'attention'
      ? [row('b', 'BLOCKED', { lastError: 'Radarr cannot import it: Sample' })]
      : filter === 'open' ? [row('a', 'DOWNLOADING')] : [];
    return new Response(JSON.stringify({ downloads }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('linked downloads', () => {
  it('shows progress and size from the existing workflow request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ downloads: [row('a', 'DOWNLOADING', { progress: { fraction: 0.5, size: 1024 * 1024 } })] })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LinkedDownloadsPage /></QueryClientProvider>);
    expect(await screen.findByText('50% · 512 KB of 1 MB')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('lists each filter from the server, with the problem in view, and opens one', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LinkedDownloadsPage /></QueryClientProvider>);
    const user = userEvent.setup();

    expect(await screen.findByText('Film a')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Needs attention' }));
    expect(await screen.findByText('Radarr cannot import it: Sample')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('No finished downloads yet.')).toBeTruthy();
    expect(mocks.urls).toEqual(['/api/manual-downloads?filter=open', '/api/manual-downloads?filter=attention', '/api/manual-downloads?filter=history']);

    await user.click(screen.getByRole('tab', { name: 'Needs attention' }));
    await user.click(await screen.findByRole('button', { name: /Film b/ }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/torrents/linked/b'));
  });
});
