// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  toast: { success: vi.fn(), error: vi.fn() },
  ui: { hasHydrated: true, torrentsView: 'auto', setTorrentsView: vi.fn() },
  handleAuthError: vi.fn(),
  me: null as null | { role: string },
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap), useMe: () => mocks.me }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn().mockResolvedValue(60_000) }));
vi.mock('@/lib/store', () => ({ useUIStore: (select: (state: typeof mocks.ui) => unknown) => select(mocks.ui) }));
vi.mock('@/lib/query-client', () => ({ handleAuthError: mocks.handleAuthError }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
// Native stand-in: Radix Select needs pointer APIs jsdom lacks.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="Layout" value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
import { ApiError } from '@/lib/query-fetch';
import QBittorrentSettingsPage from './page';

const LIMITS = { downloadLimit: 0, uploadLimit: 0, altDownloadLimit: 307200, altUploadLimit: 102400 };
const TRANSFER = {
  dl_info_speed: 0, dl_info_data: 2.7 * 1024 ** 3, up_info_speed: 0, up_info_data: 634.3 * 1024 ** 2,
  dl_rate_limit: 0, up_rate_limit: 0, dht_nodes: 365, connection_status: 'connected',
};

const STATS = { freeSpaceOnDisk: 512 * 1024 ** 3, alltimeDownloaded: 1.5 * 1024 ** 4, alltimeUploaded: 3 * 1024 ** 4, globalRatio: 2 };

let root: Root;
let queryClient: QueryClient;
let stats: () => Response;
let limitReads: (object | Response)[];
let limitGets: number;
let posts: Record<string, unknown>[];
let postResponse: (body: Record<string, unknown>) => Promise<Response>;
let queueSeeding: Record<string, unknown>;
let queuePatches: Record<string, unknown>[];
const QUEUE_SEEDING = {
  queueing_enabled: true, max_active_downloads: 3, max_active_uploads: -1, max_active_torrents: 5, dont_count_slow_torrents: false,
  max_ratio_enabled: true, max_ratio: 2, max_seeding_time_enabled: false, max_seeding_time: -1,
  max_inactive_seeding_time_enabled: false, max_inactive_seeding_time: -1, max_ratio_act: 0,
};

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.bandwidth']);
  mocks.ui.torrentsView = 'auto';
  mocks.me = null;
  queueSeeding = { ...QUEUE_SEEDING };
  queuePatches = [];
  limitReads = [{ ...LIMITS, speedLimitsMode: 0 }];
  limitGets = 0;
  posts = [];
  postResponse = async () => Response.json({ success: true });
  stats = () => Response.json(STATS);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/qbittorrent/transfer') return Response.json(TRANSFER);
    if (url === '/api/qbittorrent/transfer/stats') return stats();
    if (url === '/api/qbittorrent/queue-seeding') {
      if (init?.method === 'PATCH') {
        queuePatches.push(JSON.parse(String(init.body)));
        return Response.json({ success: true });
      }
      return Response.json(queueSeeding);
    }
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
// Opens a limit row's editor, types a value in the unit it opens with (MB/s, or KB/s
// for a limit under 1 MB/s) and saves.
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

describe('qBittorrent settings page', () => {
  it('shows the transfer stats', async () => {
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());

    expect(rowText('Session Downloaded')).toBe('Session Downloaded2.7 GB');
    expect(rowText('Session Uploaded')).toBe('Session Uploaded634.3 MB');
    expect(rowText('Connection Status')).toBe('Connection Statusconnected');
    await waitFor(() => expect(rowText('Free Disk Space')).toBe('Free Disk Space512 GB'));
    expect(rowText('All-time Downloaded')).toBe('All-time Downloaded1.5 TB');
    expect(rowText('All-time Uploaded')).toBe('All-time Uploaded3 TB');
    expect(rowText('Global Ratio')).toBe('Global Ratio2.00');
  });

  it("says what qBittorrent can't tell, and when the stats can't be read", async () => {
    stats = () => Response.json({ ...STATS, freeSpaceOnDisk: null });
    await renderPage();
    await waitFor(() => expect(rowText('Free Disk Space')).toBe('Free Disk SpaceUnknown'));
    expect(rowText('Session Downloaded')).toBe('Session Downloaded2.7 GB');

    queryClient.clear();
    await act(async () => root.unmount());
    root = createRoot(document.getElementById('root')!);
    stats = () => Response.json({ error: 'Failed' }, { status: 500 });
    await renderPage();
    await waitFor(() => expect(rowText('All-time Uploaded')).toBe('All-time UploadedUnavailable'));
    // The session stats come from their own read and still show.
    expect(rowText('Session Uploaded')).toBe('Session Uploaded634.3 MB');
  });

  it('flips alternative mode at once and keeps both sets of limits', async () => {
    // Global and alternative limits are separate preferences: the mode decides
    // which set qBittorrent uses, not what either row shows.
    limitReads = [
      { ...LIMITS, downloadLimit: 1048576, speedLimitsMode: 0 },
      { ...LIMITS, downloadLimit: 1048576, speedLimitsMode: 1 },
    ];
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());

    await act(async () => altSwitch()!.click());
    await waitFor(() => expect(altSwitch()!.getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(limitGets).toBe(2));
    await wait(20);

    expect(posts).toEqual([{ action: 'toggleSpeedLimitsMode' }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('Alternative speed mode toggled');
    expect(rowText('Global Download Limit')).toContain('1 MB/s');
    expect(rowText('Global Upload Limit')).toContain('Unlimited');
    expect(rowText('Alternative Download Limit')).toContain('300 KB/s');
    expect(rowText('Alternative Upload Limit')).toContain('100 KB/s');
    expect(altSwitch()!.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps an alternative limit saved while the toggle was being confirmed', async () => {
    // The confirming read left before the save landed: it has the new mode
    // but the old limit.
    limitReads = [{ ...LIMITS, speedLimitsMode: 0 }, { ...LIMITS, speedLimitsMode: 1 }];
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());

    await saveLimit('Alternative Download Limit', '2');
    await waitFor(() => expect(rowText('Alternative Download Limit')).toContain('2 KB/s'));
    await waitFor(() => expect(limitGets).toBe(2));
    await wait(20);

    expect(rowText('Alternative Download Limit')).toContain('2 KB/s');
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
      { ...LIMITS, speedLimitsMode: 0 },
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
      { ...LIMITS, speedLimitsMode: 0 },
      Response.json({ error: 'upstream' }, { status: 502 }),
      { ...LIMITS, speedLimitsMode: 1 },
    ];
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await act(async () => altSwitch()!.click());

    // The third read confirms the mode, so no fourth one is made.
    await waitFor(() => expect(limitGets).toBe(3));
    await wait(500);
    expect(limitGets).toBe(3);
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
    await saveLimit('Global Download Limit', '100');
    await waitFor(() => expect(rowText('Global Download Limit')).toContain('100 MB/s'));

    expect(posts).toEqual([{ action: 'setDownloadLimit', limit: 100 * 1024 * 1024 }]);
    expect(rowText('Alternative Download Limit')).toContain('300 KB/s');
  });

  it.each([
    ['Alternative Download Limit', 'setAltDownloadLimit', 'Global Download Limit'],
    ['Alternative Upload Limit', 'setAltUploadLimit', 'Global Upload Limit'],
  ])('saves the %s without touching the global one', async (label, action, globalLabel) => {
    await renderPage();
    await waitFor(() => expect(altSwitch()).not.toBeNull());
    await saveLimit(label, '5');
    // 300 KB/s and 100 KB/s are under 1 MB/s, so the editor opens in KB/s.
    await waitFor(() => expect(rowText(label)).toContain('5 KB/s'));

    expect(posts).toEqual([{ action, limit: 5 * 1024 }]);
    expect(rowText(globalLabel)).toContain('Unlimited');
  });

  it('shows the limits read-only without the bandwidth permission', async () => {
    mocks.caps = new Set();
    await renderPage();
    await waitFor(() => expect(rowText('Alternative Speed Limits')).toBe('Alternative Speed LimitsOff'));

    expect(altSwitch()).toBeNull();
    expect(document.querySelector('button.grouped-row')).toBeNull();
    expect(rowText('Global Download Limit')).toBe('Global Download LimitUnlimited');
    expect(rowText('Alternative Speed Limits')).toBe('Alternative Speed LimitsOff');
    expect(rowText('Alternative Download Limit')).toBe('Alternative Download Limit300 KB/s');
    expect(rowText('Alternative Upload Limit')).toBe('Alternative Upload Limit100 KB/s');
  });

  it('switches the torrent list layout and can return to automatic', async () => {
    await renderPage();
    const layout = document.querySelector<HTMLSelectElement>('select[aria-label="Layout"]')!;
    expect(layout.value).toBe('auto');

    for (const view of ['table', 'auto']) {
      await act(async () => {
        layout.value = view;
        layout.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(mocks.ui.setTorrentsView).toHaveBeenLastCalledWith(view);
    }
  });

  describe('queueing and seeding limits (QBT-25)', () => {
    const queueSwitch = () => document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Torrent Queueing"]');

    it('shows them read-only to a member, with no controls', async () => {
      await renderPage();
      await waitFor(() => expect(rowText('Torrent Queueing')).toBe('Torrent QueueingOn'));
      expect(queueSwitch()).toBeNull();
      expect(rowText('Max Active Downloads')).toBe('Max Active Downloads3');
      expect(rowText('Max Active Uploads')).toBe('Max Active UploadsNo limit');
      expect(rowText('Ratio Limit')).toBe('Ratio Limit2');
      expect(rowText('Seeding Time Limit')).toBe('Seeding Time LimitUnlimited');
      expect(rowText('Then')).toBe('ThenStop torrent');
    });

    it('turns queueing off for an admin, hides the counts and refreshes the queue buttons', async () => {
      mocks.me = { role: 'admin' };
      await renderPage();
      await waitFor(() => expect(queueSwitch()).not.toBeNull());
      queryClient.setQueryData(['qbittorrent', 'options'], { tags: [], queueingEnabled: true });
      await act(async () => queueSwitch()!.click());
      await waitFor(() => expect(queuePatches).toEqual([{ queueing_enabled: false }]));
      await waitFor(() => expect(queueSwitch()!.getAttribute('aria-checked')).toBe('false'));
      expect(rowText('Max Active Downloads')).toBeUndefined();
      expect(queryClient.getQueryState(['qbittorrent', 'options'])?.isInvalidated).toBe(true);
    });

    it('saves a count for an admin', async () => {
      mocks.me = { role: 'admin' };
      await renderPage();
      await waitFor(() => expect(queueSwitch()).not.toBeNull());
      await saveLimit('Max Active Downloads', '8');
      await waitFor(() => expect(queuePatches).toEqual([{ max_active_downloads: 8 }]));
      await waitFor(() => expect(rowText('Max Active Downloads')).toContain('8'));
    });

    it('asks before removing torrents with their files when a limit is reached', async () => {
      mocks.me = { role: 'admin' };
      await renderPage();
      await waitFor(() => expect(queueSwitch()).not.toBeNull());
      const action = [...document.querySelectorAll<HTMLSelectElement>('select')].find((el) => [...el.options].some((o) => o.text === 'Remove torrent and its files'))!;
      await act(async () => {
        action.value = '3';
        action.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(() => expect(document.body.textContent).toContain('Remove torrents and their files?'));
      expect(queuePatches).toEqual([]);
      const confirm = [...document.querySelectorAll('button')].find((el) => el.textContent === 'Remove with files')!;
      await act(async () => confirm.click());
      await waitFor(() => expect(queuePatches).toEqual([{ max_ratio_act: 3 }]));
    });
  });
});
