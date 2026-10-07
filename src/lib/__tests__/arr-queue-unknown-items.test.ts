import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ get: mocks.get })) },
}));

import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

const paramsOfLastCall = () => mocks.get.mock.calls.at(-1)?.[1]?.params as Record<string, unknown>;

describe('arr queue: downloads the arr could not match', () => {
  beforeEach(() => mocks.get.mockReset().mockResolvedValue({ data: { records: [], totalRecords: 0 } }));

  it('asks Sonarr for them with includeUnknownSeriesItems, and only on request', async () => {
    const sonarr = new SonarrClient('http://sonarr.local', 'key');
    await sonarr.getQueue(1, 50, true);
    expect(mocks.get).toHaveBeenLastCalledWith('/api/v3/queue', expect.anything());
    expect(paramsOfLastCall()).toMatchObject({ page: 1, pageSize: 50, includeUnknownSeriesItems: true });
    // The queue cleaner calls without the flag and keeps the default view.
    await sonarr.getQueue(1, 50);
    expect(paramsOfLastCall()).not.toHaveProperty('includeUnknownSeriesItems');
  });

  it('asks Radarr for them with includeUnknownMovieItems, and only on request', async () => {
    const radarr = new RadarrClient('http://radarr.local', 'key');
    await radarr.getQueue(1, 50, true);
    expect(paramsOfLastCall()).toMatchObject({ page: 1, pageSize: 50, includeUnknownMovieItems: true });
    await radarr.getQueue(1, 50);
    expect(paramsOfLastCall()).not.toHaveProperty('includeUnknownMovieItems');
  });
});
