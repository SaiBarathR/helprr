import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { fileOperationAudit: { create: mocks.create } },
}));

import {
  recordFileAudit,
  runWithOperationAudit,
  snapshotTorrentDeleteTargets,
} from '@/lib/file-audit';

const user = { id: 'user-1', username: 'owner' };

describe('unified operation audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('preserves legacy file-delete fields and marks files as deleted', async () => {
    await recordFileAudit({
      user,
      service: 'SONARR',
      instanceId: 'sonarr-1',
      operation: 'DELETE',
      mediaType: 'series',
      mediaId: 42,
      mediaTitle: 'Example',
      fileCount: 2,
      details: { paths: ['a.mkv', 'b.mkv'] },
      success: true,
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'DELETE',
        mediaType: 'series',
        mediaId: 42,
        mediaTitle: 'Example',
        fileCount: 2,
        filesDeleted: true,
        success: true,
      }),
    });
  });

  it('records a successful destructive operation', async () => {
    const operation = vi.fn().mockResolvedValue('done');

    await expect(runWithOperationAudit({
      user,
      service: 'RADARR',
      operation: 'DELETE_MEDIA',
      targetType: 'movie',
      targetId: 9,
      targetTitle: 'Movie',
      itemCount: 1,
      filesDeleted: false,
      details: { targetIds: [9] },
    }, operation)).resolves.toBe('done');

    expect(operation).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'DELETE_MEDIA',
        mediaId: 9,
        filesDeleted: false,
        success: true,
        errorMessage: null,
      }),
    });
  });

  it('records an upstream failure and rethrows the original error', async () => {
    const failure = new Error('Radarr rejected deletion');
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(runWithOperationAudit({
      user,
      service: 'RADARR',
      operation: 'REMOVE_QUEUE',
      targetType: 'queue',
      targetId: 17,
      targetTitle: 'Radarr queue item #17',
      itemCount: 1,
      filesDeleted: true,
    }, operation)).rejects.toBe(failure);

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'REMOVE_QUEUE',
        success: false,
        errorMessage: 'Radarr rejected deletion',
      }),
    });
  });

  it('does not turn a completed upstream action into a failure when audit storage is down', async () => {
    mocks.create.mockRejectedValueOnce(new Error('database unavailable'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runWithOperationAudit({
      user,
      service: 'QBITTORRENT',
      operation: 'DELETE_TORRENT',
      targetType: 'torrent',
      targetTitle: 'Torrent',
      itemCount: 1,
      filesDeleted: true,
    }, async () => 'deleted')).resolves.toBe('deleted');

    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });

  it('snapshots exact qBittorrent hashes and labels without blocking deletion on lookup failure', async () => {
    const client = {
      getTorrents: vi.fn().mockResolvedValueOnce([
        { hash: 'aaa', name: 'One', size: 100, progress: 0.5 },
        { hash: 'bbb', name: 'Two', size: 200, progress: 1 },
      ]).mockRejectedValueOnce(new Error('qBittorrent unavailable')),
    };

    await expect(snapshotTorrentDeleteTargets(client as never, 'aaa|bbb|aaa')).resolves.toEqual({
      targetTitle: '2 torrents',
      itemCount: 2,
      details: {
        hashes: ['aaa', 'bbb'],
        targets: [
          { hash: 'aaa', name: 'One', size: 100, progress: 0.5 },
          { hash: 'bbb', name: 'Two', size: 200, progress: 1 },
        ],
      },
    });
    await expect(snapshotTorrentDeleteTargets(client as never, 'aaa')).resolves.toEqual({
      targetTitle: '1 torrent',
      itemCount: 1,
      details: { hashes: ['aaa'], targets: [] },
    });
  });
});
