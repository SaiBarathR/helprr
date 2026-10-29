import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TorrentDeleteUnconfirmedError } from '@/lib/file-audit';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), cancel: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  requireUserAllCapabilities: async () => ({ ok: true, user: { id: 'u1', username: 'admin', role: 'admin', capabilities: { 'torrents.delete': true } } }),
}));
vi.mock('@/lib/permissions', () => ({ can: () => true }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { manualDownload: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/manual-downloads/cancel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/manual-downloads/cancel')>()),
  cancelManualDownload: mocks.cancel,
}));

import { POST } from '../[id]/cancel/route';

const cancel = () => POST(
  new Request('http://localhost/api/manual-downloads/md1/cancel', { method: 'POST', body: JSON.stringify({ removeFromClient: true }) }),
  { params: Promise.resolve({ id: 'md1' }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({ id: 'md1', service: 'RADARR' });
});

describe('cancel route', () => {
  it('says the torrent is still in qBittorrent when the delete is not confirmed', async () => {
    mocks.cancel.mockRejectedValue(new TorrentDeleteUnconfirmedError('still listed'));
    const res = await cancel();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('qBittorrent did not confirm the delete. Check the torrent list.');
  });
});
