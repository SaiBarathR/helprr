import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(), getLidarrClient: vi.fn(), getTracks: vi.fn(), getReleaseTracks: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getLidarrClient: mocks.getLidarrClient }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from './route';

const get = (query = '') => GET(new NextRequest(`http://localhost/api/lidarr/album/3/tracks${query}`), {
  params: Promise.resolve({ albumId: '3' }),
});

describe('GET /api/lidarr/album/[albumId]/tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserCapability.mockResolvedValue({ ok: true });
    mocks.getLidarrClient.mockResolvedValue({ getTracks: mocks.getTracks, getReleaseTracks: mocks.getReleaseTracks });
    mocks.getTracks.mockResolvedValue([{ id: 1 }]);
    mocks.getReleaseTracks.mockResolvedValue([{ id: 731 }]);
  });

  it("lists the album's selected release by default", async () => {
    const res = await get('?instanceId=lid-1');
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('music.view');
    expect(mocks.getLidarrClient).toHaveBeenCalledWith('lid-1');
    expect(mocks.getTracks).toHaveBeenCalledWith(3);
  });

  it('lists one release when asked, as manual import does', async () => {
    const res = await get('?albumReleaseId=73');
    expect(await res.json()).toEqual([{ id: 731 }]);
    expect(mocks.getReleaseTracks).toHaveBeenCalledWith(73);
    expect(mocks.getTracks).not.toHaveBeenCalled();
  });

  it('rejects a release id that is not a positive integer', async () => {
    expect((await get('?albumReleaseId=abc')).status).toBe(400);
    expect(mocks.getReleaseTracks).not.toHaveBeenCalled();
  });
});
