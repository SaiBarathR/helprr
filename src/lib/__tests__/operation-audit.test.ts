import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { fileOperationAudit: { create: mocks.create } },
}));

import {
  recordFileAudit,
  recordOperationAudit,
  runWithOperationAudit,
  snapshotTorrentDeleteTargets,
  deleteTorrentsConfirmed,
  systemAuditActor,
} from '@/lib/file-audit';
import { withApiLogging } from '@/lib/api-logger';

const user = { id: 'user-1', username: 'owner' };

describe('unified operation audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('preserves legacy file-delete fields and marks files as deleted', async () => {
    const startedAt = new Date('2026-10-17T10:00:00.000Z');
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
      startedAt,
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
        startedAt,
        success: true,
      }),
    });
  });

  it('ties a row to the API request that wrote it and to when its upstream call started', async () => {
    let callStartedAt = 0;
    const handler = withApiLogging(async () => {
      await runWithOperationAudit({
        user,
        service: 'SONARR',
        operation: 'DELETE_MEDIA',
        targetType: 'series',
        targetId: 3,
        targetTitle: 'Series',
        itemCount: 1,
      }, async () => {
        callStartedAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      return new Response(null, { status: 204 });
    });

    const response = await handler();

    const data = mocks.create.mock.calls[0][0].data;
    expect(data.requestId).toBe(response.headers.get('x-request-id'));
    expect(data.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.startedAt.getTime()).toBeLessThanOrEqual(callStartedAt);
  });

  it('records no request id outside an API request and names a system actor', async () => {
    await recordOperationAudit({
      user: systemAuditActor('cleanup-scheduler'),
      service: 'QBITTORRENT',
      operation: 'DELETE_TORRENT',
      targetType: 'torrent',
      targetTitle: 'Torrent',
      itemCount: 1,
      startedAt: new Date(),
      success: true,
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: null,
        username: 'system:cleanup-scheduler',
        requestId: null,
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
      found: 2,
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
      found: null,
      details: { hashes: ['aaa'], targets: [] },
    });
  });

  it('confirms a torrent delete only when qBittorrent no longer lists the torrent', async () => {
    const client = { deleteTorrent: vi.fn(async () => undefined), getTorrents: vi.fn() };
    client.getTorrents.mockResolvedValueOnce([]);
    await expect(deleteTorrentsConfirmed(client as never, 'aaa', true)).resolves.toBeUndefined();
    expect(client.deleteTorrent).toHaveBeenCalledWith('aaa', true);
    expect(client.getTorrents).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, 'aaa');

    client.getTorrents.mockResolvedValueOnce([{ hash: 'aaa' }]);
    await expect(deleteTorrentsConfirmed(client as never, 'aaa', true)).rejects.toThrow('qBittorrent still lists the torrent after the delete');

    client.getTorrents.mockResolvedValueOnce([{ hash: 'aaa' }, { hash: 'bbb' }]);
    await expect(deleteTorrentsConfirmed(client as never, 'aaa|bbb', false)).rejects.toThrow('still lists 2 of the torrents');

    client.getTorrents.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(deleteTorrentsConfirmed(client as never, 'aaa', false)).rejects.toThrow('could not be asked whether the torrent is gone: ECONNREFUSED');
  });
});
