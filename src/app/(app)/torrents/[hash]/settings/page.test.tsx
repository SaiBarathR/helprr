// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ hash: 'abc' }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
import TorrentSettingsPage from './page';

const TORRENT = {
  hash: 'abc',
  name: 'Some.Release.2160p-GRP',
  dl_limit: 0,
  up_limit: 0,
  seq_dl: false,
  f_l_piece_prio: false,
  auto_tmm: false,
};

let root: Root;
let queryClient: QueryClient;
let torrents: unknown[];
let posts: Record<string, unknown>[];
let postResponse: () => Promise<Response>;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.bandwidth', 'torrents.manage']);
  torrents = [TORRENT];
  posts = [];
  postResponse = async () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(torrents);
    posts.push(JSON.parse(String(init.body)));
    return postResponse();
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  await act(async () => root.render(<QueryClientProvider client={queryClient}><TorrentSettingsPage /></QueryClientProvider>));
  await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull());
}
const option = (label: string) => document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;

describe('torrent settings page', () => {
  it('moves a switch at once and sends the toggle action', async () => {
    let release!: () => void;
    postResponse = () => new Promise((done) => { release = () => done(Response.json({ success: true })); });
    await renderPage();

    await act(async () => option('Sequential Download').click());
    // Still in flight: already on, and locked so the toggle can't be sent twice.
    await waitFor(() => expect(option('Sequential Download').getAttribute('aria-checked')).toBe('true'));
    expect(option('Sequential Download').disabled).toBe(true);

    await act(async () => release());
    await waitFor(() => expect(option('Sequential Download').disabled).toBe(false));
    expect(posts).toEqual([{ hash: 'abc', action: 'toggleSequentialDownload' }]);
    expect(option('Sequential Download').getAttribute('aria-checked')).toBe('true');
    expect(mocks.toast.success).toHaveBeenCalledWith('Sequential download toggled');
  });

  it('sends the chosen value for automatic management', async () => {
    await renderPage();
    await act(async () => option('Auto Torrent Management').click());
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Auto management toggled'));

    expect(posts).toEqual([{ hash: 'abc', action: 'setAutoManagement', enable: true }]);
  });

  it("rolls a switch back and shows qBittorrent's error when the action fails", async () => {
    postResponse = async () => Response.json({ error: 'Torrent not found' }, { status: 404 });
    await renderPage();
    await act(async () => option('First/Last Piece Priority').click());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Torrent not found'));

    expect(posts).toEqual([{ hash: 'abc', action: 'toggleFirstLastPiecePrio' }]);
    await waitFor(() => expect(option('First/Last Piece Priority').getAttribute('aria-checked')).toBe('false'));
    expect(option('First/Last Piece Priority').disabled).toBe(false);
  });

  it('saves a speed limit and shows the new value', async () => {
    await renderPage();
    const row = [...document.querySelectorAll<HTMLButtonElement>('button.grouped-row')]
      .find((el) => el.textContent?.startsWith('Download Limit'))!;
    await act(async () => row.click());
    const input = document.querySelector('form input') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, '2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector('form')!.requestSubmit());
    await waitFor(() => expect(document.body.textContent).toContain('Download Limit2 MB/s'));

    expect(posts).toEqual([{ hash: 'abc', action: 'setDownloadLimit', limit: 2 * 1024 * 1024 }]);
  });

  it('shows only the sections the user may change', async () => {
    mocks.caps = new Set(['torrents.manage']);
    await renderPage();

    expect(document.body.textContent).not.toContain('Speed Limits');
    expect(option('Sequential Download')).not.toBeNull();
  });

  it('explains when the user may change nothing', async () => {
    mocks.caps = new Set();
    await renderPage();

    expect(document.body.textContent).toContain("You don't have permission to change torrent settings.");
    expect(document.querySelector('[role="switch"]')).toBeNull();
  });

  it('says so when the torrent is no longer in qBittorrent', async () => {
    torrents = [];
    await renderPage();

    expect(document.body.textContent).toContain('This torrent is no longer in qBittorrent.');
  });
});
