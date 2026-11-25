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
// One qBittorrent, the default (use-qbit-instance.test.ts covers choosing one).
vi.mock('@/app/(app)/torrents/_components/use-qbit-instance', () => ({
  qbitInstanceKey: (id: string | undefined) => id ?? 'default',
  useQbitInstance: () => ({ instanceId: undefined, instances: [], multiInstance: false, current: undefined, subtitle: undefined, select: () => {} }),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ hash: 'abc' }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => mocks.caps.has(cap),
  useMe: () => ({ role: mocks.role }),
}));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
// The confirm dialog is reduced to its text and confirm button.
vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ open, description, confirmLabel, onConfirm }: { open: boolean; description?: ReactNode; confirmLabel?: string; onConfirm: () => void }) =>
    (open ? <div><p>{description}</p><button onClick={onConfirm}>{confirmLabel}</button></div> : null),
}));

import TorrentTrackersPage from './page';

const tracker = (url: string) => ({ url, status: 2, tier: 0, num_peers: 0, num_seeds: 1, num_leeches: 0, num_downloaded: 0, msg: '' });
// What a member is sent: hosts only.
const MEMBER_LIST = [tracker('** [DHT] **'), tracker('https://tracker.invalid'), tracker('udp://public.invalid:1337')];

const fetchMock = vi.fn();
let posts: Record<string, unknown>[];
let detailsPrivate: boolean | null;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.caps = new Set(['torrents.manage']);
  mocks.role = 'member';
  posts = [];
  detailsPrivate = false;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ trackers: MEMBER_LIST.slice(0, 2) });
    }
    return Response.json({ properties: {}, files: [], trackers: MEMBER_LIST, magnet: null, private: detailsPrivate });
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

  it('keeps a private torrent’s trackers read-only for a member, and when qBittorrent doesn’t say', async () => {
    for (const flag of [true, null]) {
      detailsPrivate = flag;
      const { unmount } = render(<TorrentTrackersPage />, { wrapper });
      expect(await screen.findByText('https://tracker.invalid')).toBeTruthy();
      expect(screen.getByText(/only an admin can change its trackers/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
      expect(screen.queryByLabelText('Trackers to add')).toBeNull();
      unmount();
    }
  });

  it('lets an admin change a private torrent’s trackers', async () => {
    mocks.role = 'admin';
    detailsPrivate = true;
    render(<TorrentTrackersPage />, { wrapper });
    expect(await screen.findByRole('button', { name: 'More actions for https://tracker.invalid' })).toBeTruthy();
    expect(screen.queryByText(/only an admin can change its trackers/)).toBeNull();
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
      action: 'edit', index: 1, shown: 'https://tracker.invalid', tier: 0, count: 3, url: 'https://tracker.invalid/announce/newkey123456',
    });
  });

  it('closes an edit refused because the list changed, and shows the list as it is now', async () => {
    let reordered = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        reordered = true;
        return Response.json({ error: 'The tracker list changed. Check it and try again.' }, { status: 409 });
      }
      const trackers = reordered ? [MEMBER_LIST[0], MEMBER_LIST[2], MEMBER_LIST[1]] : MEMBER_LIST;
      return Response.json({ properties: {}, files: [], trackers, magnet: null, private: false });
    });
    render(<TorrentTrackersPage />, { wrapper });
    await openRowMenu('https://tracker.invalid');
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit tracker/ }));
    await userEvent.type(screen.getByLabelText('New tracker URL'), 'https://tracker.invalid/announce/x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed/)));
    await waitFor(() => expect(screen.queryByLabelText('New tracker URL')).toBeNull());
    // The row that moved into that place is not offered for the old edit.
    expect(screen.getByRole('button', { name: 'More actions for udp://public.invalid:1337' })).toBeTruthy();
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
    // A public torrent's tracker has no passkey to warn about.
    expect(screen.queryByText(/Adding a private tracker back/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(posts).toEqual([{ action: 'remove', index: 2, shown: 'udp://public.invalid:1337', tier: 0, count: 3 }]));
    await waitFor(() => expect(screen.queryByText('udp://public.invalid:1337')).toBeNull());
  });

  it('adds one URL per non-empty line', async () => {
    render(<TorrentTrackersPage />, { wrapper });
    await userEvent.type(await screen.findByLabelText('Trackers to add'), ' https://a.invalid/announce {Enter}{Enter}wss://b.invalid/x');
    await userEvent.click(screen.getByRole('button', { name: 'Add Trackers' }));
    await waitFor(() => expect(posts).toEqual([{ action: 'add', urls: ['https://a.invalid/announce', 'wss://b.invalid/x'] }]));
  });

  it('warns about the passkey before removing a private torrent’s tracker', async () => {
    mocks.role = 'admin';
    detailsPrivate = true;
    render(<TorrentTrackersPage />, { wrapper });
    await openRowMenu('udp://public.invalid:1337');
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove tracker/ }));
    expect(screen.getByText(/Adding a private tracker back needs its full announce URL/)).toBeTruthy();
  });

  it('closes the edit form on Escape, sending nothing', async () => {
    render(<TorrentTrackersPage />, { wrapper });
    await openRowMenu('https://tracker.invalid');
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit tracker/ }));
    await userEvent.type(screen.getByLabelText('New tracker URL'), 'https://x.invalid{Escape}');
    expect(screen.queryByLabelText('New tracker URL')).toBeNull();
    expect(posts).toEqual([]);
  });
});
