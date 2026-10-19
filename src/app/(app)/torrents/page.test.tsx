// @vitest-environment jsdom
// Characterization tests for the torrents page: what it lists and what it sends,
// with real queries over a stubbed fetch. Written before the page is split into
// smaller modules (Workstream 15).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  mobile: true,
  push: vi.fn(),
  adjustBadge: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  sent: [] as Array<{ path: string; body: Record<string, unknown> }>,
  asked: [] as string[],
  summary: (() => new Response('{}')) as (url: URL) => Response | Promise<Response>,
  action: (() => Response.json({ success: true })) as (body: Record<string, unknown>) => Response,
}));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/components/layout/badge-provider', () => ({ useBadgeActions: () => ({ adjustBadge: mocks.adjustBadge }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: vi.fn(async () => 60_000) }));
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => mocks.mobile }));
vi.mock('@/lib/hooks/use-search-history', () => ({ useSearchHistory: () => ({ recent: [], add: vi.fn(), remove: vi.fn() }) }));
vi.mock('@/components/ui/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('@/components/ui/swipe-row', () => ({ SwipeRow: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DrawerContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DrawerFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// Menus as plain buttons: the trigger's own button, then the items.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button type="button" role="menuitem" onClick={onClick}>{children}</button>,
  DropdownMenuCheckboxItem: ({ children, checked, onCheckedChange }: { children: React.ReactNode; checked?: boolean; onCheckedChange?: () => void }) => (
    <button type="button" role="menuitemcheckbox" aria-checked={!!checked} onClick={onCheckedChange}>{children}</button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  DropdownMenuSeparator: () => <hr />,
}));
type MockAction = { id: string; label: string; onSelect?: () => void };
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children, label, groups }: { children: React.ReactNode; label: string; groups?: Array<{ actions: MockAction[] }> }) => (
    <>
      {children}
      <div role="group" aria-label={label}>
        {(groups ?? []).flatMap((group) => group.actions).map((action) => (
          <button key={action.id} type="button" onClick={action.onSelect}>{action.label}</button>
        ))}
      </div>
    </>
  ),
}));
// The table as a plain table: sortable headers and each row's cells, wrapped as the page wraps them.
type MockColumn = { id: string; label: React.ReactNode; sortKey?: string; cell: (row: unknown) => React.ReactNode };
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ columns, rows, rowKey, onSort, wrapRow }: {
    columns: MockColumn[]; rows: unknown[]; rowKey: (row: unknown) => string; onSort: (key: string) => void;
    wrapRow: (row: unknown, tr: React.ReactElement) => React.ReactNode;
  }) => (
    <table>
      <thead><tr>{columns.map((column) => <th key={column.id}>{column.sortKey ? <button type="button" onClick={() => onSort(column.sortKey!)}>{column.label}</button> : column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tbody key={rowKey(row)}>{wrapRow(row, <tr>{columns.map((column) => <td key={column.id}>{column.cell(row)}</td>)}</tr>)}</tbody>)}</tbody>
    </table>
  ),
}));
// A real (unpersisted) zustand store with just the torrents slice.
vi.mock('@/lib/store', async () => {
  const { create } = await import('zustand');
  const useUIStore = create<Record<string, unknown>>((set) => ({
    hasHydrated: true,
    torrentsFilter: [],
    setTorrentsFilter: (torrentsFilter: string[]) => set({ torrentsFilter }),
    torrentsSortKey: 'name',
    setTorrentsSortKey: (torrentsSortKey: string) => set({ torrentsSortKey }),
    torrentsSortDir: 'asc',
    setTorrentsSortDir: (torrentsSortDir: string) => set({ torrentsSortDir }),
    torrentsView: 'auto',
  }));
  return { useUIStore };
});

import { useUIStore } from '@/lib/store';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import TorrentsPage from './page';
import { getSpeedLimitTargets } from './_components/speed-limit-targets';

