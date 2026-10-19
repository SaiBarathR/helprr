// @vitest-environment jsdom
// Characterization tests for the Jellyfin page: what each tab shows and sends,
// pinned before the page's components move into their own files (Workstream 15).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  search: '',
  toast: { success: vi.fn(), error: vi.fn() },
  sent: [] as Array<{ method: string; path: string; body: unknown }>,
  asked: [] as string[],
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mocks.search), usePathname: () => '/jellyfin' }));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('@/lib/hooks/use-external-urls', () => ({ useExternalUrls: () => ({ JELLYFIN: 'https://jellyfin.example' }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/ui/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('@/components/jellyfin/session-card', () => ({ SessionCard: ({ session }: { session: { UserName: string; NowPlayingItem?: { Name: string } } }) => <div>Session: {session.UserName} watching {session.NowPlayingItem?.Name}</div> }));
vi.mock('@/components/jellyfin/stream-info-drawer', () => ({ StreamInfoDrawer: () => null }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button role="menuitem" onClick={onClick}>{children}</button>,
}));

import JellyfinPage from './page';

const ALL = ['jellyfin.sessions', 'jellyfin.stats', 'jellyfin.control'];
const routes: Record<string, () => unknown> = {
  '/api/jellyfin/sessions': () => ({ sessions: [{ Id: 's1', UserName: 'ana', NowPlayingItem: { Name: 'Severance' } }] }),
  '/api/jellyfin/resume': () => ({ items: [{ Id: 'r1', Name: 'Resumed Film', Type: 'Movie', UserData: { PlayedPercentage: 40 } }] }),
  '/api/jellyfin/counts': () => ({ counts: { MovieCount: 510, SeriesCount: 209, EpisodeCount: 8123 } }),
  '/api/jellyfin/recently-added': () => ({ items: [{ Id: 'n1', Name: 'Newly Added Show', Type: 'Series' }] }),
  '/api/jellyfin/system': () => ({ system: { ServerName: 'media-box', Version: '12.2.0', Id: 'x', HasPendingRestart: true } }),
  '/api/jellyfin/tasks': () => ({ tasks: [{ Id: 't1', Name: 'Scan Media Library', Key: 'RefreshLibrary', State: 'Idle', Category: 'Library', LastExecutionResult: { Status: 'Completed', StartTimeUtc: '2026-10-19T10:00:00Z', EndTimeUtc: '2026-10-19T10:02:00Z' } }] }),
  '/api/jellyfin/devices': () => ({ devices: [{ Id: 'd1', Name: 'Living Room TV', AppName: 'Jellyfin Android TV', LastUserName: 'ana', DateLastActivity: '2026-10-19T09:00:00Z' }], selfDeviceId: 'self' }),
  '/api/jellyfin/activity': () => ({ entries: [{ Id: 1, Name: 'ana is playing Severance', Type: 'VideoPlayback', Date: '2026-10-19T09:00:00Z' }] }),
  '/api/jellyfin/playback/users': () => ({ users: [{ user_id: 'u1', user_name: 'ana', has_image: false, latest_date: '', last_seen: '2 hours ago', item_name: 'Severance', client_name: 'Jellyfin Web', total_count: 42, total_time: 100000, total_play_time: '27h 46m' }], pluginAvailable: true }),
  '/api/jellyfin/users': () => ({ users: [{ Id: 'u1', Name: 'ana' }] }),
  '/api/jellyfin/playback/custom-history': () => ({ items: [{ RowId: 1, DateCreated: '2026-10-18 19:11:07.0338097', UserId: 'u1', ItemId: 'i1', ItemType: 'Episode', ItemName: 'Severance - s01e01 - Good News About Hell', PlaybackMethod: 'Transcode (v:direct a:aac)', ClientName: 'Jellyfin Web', DeviceName: 'Firefox', PlayDuration: 3300 }], total: 1, pluginAvailable: true }),
  '/api/jellyfin/playback/user-list': () => ({ users: [{ id: 'u1', name: 'ana' }], pluginAvailable: true }),
  '/api/jellyfin/playback/filters': () => ({ filters: ['Movie', 'Episode'] }),
  '/api/jellyfin/playback/activity': () => ({ data: [{ user_id: 'u1', user_name: 'ana', user_usage: { '2026-10-18': 3, '2026-10-19': 1 } }], pluginAvailable: true }),
  '/api/jellyfin/playback/tv-shows': () => ({ shows: [{ label: 'Severance', count: 9, time: 30000 }], pluginAvailable: true }),
  '/api/jellyfin/playback/movies': () => ({ movies: [{ label: 'Perfect Days', count: 2, time: 7400 }], pluginAvailable: true }),
  '/api/jellyfin/playback/breakdown/PlaybackMethod': () => ({ entries: [{ label: 'DirectPlay', count: 8, time: 20000 }, { label: 'Transcode', count: 3, time: 9000 }], pluginAvailable: true }),
  '/api/jellyfin/playback/breakdown/ClientName': () => ({ entries: [{ label: 'Jellyfin Web', count: 11, time: 29000 }], pluginAvailable: true }),
  '/api/jellyfin/playback/breakdown/DeviceName': () => ({ entries: [{ label: 'Firefox', count: 11, time: 29000 }], pluginAvailable: true }),
  '/api/jellyfin/playback/hourly': () => ({ data: { '1-20': 4, '5-21': 2 }, pluginAvailable: true }),
};
let overrides: Record<string, () => Response> = {};

let caseCounter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  caseCounter += 1;
  mocks.search = `case=${caseCounter}`;
  mocks.caps = new Set(ALL);
  mocks.sent = [];
  mocks.asked = [];
  overrides = {};
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://helprr.test');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      mocks.sent.push({ method, path: `${url.pathname}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({ ok: true });
    }
    mocks.asked.push(`${url.pathname}${url.search}`);
    if (overrides[url.pathname]) return overrides[url.pathname]();
    const route = routes[url.pathname];
    return route ? Response.json(route()) : Response.json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><JellyfinPage /></QueryClientProvider>);
  return user;
}

