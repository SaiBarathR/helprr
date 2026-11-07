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
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap), useMe: () => null }));
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
  save_path: '/downloads',
  tags: 'movies',
  priority: 2,
};

let root: Root;
let queryClient: QueryClient;
let torrents: unknown[];
let options: { tags: string[]; queueingEnabled: boolean };
let posts: Record<string, unknown>[];
let postResponse: () => Promise<Response>;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.bandwidth', 'torrents.manage']);
  torrents = [TORRENT];
  options = { tags: ['4k', 'movies'], queueingEnabled: true };
  posts = [];
  postResponse = async () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(_url.includes('/options') ? options : torrents);
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
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

  it('moves the torrent to a new folder and shows it', async () => {
    await renderPage();
    const row = [...document.querySelectorAll<HTMLButtonElement>('button.grouped-row')]
      .find((el) => el.textContent?.startsWith('Save Path'))!;
    expect(row.textContent).toContain('/downloads');
    await act(async () => row.click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Save Path"]')!;
    expect(input.value).toBe('/downloads');
    await type(input, '/downloads/movies');
    await act(async () => input.form!.requestSubmit());
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Moving to the new location'));

    expect(posts).toEqual([{ hash: 'abc', action: 'setLocation', location: '/downloads/movies' }]);
    // The toast can come before the page re-renders with the new path.
    await waitFor(() => expect(document.body.textContent).toContain('Save Path/downloads/movies'));
    // qBittorrent turns automatic management off when it moves a torrent.
    await waitFor(() => expect(option('Auto Torrent Management').getAttribute('aria-checked')).toBe('false'));
  });

  it('removes a tag, adds a new one, and adds one qBittorrent already has', async () => {
    await renderPage();
    await act(async () => button('Remove tag movies').click());
    await waitFor(() => expect(document.body.textContent).toContain('No tags'));

    const input = document.querySelector<HTMLInputElement>('input[aria-label="New tag"]')!;
    await type(input, 'a,b');
    await act(async () => input.form!.requestSubmit());
    expect(mocks.toast.error).toHaveBeenCalledWith("A tag can't contain a comma");

    await type(input, ' fresh ');
    await act(async () => input.form!.requestSubmit());
    await waitFor(() => expect(button('Remove tag fresh')).not.toBeNull());
    await waitFor(() => expect(button('Add tag 4k')).not.toBeNull());
    await act(async () => button('Add tag 4k').click());
    await waitFor(() => expect(button('Remove tag 4k')).not.toBeNull());

    expect(posts).toEqual([
      { hash: 'abc', action: 'removeTags', tags: ['movies'] },
      { hash: 'abc', action: 'addTags', tags: ['fresh'] },
      { hash: 'abc', action: 'addTags', tags: ['4k'] },
    ]);
  });

  it('moves the torrent in the queue and shows its position', async () => {
    await renderPage();
    expect(document.body.textContent).toContain('Position2');
    await act(async () => button('Move to the top of the queue').click());
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Moved to the top of the queue'));

    expect(posts).toEqual([{ hash: 'abc', action: 'topPrio' }]);
  });

  it('turns the queue moves off, and says why, while queueing is off in qBittorrent', async () => {
    options = { tags: [], queueingEnabled: false };
    await renderPage();
    await waitFor(() => expect(document.body.textContent).toContain('Queueing is off in qBittorrent.'));

    for (const label of ['Move to the top of the queue', 'Move up the queue', 'Move down the queue', 'Move to the bottom of the queue']) {
      expect(button(label).disabled).toBe(true);
    }
  });

  it('shows only the sections the user may change', async () => {
    mocks.caps = new Set(['torrents.manage']);
    await renderPage();

    expect(document.body.textContent).not.toContain('Speed Limits');
    expect(option('Sequential Download')).not.toBeNull();
    expect(document.body.textContent).toContain('Location');
  });

  it('explains when the user may change nothing', async () => {
    mocks.caps = new Set();
    await renderPage();

    expect(document.body.textContent).toContain("You don't have permission to change torrent settings.");
    expect(document.querySelector('[role="switch"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Save Path');
    expect(document.body.textContent).not.toContain('Queue');
  });

  it('says so when the torrent is no longer in qBittorrent', async () => {
    torrents = [];
    await renderPage();

    expect(document.body.textContent).toContain('This torrent is no longer in qBittorrent.');
  });
});