const torrent = (hash: string, name: string, extra: Record<string, unknown> = {}) => ({
  hash, name, size: 1024 ** 3, progress: 1, dlspeed: 0, upspeed: 0, num_seeds: 3, num_leechs: 1, state: 'stalledUP', eta: 8640000,
  category: '', tags: '', added_on: 100, completion_on: 200, save_path: '/data', ratio: 1.5, downloaded: 1024 ** 3, uploaded: 512,
  amount_left: 0, priority: 0, time_active: 10, seeding_time: 5, dl_limit: 0, up_limit: 0, availability: -1,
  downloaded_session: 0, uploaded_session: 0, seq_dl: false, f_l_piece_prio: false, auto_tmm: true, magnet_uri: `magnet:?xt=urn:btih:${hash}`,
  ...extra,
});
const ALPHA = torrent('aaa', 'Alpha.Movie', { state: 'downloading', progress: 0.5, dlspeed: 1024 * 1024, eta: 120, amount_left: 512 * 1024 ** 2, category: 'radarr', size: 2 * 1024 ** 3 });
const BRAVO = torrent('bbb', 'Bravo.Show', { ratio: 2.5, size: 3 * 1024 ** 3 });
const CHARLIE = torrent('ccc', 'Charlie', { state: 'stoppedDL', progress: 0.2, size: 1024 ** 2 });
const TRANSFER = { dl_info_speed: 2048, up_info_speed: 1024, dl_info_data: 0, up_info_data: 0, connection_status: 'connected' };
const full = (torrents: unknown[], speedLimitsMode = 0) => Response.json({
  cursor: `c${Math.random()}`, reset: true, changed: torrents, removed: [], order: (torrents as Array<{ hash: string }>).map((t) => t.hash),
  transferInfo: TRANSFER, speedLimitsMode,
});

class ResizeObserverStub { observe() {} disconnect() {} unobserve() {} }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caps = new Set(['torrents.manage', 'torrents.delete', 'torrents.bandwidth', 'torrents.add', 'activity.view']);
  mocks.mobile = true;
  mocks.sent = [];
  mocks.asked = [];
  mocks.summary = () => full([ALPHA, BRAVO, CHARLIE]);
  mocks.action = () => Response.json({ success: true });
  window.sessionStorage.clear();
  resetRouteViewStateForTests();
  useUIStore.setState({ torrentsFilter: [], torrentsSortKey: 'name', torrentsSortDir: 'asc', torrentsView: 'auto' });
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://helprr.test');
    const method = init?.method ?? 'GET';
    if (method === 'GET') mocks.asked.push(`${url.pathname}${url.search}`);
    else mocks.sent.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.pathname === '/api/qbittorrent/summary') return mocks.summary(url);
    if (url.pathname === '/api/qbittorrent' && method === 'POST') return mocks.action(JSON.parse(String(init!.body)));
    if (url.pathname === '/api/qbittorrent/categories') return Response.json({ tv: { name: 'tv', savePath: '/data/tv' }, radarr: { name: 'radarr', savePath: '' } });
    if (url.pathname === '/api/qbittorrent/transfer/limits') return Response.json({ success: true });
    if (url.pathname === '/api/qbittorrent/aaa/details') {
      return Response.json({
        properties: { total_size: 2 * 1024 ** 3, total_downloaded: 1024 ** 3, total_uploaded: 0, share_ratio: 0.25, dl_speed: 1024 * 1024, up_speed: 0, dl_limit: 0, up_limit: 0,
          addition_date: 0, completion_date: 0, seeding_time: 0, time_elapsed: 3700, seeds: 4, seeds_total: 9, peers: 2, peers_total: 5, nb_connections: 6, total_wasted: 0, save_path: '/data/movies' },
        files: Array.from({ length: 6 }, (_, index) => ({ index, name: `Alpha.Movie/part${index + 1}.mkv`, size: 1024 ** 2, progress: 0.5 })),
        trackers: [{ url: 'http://tracker.example/announce', num_seeds: 4, num_leeches: 2, msg: '' }, { url: '** [DHT] **', num_seeds: 0, num_leeches: 0, msg: '' }],
      });
    }
    return Response.json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><TorrentsPage /></QueryClientProvider>);
  return { user, client };
}
const names = () => screen.queryAllByRole('button', { name: /^(Alpha\.Movie|Bravo\.Show|Charlie)$/ }).map((button) => button.textContent);
const actionsFor = (name: string) => within(screen.getAllByRole('group', { name: `Actions for ${name}` })[0]);
const posted = () => mocks.sent.filter((sent) => sent.path === '/api/qbittorrent').map((sent) => sent.body);

