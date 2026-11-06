import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ get: mocks.get, delete: mocks.delete })) },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

describe('arr blocklist client methods', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ data: { records: [], totalRecords: 0 } });
    mocks.delete.mockReset().mockResolvedValue({ data: undefined });
  });

  it.each([
    ['Sonarr', () => new SonarrClient('http://sonarr.local', 'key'), 'v3'],
    ['Radarr', () => new RadarrClient('http://radarr.local', 'key'), 'v3'],
    ['Lidarr', () => new LidarrClient('http://lidarr.local', 'key'), 'v1'],
  ])('%s lists, removes and bulk-removes on /api/%s/blocklist', async (_name, make, version) => {
    const client = make();

    await client.getBlocklist(2, 40);
    expect(mocks.get).toHaveBeenLastCalledWith(`/api/${version}/blocklist`, {
      params: { page: 2, pageSize: 40, sortKey: 'date', sortDirection: 'descending' },
    });

    await client.deleteBlocklistItem(9);
    expect(mocks.delete).toHaveBeenLastCalledWith(`/api/${version}/blocklist/9`, { params: undefined });

    await client.deleteBlocklistBulk([3, 4]);
    expect(mocks.delete).toHaveBeenLastCalledWith(`/api/${version}/blocklist/bulk`, { data: { ids: [3, 4] } });
  });
});
