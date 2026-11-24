// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HASH = 'a'.repeat(40);
const mocks = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ hash: 'a'.repeat(40) }),
  useSearchParams: () => new URLSearchParams('name=Pack'),
  usePathname: () => `/torrents/${'a'.repeat(40)}/files`,
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn(async () => 5_000) }));
vi.mock('@/components/ui/quick-context-menu', () => ({ QuickContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import TorrentFilesPage from './page';

const file = (index: number, name: string) => ({ index, name, size: 1024, progress: 0.5, priority: 1, is_seed: false, availability: 1 });

beforeEach(() => {
  mocks.asked = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    mocks.asked.push(url.pathname);
    return Response.json({ files: [file(0, 'Pack/one.mkv'), file(1, 'Pack/two.mkv')] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('torrent files page', () => {
  it('reads the file list from the files route, not the heavier details route', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><TorrentFilesPage /></QueryClientProvider>);

    expect(await screen.findByText('Pack')).toBeTruthy();
    await waitFor(() => expect(mocks.asked).toContain(`/api/qbittorrent/${HASH}/files`));
    expect(mocks.asked.every((path) => path === `/api/qbittorrent/${HASH}/files`)).toBe(true);
  });
});
