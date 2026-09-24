// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  toast: { success: vi.fn(), error: vi.fn() },
  ui: { hasHydrated: true, torrentsView: 'card', setTorrentsView: vi.fn() },
  handleAuthError: vi.fn(),
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn().mockResolvedValue(60_000) }));
vi.mock('@/lib/store', () => ({ useUIStore: (select: (state: typeof mocks.ui) => unknown) => select(mocks.ui) }));
vi.mock('@/lib/query-client', () => ({ handleAuthError: mocks.handleAuthError }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
import { ApiError } from '@/lib/query-fetch';
import QBittorrentSettingsPage from './page';

const TRANSFER = {
  dl_info_speed: 0, dl_info_data: 2.7 * 1024 ** 3, up_info_speed: 0, up_info_data: 634.3 * 1024 ** 2,
  dl_rate_limit: 0, up_rate_limit: 0, dht_nodes: 365, connection_status: 'connected',
};

let root: Root;
let queryClient: QueryClient;
let limitReads: (object | Response)[];
let limitGets: number;
let posts: Record<string, unknown>[];
let postResponse: (body: Record<string, unknown>) => Promise<Response>;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.bandwidth']);
  mocks.ui.torrentsView = 'card';
  limitReads = [{ downloadLimit: 0, uploadLimit: 0, speedLimitsMode: 0 }];
  limitGets = 0;
  posts = [];
  postResponse = async () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/qbittorrent/transfer') return Response.json(TRANSFER);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return postResponse(body);
    }
    // Each limits read takes the next queued answer; the last one repeats.
    limitGets++;
    const next = limitReads.length > 1 ? limitReads.shift()! : limitReads[0];
    return next instanceof Response ? next : Response.json(next);
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
  await act(async () => root.render(<QueryClientProvider client={queryClient}><QBittorrentSettingsPage /></QueryClientProvider>));
  await waitFor(() => expect(document.body.textContent).toContain('Session Downloaded'));
}
const altSwitch = () => document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Alternative Speed Limits"]');
const rowText = (label: string) =>
  [...document.querySelectorAll('.grouped-row')].find((el) => el.textContent?.startsWith(label))?.textContent;

describe('qBittorrent settings page', () => {
  it('shows the transfer stats', async () => {
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());

    expect(rowText('Session Downloaded')).toBe('Session Downloaded2.7 GB');
    expect(rowText('Session Uploaded')).toBe('Session Uploaded634.3 MB');
    expect(rowText('Connection Status')).toBe('Connection Statusconnected');
  });

  it("flips alternative limits at once, then shows that mode's limits", async () => {
    // First read before the toggle; qBittorrent then reports the alternative
    // limits, which are the ones in force once the mode is on.
    limitReads = [
      { downloadLimit: 0, uploadLimit: 0, speedLimitsMode: 0 },
      { downloadLimit: 102400, uploadLimit: 51200, speedLimitsMode: 1 },
    ];
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());

    await act(async () => altSwitch()!.click());
    await waitFor(() => expect(altSwitch()!.getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(rowText('Global Download Limit')).toContain('100 KB/s'));

    expect(posts).toEqual([{ action: 'toggleSpeedLimitsMode' }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('Alternative speed mode toggled');
    expect(rowText('Global Upload Limit')).toContain('50 KB/s');
    expect(altSwitch()!.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the optimistic mode while qBittorrent still reports the old one', async () => {
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());
    await waitFor(() => expect(altSwitch()!.getAttribute('aria-checked')).toBe('true'));

    // Wait for a confirmation re-read, which still says mode 0: the switch
    // must not bounce back.
    await waitFor(() => expect(limitGets).toBeGreaterThanOrEqual(2));
    await wait(20);
    expect(altSwitch()!.getAttribute('aria-checked')).toBe('true');
  });

  it('shows what qBittorrent reports if it never confirms the new mode', async () => {
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());

    // One initial read plus five confirmation reads, all still saying mode 0.
    await waitFor(() => expect(limitGets).toBe(6), 4000);
    await waitFor(() => expect(altSwitch()!.getAttribute('aria-checked')).toBe('false'));
  });

  it('sends a 401 from the confirmation read to the login redirect', async () => {
    limitReads = [
      { downloadLimit: 0, uploadLimit: 0, speedLimitsMode: 0 },
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    ];
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());

    await waitFor(() => expect(mocks.handleAuthError).toHaveBeenCalledTimes(1));
    const [error] = mocks.handleAuthError.mock.calls[0];
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });

  it('retries a confirmation read that fails', async () => {
    limitReads = [
      { downloadLimit: 0, uploadLimit: 0, speedLimitsMode: 0 },
      Response.json({ error: 'upstream' }, { status: 502 }),
      { downloadLimit: 102400, uploadLimit: 51200, speedLimitsMode: 1 },
    ];
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());

    await waitFor(() => expect(rowText('Global Download Limit')).toContain('100 KB/s'));
    expect(altSwitch()!.getAttribute('aria-checked')).toBe('true');
    expect(mocks.handleAuthError).not.toHaveBeenCalled();
  });

  it('keeps a limit saved while a failing toggle was in flight', async () => {
    let failToggle!: () => void;
    postResponse = (body) => body.action === 'toggleSpeedLimitsMode'
      ? new Promise((done) => { failToggle = () => done(Response.json({ error: 'nope' }, { status: 502 })); })
      : Promise.resolve(Response.json({ success: true }));
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());

    const row = [...document.querySelectorAll<HTMLButtonElement>('button.grouped-row')]
      .find((el) => el.textContent?.startsWith('Global Upload Limit'))!;
    await act(async () => row.click());
    const input = document.querySelector('form input') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, '2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector('form')!.requestSubmit());
    await waitFor(() => expect(rowText('Global Upload Limit')).toContain('2 MB/s'));

    await act(async () => failToggle());
    await waitFor(() => expect(altSwitch()!.getAttribute('aria-checked')).toBe('false'));
    expect(rowText('Global Upload Limit')).toContain('2 MB/s');
  });

  it('restores the switch when the toggle fails', async () => {
    postResponse = async () => Response.json({ error: 'nope' }, { status: 502 });
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Failed to toggle speed mode'));

    await waitFor(() => expect(altSwitch()!.getAttribute('aria-checked')).toBe('false'));
  });

  it('saves a global limit', async () => {
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    const row = [...document.querySelectorAll<HTMLButtonElement>('button.grouped-row')]
      .find((el) => el.textContent?.startsWith('Global Download Limit'))!;
    await act(async () => row.click());
    const input = document.querySelector('form input') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, '100');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => document.querySelector('form')!.requestSubmit());
    await waitFor(() => expect(rowText('Global Download Limit')).toContain('100 MB/s'));

    expect(posts).toEqual([{ action: 'setDownloadLimit', limit: 100 * 1024 * 1024 }]);
  });

  it('shows the limits read-only without the bandwidth permission', async () => {
    mocks.caps = new Set();
    await renderPage();
    await waitFor(() => expect(rowText('Alternative Speed Limits')).toBe('Alternative Speed LimitsOff'));

    expect(altSwitch()).toBeNull();
    expect(document.querySelector('button.grouped-row')).toBeNull();
    expect(rowText('Global Download Limit')).toBe('Global Download LimitUnlimited');
    expect(rowText('Alternative Speed Limits')).toBe('Alternative Speed LimitsOff');
  });

  it('switches the torrent list to the table view', async () => {
    await renderPage();
    await act(async () => document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Table View"]')!.click());

    expect(mocks.ui.setTorrentsView).toHaveBeenCalledWith('table');
  });
});
