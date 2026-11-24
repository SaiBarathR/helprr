// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  role: 'member' as 'admin' | 'member',
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ hash: 'abc' }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => mocks.caps.has(cap),
  useMe: () => ({ role: mocks.role }),
}));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ title, rightContent }: { title: string; rightContent?: ReactNode }) => <header><h1>{title}</h1>{rightContent}</header>,
}));
vi.mock('@/lib/client-refresh-settings', () => ({ getRefreshIntervalMs: async () => 60_000 }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ open, description, confirmLabel, onConfirm }: { open: boolean; description?: ReactNode; confirmLabel?: string; onConfirm: () => void }) =>
    (open ? <div><p>{description}</p><button onClick={onConfirm}>{confirmLabel}</button></div> : null),
}));

import TorrentPeersPage from './page';

const row = (client: string, over: Record<string, unknown> = {}) => ({
  client, peer_id_client: '-XX-', connection: 'BT', country: 'Canada', country_code: 'ca', flags: 'D H', flags_desc: '',
  progress: 0.5, relevance: 1, dl_speed: 2048, up_speed: 0, downloaded: 0, uploaded: 0, ...over,
});

const fetchMock = vi.fn();
let answers: unknown[];
let posts: Array<{ url: string; body: unknown }>;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.caps = new Set(['torrents.view']);
  mocks.role = 'member';
  posts = [];
  answers = [{ rid: 1, fullUpdate: true, showFlags: true, peers: { k1: row('Transmission 4.0'), k2: row('Deluge 2.1', { dl_speed: 0 }) }, removed: [] }];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return url.endsWith('/ban') ? Response.json({ banned: true }) : Response.json({ requested: 2, added: 2, failed: 0 });
    }
    return Response.json(answers.length > 1 ? answers.shift() : answers[0]);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.clearAllMocks();
});

describe('Peers', () => {
  it('lists peers for torrents.view without addresses, bans or adding', async () => {
    render(<TorrentPeersPage />, { wrapper });
    expect(await screen.findByText('Transmission 4.0')).toBeTruthy();
    expect(screen.getByText('Deluge 2.1')).toBeTruthy();
    expect(screen.getByText('Peers (2)')).toBeTruthy();
    expect(screen.getByText('Only admins see peer IP addresses.')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Canada' })[0].textContent).toBe('🇨🇦');
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add peers' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/qbittorrent/abc/peers?rid=0', expect.anything());
  });

  it('asks for what changed since its rid and merges it in', async () => {
    answers = [
      answers[0],
      { rid: 2, fullUpdate: false, showFlags: null, peers: { k1: { client: 'Transmission 4.1' } }, removed: ['k2'] },
    ];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><TorrentPeersPage /></QueryClientProvider>);
    expect(await screen.findByText('Transmission 4.0')).toBeTruthy();
    await client.refetchQueries({ queryKey: ['qbittorrent', 'abc', 'peers'] });
    expect(await screen.findByText('Transmission 4.1')).toBeTruthy();
    expect(screen.queryByText('Deluge 2.1')).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/qbittorrent/abc/peers?rid=1', expect.anything());
  });

  it('lets torrents.manage add peers, one per line, without banning', async () => {
    mocks.caps = new Set(['torrents.view', 'torrents.manage']);
    render(<TorrentPeersPage />, { wrapper });
    expect(await screen.findByText('Manage Peers')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add peers' }));
    await userEvent.type(screen.getByLabelText('Peers to add'), '203.0.113.5:6881{enter} [[2001:db8::5]:6881 ');
    await userEvent.click(screen.getByRole('button', { name: 'Add Peers' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/qbittorrent/abc/peers', body: { peers: ['203.0.113.5:6881', '[2001:db8::5]:6881'] } }]));
    expect(mocks.toast.success).toHaveBeenCalledWith('Added 2 peers');
  });

  it('shows an admin the address and bans by the key, after a confirm', async () => {
    mocks.role = 'admin';
    mocks.caps = new Set(['torrents.view', 'torrents.manage']);
    answers = [{ ...(answers[0] as object), peers: { k1: row('Transmission 4.0', { address: '198.51.100.7:51413' }) } }];
    render(<TorrentPeersPage />, { wrapper });
    expect(await screen.findByText(/198\.51\.100\.7:51413 · BT/)).toBeTruthy();
    expect(screen.queryByText('Only admins see peer IP addresses.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Transmission 4.0 at 198.51.100.7:51413' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Ban peer/ }));
    expect(screen.getByText(/bans this IP address for every torrent/)).toBeTruthy();
    expect(posts).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Ban Peer' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/qbittorrent/abc/peers/ban', body: { key: 'k1' } }]));
    expect(mocks.toast.success).toHaveBeenCalledWith('Peer banned');
  });

  it('says when nobody is connected', async () => {
    answers = [{ rid: 1, fullUpdate: true, showFlags: true, peers: {}, removed: [] }];
    render(<TorrentPeersPage />, { wrapper });
    expect(await screen.findByText('No peers connected right now')).toBeTruthy();
  });
});