describe('torrents page (characterization)', () => {
  it('lists the torrents with their state, size, progress, speeds and the totals', async () => {
    renderPage();
    await waitFor(() => expect(names()).toEqual(['Alpha.Movie', 'Bravo.Show', 'Charlie']));
    expect(screen.getByText('3 torrents')).toBeTruthy();
    const alpha = screen.getByRole('button', { name: 'Alpha.Movie' }).closest('.px-3')! as HTMLElement;
    for (const text of ['Downloading', '2 GB', 'radarr', '50.0%', 'ETA: 2m 0s', 'Seeds: 3', 'Peers: 1', 'Ratio: 1.50', 'Rem: 512 MB']) {
      expect(within(alpha).getByText((_, node) => node?.textContent === text || node?.textContent?.trim() === text)).toBeTruthy();
    }
    expect(within(alpha).getByText(/1 MB\/s/)).toBeTruthy();
    expect(screen.getAllByText('Seeding').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Stopped').length).toBeGreaterThan(0);
    expect(screen.getByText('2 KB/s')).toBeTruthy();
    expect(screen.getByText('1 KB/s')).toBeTruthy();
    expect(mocks.asked[0]).toBe('/api/qbittorrent/summary?view=delta');
  });

  it('filters by state and by search, and says so when nothing matches', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Downloading' }));
    await waitFor(() => expect(names()).toEqual(['Alpha.Movie']));
    expect(mocks.asked.some((path) => path === '/api/qbittorrent/summary?filter=downloading&view=delta')).toBe(true);
    expect(screen.getByRole('button', { name: /^Filter: Downloading/ })).toBeTruthy();

    await user.type(screen.getByPlaceholderText('Search torrents...'), 'zzz');
    expect(await screen.findByText('No torrents match your search and filters.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear search & filters' }));
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(useUIStore.getState().torrentsFilter).toEqual([]);
  });

  it('sorts from the menu: a new key takes its natural direction, the active key flips', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Size' }));
    await waitFor(() => expect(names()).toEqual(['Bravo.Show', 'Alpha.Movie', 'Charlie']));
    expect(useUIStore.getState()).toEqual(expect.objectContaining({ torrentsSortKey: 'size', torrentsSortDir: 'desc' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Size/ }));
    await waitFor(() => expect(names()).toEqual(['Charlie', 'Alpha.Movie', 'Bravo.Show']));
  });

  it('starts a torrent at once, and holds that against a poll that still reports it stopped', async () => {
    const { user, client } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(actionsFor('Charlie').getByRole('button', { name: 'Start' }));
    expect(posted()).toEqual([{ hash: 'ccc', action: 'start' }]);
    const charlie = () => screen.getByRole('button', { name: 'Charlie' }).closest('.px-3')! as HTMLElement;
    await waitFor(() => expect(within(charlie()).getByText('Downloading')).toBeTruthy());
    expect(mocks.toast.success).toHaveBeenCalledWith('Started');

    await act(() => client.refetchQueries({ queryKey: ['torrents'] }));
    expect(within(charlie()).getByText('Downloading')).toBeTruthy();
  });

  it('puts the row back when qBittorrent refuses the action', async () => {
    mocks.action = () => Response.json({ error: 'qBittorrent said no' }, { status: 500 });
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(actionsFor('Charlie').getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('qBittorrent said no'));
    expect(within(screen.getByRole('button', { name: 'Charlie' }).closest('.px-3')! as HTMLElement).getByText('Stopped')).toBeTruthy();
  });

  it('selects torrents and acts on them together', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha.Movie' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Bravo.Show' }));
    const bulk = screen.getByText('2').parentElement!;
    await user.click(within(bulk).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(posted()).toEqual([{ hash: 'aaa|bbb', action: 'stop' }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull());

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Speed Limits' }));
    expect(mocks.push).toHaveBeenCalledWith('/torrents/speed-limits');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('deletes through the drawer, with the files only when asked, and takes the row off the badge', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(actionsFor('Alpha.Movie').getByRole('button', { name: 'Delete (keep files)' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Delete Torrent' })).toBeTruthy();
    expect(within(drawer).getByText('Are you sure you want to delete “Alpha.Movie”?')).toBeTruthy();
    expect(within(drawer).queryByText(/permanently delete/)).toBeNull();
    await user.click(within(drawer).getByRole('checkbox'));
    expect(within(drawer).getByText('Warning: This will permanently delete the downloaded files from disk.')).toBeTruthy();
    await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted()).toEqual([{ hash: 'aaa', action: 'delete', deleteFiles: true }]);
    expect(names()).toEqual(['Bravo.Show', 'Charlie']);
    expect(mocks.adjustBadge).toHaveBeenCalledWith('downloads', -1, -0);

    // Several selected: the drawer names how many.
    await user.click(screen.getByRole('checkbox', { name: 'Select Bravo.Show' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Charlie' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(within(screen.getByRole('dialog')).getByText('Are you sure you want to delete “2 torrents”?')).toBeTruthy();
  });

  it('sets a category from the picker', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(actionsFor('Bravo.Show').getByRole('button', { name: 'Set Category' }));
    const drawer = screen.getByRole('dialog');
    expect(await within(drawer).findByText('/data/tv')).toBeTruthy();
    expect(within(drawer).getByText('None')).toBeTruthy();
    await user.click(within(drawer).getByRole('button', { name: /^tv/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted()).toEqual([{ hash: 'bbb', action: 'setCategory', category: 'tv' }]);
    expect(within(screen.getByRole('button', { name: 'Bravo.Show' }).closest('.px-3')! as HTMLElement).getByText('tv')).toBeTruthy();
  });

  it("shows a torrent's details, with links to its settings and files", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Alpha.Movie' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Alpha.Movie' })).toBeTruthy();
    const row = (label: string) => within(drawer).getByText(label).nextElementSibling?.textContent;
    await waitFor(() => expect(row('Total Size')).toBe('2 GB'));
    expect(row('Remaining')).toBe('512 MB');
    expect(row('Ratio')).toBe('0.25');
    expect(row('Availability')).toBe('—');
    expect(row('DL Speed')).toBe('1 MB/s');
    expect(row('Time Elapsed')).toBe('1h 1m');
    expect(row('ETA')).toBe('2m 0s');
    expect(row('Seeds')).toBe('4 (9 total)');
    expect(row('Save Path')).toBe('/data/movies');
    expect(row('Auto Torrent Management')).toBe('On');
    expect(within(drawer).getByText('Files (6)')).toBeTruthy();
    expect(within(drawer).getByText('+1 more files')).toBeTruthy();
    expect(within(drawer).getByText('Trackers (1)')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Copy Magnet URI' })).toBeTruthy();

    await user.click(within(drawer).getByRole('button', { name: 'Manage Files' }));
    expect(mocks.push).toHaveBeenCalledWith('/torrents/aaa/files?name=Alpha.Movie');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Alpha.Movie' }));
    await user.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Edit Settings' }));
    expect(mocks.push).toHaveBeenCalledWith('/torrents/aaa/settings');
  });

  it('toggles alternative speed limits, and goes to rename, settings, linked downloads and add', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Alternative Speed Limits' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Alternative speed mode toggled'));
    expect(mocks.sent.find((sent) => sent.path === '/api/qbittorrent/transfer/limits')?.body).toEqual({ action: 'toggleSpeedLimitsMode' });

    await user.click(actionsFor('Alpha.Movie').getByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Linked downloads' }));
    await user.click(screen.getByRole('button', { name: 'Add Torrent' }));
    expect(mocks.push.mock.calls.map(([path]) => path)).toEqual(['/torrents/aaa/rename', '/torrents/settings', '/torrents/linked', '/torrents/add']);
  });

  it('offers no actions to someone who may only look', async () => {
    mocks.caps = new Set();
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(actionsFor('Alpha.Movie').queryByRole('button', { name: 'Start' })).toBeNull();
    expect(actionsFor('Alpha.Movie').queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Torrent actions' })).toBeNull();
    for (const name of ['Alternative Speed Limits', 'Settings', 'Linked downloads', 'Add Torrent']) expect(screen.queryByRole('button', { name })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha.Movie' }));
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('shows a table with sortable headers on a wide screen', async () => {
    mocks.mobile = false;
    const { user } = renderPage();
    await waitFor(() => expect(names()).toEqual(['Alpha.Movie', 'Bravo.Show', 'Charlie']));
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['', 'Name', 'Status', 'Progress', 'Size', 'DL', 'UL', 'ETA', 'Seeds', 'Peers', 'Ratio', '']);
    await user.click(screen.getByRole('button', { name: 'Size' }));
    await waitFor(() => expect(names()).toEqual(['Bravo.Show', 'Alpha.Movie', 'Charlie']));
    await user.click(actionsFor('Charlie').getByRole('button', { name: 'Stop' }));
    expect(posted()).toEqual([{ hash: 'ccc', action: 'stop' }]);
  });

  it('takes in what a later poll changes: a new state, a new torrent, one gone (and its selection)', async () => {
    let rows = [ALPHA, BRAVO, CHARLIE];
    mocks.summary = () => full(rows);
    const { user, client } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(screen.getByRole('checkbox', { name: 'Select Charlie' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();

    rows = [{ ...ALPHA, state: 'stalledDL', dlspeed: 0 }, BRAVO, torrent('ddd', 'Delta')];
    await act(() => client.refetchQueries({ queryKey: ['torrents'] }));
    await waitFor(() => expect(screen.getByText('3 torrents')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Delta' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Charlie' })).toBeNull();
    expect(within(screen.getByRole('button', { name: 'Alpha.Movie' }).closest('.px-3')! as HTMLElement).getByText('Stalled')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull());
  });

  it('keeps a deleted torrent hidden from a poll that still reports it, and brings it back when the delete fails', async () => {
    const { user, client } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(actionsFor('Alpha.Movie').getByRole('button', { name: 'Delete (keep files)' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(names()).toEqual(['Bravo.Show', 'Charlie']));
    await act(() => client.refetchQueries({ queryKey: ['torrents'] }));
    expect(names()).toEqual(['Bravo.Show', 'Charlie']);

    mocks.action = () => Response.json({ error: 'qBittorrent did not confirm the delete. Check the torrent list.' }, { status: 502 });
    await user.click(actionsFor('Charlie').getByRole('button', { name: 'Delete (keep files)' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('qBittorrent did not confirm the delete. Check the torrent list.'));
    expect(names()).toEqual(['Bravo.Show', 'Charlie']);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('holds the alternative speed mode it turned on against a poll that still reports it off', async () => {
    const { user, client } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    const toggle = () => screen.getByRole('button', { name: 'Alternative Speed Limits' });
    expect(toggle().className).not.toContain('bg-yellow-500/20');
    await user.click(toggle());
    expect(toggle().className).toContain('bg-yellow-500/20');
    await act(() => client.refetchQueries({ queryKey: ['torrents'] }));
    expect(toggle().className).toContain('bg-yellow-500/20');
  });

  it('hands the selected torrents and their limits to the speed limits page', async () => {
    const { user } = renderPage();
    await waitFor(() => expect(names()).toHaveLength(3));
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha.Movie' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Charlie' }));
    await user.click(screen.getByRole('button', { name: 'Speed Limits' }));
    expect(getSpeedLimitTargets()).toEqual([
      { hash: 'aaa', name: 'Alpha.Movie', dl_limit: 0, up_limit: 0 },
      { hash: 'ccc', name: 'Charlie', dl_limit: 0, up_limit: 0 },
    ]);
  });

  it('keeps the list on a failed poll with a banner, and explains a list it could not load', async () => {
    let fail = false;
    mocks.summary = () => (fail ? Response.json({ error: 'qBittorrent is not reachable' }, { status: 502 }) : full([ALPHA]));
    const { client } = renderPage();
    await waitFor(() => expect(names()).toEqual(['Alpha.Movie']));
    fail = true;
    await act(() => client.refetchQueries({ queryKey: ['torrents'] }));
    expect(await screen.findByText('Failed to fetch')).toBeTruthy();
    expect(names()).toEqual(['Alpha.Movie']);
  });

  it('says what to check when the first load fails', async () => {
    mocks.summary = () => Response.json({ error: 'down' }, { status: 502 });
    renderPage();
    expect(await screen.findByText('Make sure qBittorrent is configured in Settings.')).toBeTruthy();
    expect(screen.getByText('Failed to fetch')).toBeTruthy();
  });
});
