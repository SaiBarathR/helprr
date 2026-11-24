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
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
// The confirm dialog is reduced to its confirm button.
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ open, confirmLabel, onConfirm }: { open: boolean; confirmLabel?: string; onConfirm: () => void }) =>
    (open ? <button onClick={onConfirm}>{confirmLabel}</button> : null),
}));

import TorrentTrackersPage from './page';

const tracker = (url: string) => ({ url, status: 2, tier: 0, num_peers: 0, num_seeds: 1, num_leeches: 0, num_downloaded: 0, msg: '' });
// What a member is sent: hosts only.
const MEMBER_LIST = [tracker('** [DHT] **'), tracker('https://tracker.invalid'), tracker('udp://public.invalid:1337')];

const fetchMock = vi.fn();
let posts: Record<string, unknown>[];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.caps = new Set(['torrents.manage']);
  mocks.role = 'member';
  posts = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ trackers: MEMBER_LIST.slice(0, 2) });
    }
    return Response.json({ properties: {}, files: [], trackers: MEMBER_LIST, magnet: null });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.clearAllMocks();
});

const openRowMenu = async (host: string) => {
  await userEvent.click(await screen.findByRole('button', { name: `More actions for ${host}` }));
};

describe('Manage Trackers', () => {
  it('lists real trackers only and offers no actions without torrents.manage', async () => {
    mocks.caps = new Set();
    render(<TorrentTrackersPage />, { wrapper });
    expect(await screen.findByText('https://tracker.invalid')).toBeTruthy();
    expect(screen.queryByText('** [DHT] **')).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.queryByLabelText('Trackers to add')).toBeNull();
  });

  it('starts a member’s edit empty and sends the tracker’s place, not a URL it was never given', async () => {
    render(<TorrentTrackersPage />, { wrapper });
    await openRowMenu('https://tracker.invalid');
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit tracker/ }));
    const field = screen.getByLabelText<HTMLInputElement>('New tracker URL');
    expect(field.value).toBe('');
    await userEvent.type(field, 'https://tracker.invalid/announce/newkey123456');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      action: 'edit', index: 1, shown: 'https://tracker.invalid', count: 3, url: 'https://tracker.invalid/announce/newkey123456',
    });
  });

  it('starts an admin’s edit from the full URL', async () => {
    mocks.role = 'admin';
    fetchMock.mockImplementation(async () =>
      Response.json({ properties: {}, files: [], trackers: [tracker('https://tracker.invalid/announce/KEY')], magnet: null }));
    render(<TorrentTrackersPage />, { wrapper });
    await openRowMenu('https://tracker.invalid/announce/KEY');
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit tracker/ }));
    expect(screen.getByLabelText<HTMLInputElement>('New tracker URL').value).toBe('https://tracker.invalid/announce/KEY');
  });

  it('removes after confirming, by place', async () => {
    render(<TorrentTrackersPage />, { wrapper });
    await openRowMenu('udp://public.invalid:1337');
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove tracker/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(posts).toEqual([{ action: 'remove', index: 2, shown: 'udp://public.invalid:1337', count: 3 }]));
    await waitFor(() => expect(screen.queryByText('udp://public.invalid:1337')).toBeNull());
  });

  it('adds one URL per non-empty line', async () => {
    render(<TorrentTrackersPage />, { wrapper });
    await userEvent.type(await screen.findByLabelText('Trackers to add'), ' https://a.invalid/announce {Enter}{Enter}wss://b.invalid/x');
    await userEvent.click(screen.getByRole('button', { name: 'Add Trackers' }));
    await waitFor(() => expect(posts).toEqual([{ action: 'add', urls: ['https://a.invalid/announce', 'wss://b.invalid/x'] }]));
  });
});
