import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedTaggedLibrary: vi.fn(),
  getRadarrClients: vi.fn(),
  getSonarrClients: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/lib/cache/tagged-library', () => ({
  getCachedTaggedLibrary: mocks.getCachedTaggedLibrary,
}));
vi.mock('@/lib/service-helpers', () => ({
  getRadarrClients: mocks.getRadarrClients,
  getSonarrClients: mocks.getSonarrClients,
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: mocks.debug },
}));

import { loadCachedArrLibrary } from './arr-library';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCachedArrLibrary', () => {
  it('starts both families together and coalesces concurrent cold consumers', async () => {
    const radarr = deferred<{
      items: Array<{ id: number; instanceId: string; instanceLabel: string }>;
      cached: boolean;
      available: boolean;
    }>();
    const sonarr = deferred<{
      items: Array<{ id: number; instanceId: string; instanceLabel: string }>;
      cached: boolean;
      available: boolean;
    }>();
    mocks.getCachedTaggedLibrary.mockImplementation(
      ({ scope }: { scope: string }) => scope === 'radarr' ? radarr.promise : sonarr.promise,
    );

    const first = loadCachedArrLibrary();
    const second = loadCachedArrLibrary();

    expect(first).toBe(second);
    expect(mocks.getCachedTaggedLibrary.mock.calls.map(([opts]) => opts.scope))
      .toEqual(['radarr', 'sonarr']);

    radarr.resolve({
      items: [{ id: 1, instanceId: 'r1', instanceLabel: 'Radarr' }],
      cached: false,
      available: true,
    });
    sonarr.resolve({
      items: [{ id: 2, instanceId: 's1', instanceLabel: 'Sonarr' }],
      cached: true,
      available: true,
    });

    await expect(first).resolves.toMatchObject({
      movies: [{ id: 1, instanceId: 'r1' }],
      series: [{ id: 2, instanceId: 's1' }],
    });
    expect(mocks.debug).toHaveBeenCalledWith(
      'Arr library load completed',
      expect.objectContaining({ radarrCache: 'miss', sonarrCache: 'hit' }),
      { scope: 'arr-library' },
    );
  });
});
