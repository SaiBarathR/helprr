// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vaul needs pointer capture, which jsdom lacks; the drawer shell is not under test.
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Drawer: Pass, DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 't1'), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const me = vi.hoisted(() => ({ role: 'member' as 'admin' | 'member' }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: me.role }) }));
const saveFile = vi.hoisted(() => vi.fn(async () => 'saved'));
vi.mock('@/lib/save-file', () => ({ saveFile }));

import { TorrentDetailDrawer, type TorrentDetailData } from '../torrent-detail-drawer';

const HASH = 'aaaabbbbccccddddeeeeffff0000111122223333';
const data: TorrentDetailData = {
  properties: {
    total_size: 1, comment: 'Ubuntu CD https://releases.example', created_by: 'mktorrent 1.1', creation_date: 1754562869,
    piece_size: 262144, pieces_have: 3, pieces_num: 12602, last_seen: 1754562900, reannounce: 51,
  },
  files: [],
  trackers: [],
  magnet: null,
  private: false,
};

function renderDrawer(over: Partial<TorrentDetailData> = {}, push = vi.fn()) {
  render(
    <TorrentDetailDrawer
      detailHash={HASH}
      setDetailHash={() => {}}
      setDetailData={() => {}}
      torrentNameByHash={new Map([[HASH, 'ubuntu-24.04.iso']])}
      detailLoading={false}
      detailData={{ ...data, ...over }}
      detailTorrent={null}
      canBandwidthTorrents={false}
      canManageTorrents={false}
      instanceId="q2"
      router={{ push }}
    />,
  );
  return push;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  me.role = 'member';
});

describe('TorrentDetailDrawer: torrent info', () => {
  it('shows the hash, private flag, pieces, creator, creation date, comment, last seen complete and next reannounce', () => {
    renderDrawer();
    expect(screen.getByText(HASH)).toBeTruthy();
    expect(screen.getByText('Private').nextElementSibling?.textContent).toBe('No');
    expect(screen.getByText('3 / 12602 × 256 KB')).toBeTruthy();
    expect(screen.getByText('mktorrent 1.1')).toBeTruthy();
    expect(screen.getByText('Created On')).toBeTruthy();
    // Plain text, never a link.
    expect(screen.getByText('Ubuntu CD https://releases.example').tagName).toBe('P');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Last Seen Complete')).toBeTruthy();
    expect(screen.getByText('Next Reannounce').nextElementSibling?.textContent).toBe('51s');
  });

  it('leaves out what qBittorrent does not know yet', () => {
    renderDrawer({ properties: { pieces_num: -1, last_seen: -1, reannounce: 0, comment: '', created_by: '' }, private: null });
    expect(screen.queryByText('Pieces')).toBeNull();
    expect(screen.queryByText('Private')).toBeNull();
    expect(screen.queryByText('Comment')).toBeNull();
    expect(screen.queryByText('Created By')).toBeNull();
    expect(screen.queryByText('Last Seen Complete')).toBeNull();
    expect(screen.queryByText('Next Reannounce')).toBeNull();
  });

  it('copies the name and the hash', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDrawer();
    await user.click(screen.getByRole('button', { name: 'Copy Name' }));
    await user.click(screen.getByRole('button', { name: 'Copy Hash' }));
    expect(writeText.mock.calls).toEqual([['ubuntu-24.04.iso'], [HASH]]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Hash copied'));
  });

  it('opens the peers page', async () => {
    const push = renderDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'View Peers' }));
    expect(push).toHaveBeenCalledWith(`/torrents/${HASH}/peers?name=ubuntu-24.04.iso`);
  });
});

describe('TorrentDetailDrawer: Export .torrent', () => {
  it('is not offered to a member', () => {
    renderDrawer();
    expect(screen.queryByRole('button', { name: 'Export .torrent' })).toBeNull();
  });

  it("downloads an admin's export from the torrent's own qBittorrent, named as the server says", async () => {
    me.role = 'admin';
    const fetch = vi.fn(async () => new Response(new Uint8Array([0x64, 0x65]), {
      status: 200,
      headers: {
        'content-type': 'application/x-bittorrent',
        'content-disposition': `attachment; filename="ubuntu_.torrent"; filename*=UTF-8''ubuntu%E2%80%9324.torrent`,
      },
    }));
    vi.stubGlobal('fetch', fetch);
    renderDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Export .torrent' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(`/api/qbittorrent/${HASH}/export?instanceId=q2`, { cache: 'no-store' });
    expect((saveFile.mock.calls[0] as unknown[])[1]).toBe('ubuntu–24.torrent');
  });

  it("says why when there's no file yet", async () => {
    me.role = 'admin';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'qBittorrent has no .torrent file for it until its metadata has downloaded' }, { status: 409 })));
    renderDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Export .torrent' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('qBittorrent has no .torrent file for it until its metadata has downloaded', { id: 't1' }));
    expect(saveFile).not.toHaveBeenCalled();
  });
});
