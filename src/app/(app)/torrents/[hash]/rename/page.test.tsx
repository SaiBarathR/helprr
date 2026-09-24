// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentSummaryResponse } from '@/types';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  router: { back: vi.fn(), push: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ hash: 'abc' }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => mocks.router }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
import RenameTorrentPage from './page';

const TORRENT = { hash: 'abc', name: 'Old.Name.2160p-GRP' };
const OTHER = { hash: 'def', name: 'Other.Release' };
const SUMMARY_KEY = ['torrents', 'summary', '__all__'];

let root: Root;
let queryClient: QueryClient;
let torrents: unknown[];
let posts: Record<string, unknown>[];
let postResponse: () => Promise<Response>;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.manage']);
  torrents = [TORRENT];
  posts = [];
  postResponse = async () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(torrents);
    posts.push(JSON.parse(String(init.body)));
    return postResponse();
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<QBittorrentSummaryResponse>(SUMMARY_KEY, {
    torrents: [TORRENT, OTHER] as QBittorrentSummaryResponse['torrents'],
    transferInfo: null,
  });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
// Query observers are notified on a later task, so poll instead of assuming a tick.
async function waitFor(check: () => void, timeout = 3000) {
  for (const start = Date.now(); ; await wait(10)) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
    }
  }
}
async function renderPage() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><RenameTorrentPage /></QueryClientProvider>));
  await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull());
}
const input = () => document.querySelector<HTMLInputElement>('input[aria-label="Torrent name"]')!;
const renameButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((el) => el.textContent?.trim() === 'Rename')!;
async function typeName(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('rename torrent page', () => {
  it('starts from the current name and only saves a real change', async () => {
    await renderPage();

    expect(input().value).toBe('Old.Name.2160p-GRP');
    expect(renameButton().disabled).toBe(true);
    await typeName('   ');
    expect(renameButton().disabled).toBe(true);
    await typeName('New.Name');
    expect(renameButton().disabled).toBe(false);
  });

  it('renames with the trimmed name, updates the cached list and goes back', async () => {
    await renderPage();
    await typeName('  New.Name.2160p-GRP  ');
    await act(async () => document.querySelector('form')!.requestSubmit());
    await waitFor(() => expect(mocks.router.back).toHaveBeenCalledTimes(1));

    expect(posts).toEqual([{ hash: 'abc', action: 'rename', name: 'New.Name.2160p-GRP' }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('Renamed');
    const summary = queryClient.getQueryData<QBittorrentSummaryResponse>(SUMMARY_KEY)!;
    expect(summary.torrents.map((t) => t.name)).toEqual(['New.Name.2160p-GRP', 'Other.Release']);
  });

  it("stays on the page with qBittorrent's error when the rename fails", async () => {
    postResponse = async () => Response.json({ error: 'Name is invalid' }, { status: 400 });
    await renderPage();
    await typeName('New.Name');
    await act(async () => document.querySelector('form')!.requestSubmit());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Name is invalid'));

    expect(mocks.router.back).not.toHaveBeenCalled();
    expect(input().value).toBe('New.Name');
    expect(queryClient.getQueryData<QBittorrentSummaryResponse>(SUMMARY_KEY)!.torrents[0].name).toBe('Old.Name.2160p-GRP');
  });

  it('cancels without renaming', async () => {
    await renderPage();
    await typeName('New.Name');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((el) => el.textContent === 'Cancel')!.click());

    expect(mocks.router.back).toHaveBeenCalledTimes(1);
    expect(posts).toEqual([]);
  });

  it('explains when the user may not rename', async () => {
    mocks.caps = new Set();
    await renderPage();

    expect(document.body.textContent).toContain("You don't have permission to rename torrents.");
    expect(document.querySelector('input')).toBeNull();
  });

  it('says so when the torrent is no longer in qBittorrent', async () => {
    torrents = [];
    await renderPage();

    expect(document.body.textContent).toContain('This torrent is no longer in qBittorrent.');
  });
});
