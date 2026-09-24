// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  router: { back: vi.fn(), push: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => mocks.router }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
import BulkSpeedLimitsPage from './page';
import { setSpeedLimitTargets, type SpeedLimitTarget } from '../_components/speed-limit-targets';

const target = (hash: string, dl_limit = 0, up_limit = 0): SpeedLimitTarget => ({ hash, name: `Release ${hash}`, dl_limit, up_limit });

let root: Root;
let queryClient: QueryClient;
let posts: Record<string, unknown>[];
let postResponse: () => Promise<Response>;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.bandwidth']);
  setSpeedLimitTargets([]);
  posts = [];
  postResponse = async () => Response.json({ success: true });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body)));
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
const renderPage = () =>
  act(async () => root.render(<QueryClientProvider client={queryClient}><BulkSpeedLimitsPage /></QueryClientProvider>));
const rowText = (label: string) =>
  [...document.querySelectorAll('.grouped-row')].find((el) => el.textContent?.startsWith(label))?.textContent;
async function saveLimit(label: string, value: string) {
  const row = [...document.querySelectorAll<HTMLButtonElement>('button.grouped-row')]
    .find((el) => el.textContent?.startsWith(label))!;
  await act(async () => row.click());
  const input = document.querySelector('form input') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => document.querySelector('form')!.requestSubmit());
}

describe('bulk speed limits page', () => {
  it('lists the selected torrents and the limit they share', async () => {
    setSpeedLimitTargets([target('a', 1024 * 1024), target('b', 1024 * 1024)]);
    await renderPage();

    expect(document.body.textContent).toContain('2 torrents');
    expect(document.body.textContent).toContain('Release a');
    expect(document.body.textContent).toContain('Release b');
    expect(rowText('Download Limit')).toContain('1 MB/s');
    // qBittorrent reports "no limit" as 0 or -1; both are unlimited.
    expect(rowText('Upload Limit')).toContain('Unlimited');
  });

  it('shows Mixed when the selected torrents disagree', async () => {
    setSpeedLimitTargets([target('a', 0, -1), target('b', 512 * 1024, 0)]);
    await renderPage();

    expect(rowText('Download Limit')).toContain('Mixed');
    expect(rowText('Upload Limit')).toContain('Unlimited');
  });

  it('sets the limit on every selected torrent and stays for the other one', async () => {
    setSpeedLimitTargets([target('a'), target('b', 0, 2048)]);
    await renderPage();
    await saveLimit('Download Limit', '2');
    await waitFor(() => expect(rowText('Download Limit')).toContain('2 MB/s'));

    expect(posts).toEqual([{ hash: 'a|b', action: 'setDownloadLimit', limit: 2 * 1024 * 1024 }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('Download Limit updated for 2 torrents');
    expect(mocks.router.back).not.toHaveBeenCalled();
    expect(rowText('Upload Limit')).toContain('Mixed');
  });

  it("keeps the old value and shows qBittorrent's error when it refuses", async () => {
    postResponse = async () => Response.json({ error: 'qBittorrent is unreachable' }, { status: 502 });
    setSpeedLimitTargets([target('a')]);
    await renderPage();
    await saveLimit('Upload Limit', '1');
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('qBittorrent is unreachable'));

    expect(document.querySelector('form')).not.toBeNull();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('shows how many more are selected than it lists', async () => {
    setSpeedLimitTargets(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((hash) => target(hash)));
    await renderPage();

    expect(document.body.textContent).toContain('Release e');
    expect(document.body.textContent).not.toContain('Release f');
    expect(document.body.textContent).toContain('and 2 more');
  });

  it('sends the user back to pick torrents after a reload lost the selection', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('No torrents selected.');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((el) => el.textContent === 'Choose torrents')!.click());
    expect(mocks.router.push).toHaveBeenCalledWith('/torrents');
  });

  it('explains when the user may not change speed limits', async () => {
    mocks.caps = new Set();
    setSpeedLimitTargets([target('a')]);
    await renderPage();

    expect(document.body.textContent).toContain("You don't have permission to change speed limits.");
    expect(document.querySelector('button.grouped-row')).toBeNull();
  });
});
