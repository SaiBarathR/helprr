// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  qbit: { unknownLink: false, checkingLink: false, instances: [] as Array<{ id: string; label: string; isDefault: boolean }> },
  replace: vi.fn(),
}));
vi.mock('../_components/use-qbit-instance', async (importOriginal) => ({ ...(await importOriginal<object>()), useQbitInstance: () => mocks.qbit }));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ replace: mocks.replace, push: vi.fn(), back: vi.fn() }),
  canGoBackInApp: () => false,
}));
vi.mock('@/components/permission-provider', () => ({ useMe: () => null, hasCapability: () => true }));

import TorrentPagesLayout from './layout';
import { torrentPageSubtitle } from '../_components/use-qbit-instance';

beforeEach(() => {
  mocks.replace.mockClear();
  mocks.qbit = { unknownLink: false, checkingLink: false, instances: [{ id: 'q1', label: 'Home', isDefault: true }, { id: 'q2', label: 'Seedbox', isDefault: false }] };
});

describe('per-torrent pages and a removed qBittorrent', () => {
  it('shows the page for a qBittorrent still connected', () => {
    render(<TorrentPagesLayout><p>Torrent Settings</p></TorrentPagesLayout>);
    expect(screen.getByText('Torrent Settings')).toBeTruthy();
  });

  it('waits for the list before showing a page whose link names a qBittorrent', () => {
    mocks.qbit.checkingLink = true;
    render(<TorrentPagesLayout><p>Torrent Settings</p></TorrentPagesLayout>);
    expect(screen.queryByText('Torrent Settings')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('says a removed one is no longer connected, and Show opens that qBittorrent’s list (not this hash there)', async () => {
    mocks.qbit.unknownLink = true;
    render(<TorrentPagesLayout><p>Torrent Settings</p></TorrentPagesLayout>);
    expect(screen.queryByText('Torrent Settings')).toBeNull();
    expect(screen.getByText('This qBittorrent is no longer connected to Helprr.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show Seedbox' }));
    expect(mocks.replace).toHaveBeenCalledWith('/torrents?instance=q2');
  });
});

describe('torrentPageSubtitle', () => {
  it('names the qBittorrent first when there are several, and nothing new with one', () => {
    expect(torrentPageSubtitle('Seedbox', 'Big Buck Bunny')).toBe('Seedbox · Big Buck Bunny');
    expect(torrentPageSubtitle(undefined, 'Big Buck Bunny')).toBe('Big Buck Bunny');
    expect(torrentPageSubtitle('Seedbox', undefined)).toBe('Seedbox');
    expect(torrentPageSubtitle(undefined, undefined)).toBeUndefined();
  });
});