describe('Jellyfin page (characterization)', () => {
  it("shows an admin the server, who is watching, the library counts, tasks, devices, activity and what's new", async () => {
    const user = renderPage();
    expect(await screen.findByText('Session: ana watching Severance')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Users', 'History', 'Stats']);
    expect(await screen.findByText('media-box')).toBeTruthy();
    expect(screen.getByText('v12.2.0')).toBeTruthy();
    expect(screen.getByText('Restart needed')).toBeTruthy();
    for (const label of ['Movies', 'Series', 'Episodes', 'Streams']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('Scheduled Tasks')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Library\s*1 task/ }));
    expect(await screen.findByText('Scan Media Library')).toBeTruthy();
    expect(await screen.findByText('Living Room TV')).toBeTruthy();
    expect((await screen.findAllByText('ana is playing Severance')).length).toBeGreaterThan(0);
    expect(screen.getByText('Continue Watching')).toBeTruthy();
    expect(screen.getByText('Recently Added')).toBeTruthy();
    expect(screen.getByText('Newly Added Show')).toBeTruthy();
  });

  it('scans at once, and restarts the server only after confirming', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: /Scan Libraries/ }));
    await waitFor(() => expect(mocks.sent).toEqual([{ method: 'POST', path: '/api/jellyfin/system/control', body: { action: 'scan-libraries' } }]));

    await user.click(screen.getByRole('menuitem', { name: /Restart/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Are you sure you want to restart the Jellyfin server?')).toBeTruthy();
    expect(mocks.sent).toHaveLength(1);
    await user.click(within(confirm).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(mocks.sent.at(-1)).toEqual({ method: 'POST', path: '/api/jellyfin/system/control', body: { action: 'restart' } }));
  });

  it('runs an idle scheduled task', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: /Library\s*1 task/ }));
    await user.click(await screen.findByRole('button', { name: 'Run Scan Media Library' }));
    await waitFor(() => expect(mocks.sent).toEqual([{ method: 'POST', path: '/api/jellyfin/tasks/t1', body: null }]));
  });

  it('stops a running scheduled task', async () => {
    overrides['/api/jellyfin/tasks'] = () => Response.json({ tasks: [{ Id: 't1', Name: 'Scan Media Library', Key: 'RefreshLibrary', State: 'Running', CurrentProgressPercentage: 40, Category: 'Library' }] });
    const user = renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Stop Scan Media Library' }))[0]);
    await waitFor(() => expect(mocks.sent).toEqual([{ method: 'DELETE', path: '/api/jellyfin/tasks/t1', body: null }]));
  });

  it('says the Playback Reporting plugin is missing on Users and History', async () => {
    overrides['/api/jellyfin/playback/users'] = () => Response.json({ users: [], pluginAvailable: false });
    overrides['/api/jellyfin/playback/user-list'] = () => Response.json({ users: [], pluginAvailable: false });
    overrides['/api/jellyfin/playback/custom-history'] = () => Response.json({ items: [], total: 0, pluginAvailable: false });
    const user = renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Users' }));
    expect(await screen.findByText('Playback Reporting Plugin not detected')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Playback Reporting Plugin not detected')).toBeTruthy();
  });

  it("gives a member only Overview and History, and never asks for the admin data", async () => {
    mocks.caps = new Set();
    renderPage();
    expect(await screen.findByText('Continue Watching')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'History']);
    expect(screen.queryByText('media-box')).toBeNull();
    expect(screen.queryByText('Streams')).toBeNull();
    expect(mocks.asked.some((path) => /\/api\/jellyfin\/(sessions|system|tasks|devices|activity)/.test(path))).toBe(false);
  });

  it('says the server cannot be reached when every live slice fails', async () => {
    for (const path of ['/api/jellyfin/sessions', '/api/jellyfin/resume', '/api/jellyfin/counts', '/api/jellyfin/recently-added']) {
      overrides[path] = () => new Response('{}', { status: 502 });
    }
    renderPage();
    expect(await screen.findByRole('button', { name: /Retry/ })).toBeTruthy();
  });

  it("lists users with their plays, and a user's recent plays", async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Users' }));
    const row = await screen.findByRole('button', { name: /ana.*Severance.*Jellyfin Web/ });
    expect(within(row).getByText('42 plays')).toBeTruthy();
    expect(within(row).getByText('27h 46m')).toBeTruthy();
    expect(within(row).getByText('2 hours ago')).toBeTruthy();
    await user.click(row);
    expect(await screen.findByText('ana — Recent Plays')).toBeTruthy();
    expect(await screen.findByText('Severance - s01e01 - Good News About Hell')).toBeTruthy();
    expect(mocks.asked.some((path) => path.startsWith('/api/jellyfin/playback/custom-history?') && path.includes('userId=u1') && path.includes('limit=30'))).toBe(true);
  });

  it("lists the week's plays with their method, and changes the range", async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByText('1 plays found')).toBeTruthy();
    expect(screen.getByText('Severance - s01e01 - Good News About Hell')).toBeTruthy();
    expect(screen.getByText('Transcode (v:direct a:aac)')).toBeTruthy();
    const first = mocks.asked.find((path) => path.startsWith('/api/jellyfin/playback/custom-history?'))!;
    expect(new URLSearchParams(first.split('?')[1]).get('limit')).toBe('50');

    await user.click(screen.getByRole('button', { name: '30d' }));
    await waitFor(() => {
      const ranges = mocks.asked.filter((path) => path.startsWith('/api/jellyfin/playback/custom-history?')).map((path) => new URLSearchParams(path.split('?')[1]).get('from'));
      expect(new Set(ranges).size).toBe(2);
    });
  });

  it('shows the stats panels for the chosen range', async () => {
    const user = renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Stats' }));
    for (const title of ['Playback Methods', 'Top TV Shows', 'Top Movies', 'Top Clients', 'Top Devices', 'Play Activity', 'Hourly Activity']) {
      expect(await screen.findByText(title)).toBeTruthy();
    }
    expect(screen.getAllByText('Severance').length).toBeGreaterThan(0);
    expect(screen.getByText('Perfect Days')).toBeTruthy();
    expect(screen.getAllByText('Firefox').length).toBeGreaterThan(0);
    const statsAsked = mocks.asked.filter((path) => path.startsWith('/api/jellyfin/playback/tv-shows?'));
    expect(new URLSearchParams(statsAsked[0].split('?')[1]).get('days')).toBe('3');
  });
});
