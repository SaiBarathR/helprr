import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ post: mocks.post, delete: mocks.delete })) },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

describe('arr activity action client methods', () => {
  beforeEach(() => {
    mocks.post.mockReset().mockResolvedValue({ data: undefined });
    mocks.delete.mockReset().mockResolvedValue({ data: undefined });
  });

  it.each([
    ['Sonarr', () => new SonarrClient('http://sonarr.local', 'key'), 'v3'],
    ['Radarr', () => new RadarrClient('http://radarr.local', 'key'), 'v3'],
    ['Lidarr', () => new LidarrClient('http://lidarr.local', 'key'), 'v1'],
  ])('%s marks failed, grabs and bulk-removes on /api/%s', async (_name, make, version) => {
    const client = make();

    await client.markHistoryFailed(41);
    expect(mocks.post).toHaveBeenLastCalledWith(`/api/${version}/history/failed/41`, undefined, undefined);

    await client.grabQueueItem(7);
    expect(mocks.post).toHaveBeenLastCalledWith(`/api/${version}/queue/grab/7`, undefined, undefined);

    await client.deleteQueueBulk([3, 4], { blocklist: true, skipRedownload: true });
    expect(mocks.delete).toHaveBeenLastCalledWith(`/api/${version}/queue/bulk`, {
      data: { ids: [3, 4] },
      // Upstream removes from the client unless told not to, so every option is explicit.
      params: { removeFromClient: false, blocklist: true, skipRedownload: true, changeCategory: false },
    });
  });
});
