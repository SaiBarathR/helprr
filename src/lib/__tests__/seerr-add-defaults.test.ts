import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seerrConnection: vi.fn(),
  resolveConnection: vi.fn(),
  getArrServers: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findFirst: mocks.seerrConnection } } }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.resolveConnection }));
vi.mock('@/lib/service-helpers', () => ({ getSeerrClient: async () => ({ getArrServers: mocks.getArrServers }) }));
vi.mock('@/lib/service-import', async () => {
  const actual = await vi.importActual<typeof import('@/lib/service-import')>('@/lib/service-import');
  return { endpoint: actual.endpoint, seerrServerUrl: actual.seerrServerUrl };
});

import { getSeerrAddDefaults, matchSeerrServer } from '@/lib/seerr-add-defaults';
import type { SeerrArrServer } from '@/lib/seerr-client';

const server = (overrides: Partial<SeerrArrServer>): SeerrArrServer => ({
  id: 1, name: 'Sonarr', hostname: 'sonarr', port: 8989, useSsl: false, baseUrl: '', apiKey: 'other',
  is4k: false, isDefault: false, activeProfileId: 4, activeDirectory: '/tv', ...overrides,
});

describe('matching a Seerr server to a Helprr instance', () => {
  const instance = { url: 'http://192.168.1.5:8989', apiKey: 'key-a' };

  it('matches on the same API key, or the same address', () => {
    expect(matchSeerrServer([server({ id: 1 }), server({ id: 2, apiKey: 'key-a' })], instance)?.id).toBe(2);
    expect(matchSeerrServer([server({ id: 3, hostname: '192.168.1.5' })], instance)?.id).toBe(3);
    expect(matchSeerrServer([server({ id: 4 }), server({ id: 5, hostname: '192.168.1.5', port: 8990 })], instance)).toBeNull();
  });

  it('prefers the regular default server over a 4K one for the same app', () => {
    const servers = [
      server({ id: 1, apiKey: 'key-a', is4k: true, isDefault: true }),
      server({ id: 2, apiKey: 'key-a' }),
      server({ id: 3, apiKey: 'key-a', isDefault: true }),
    ];
    expect(matchSeerrServer(servers, instance)?.id).toBe(3);
    expect(matchSeerrServer(servers.slice(0, 2), instance)?.id).toBe(2);
    expect(matchSeerrServer(servers.slice(0, 1), instance)?.id).toBe(1);
  });
});

describe("Seerr's add defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seerrConnection.mockResolvedValue({ id: 'seerr' });
    mocks.resolveConnection.mockResolvedValue({ url: 'http://sonarr:8989', apiKey: 'key-a' });
  });

  it("gives the matched server's profile and folder, and never its key", async () => {
    mocks.getArrServers.mockResolvedValue([server({ apiKey: 'key-a', activeProfileId: 7, activeDirectory: '/tv-kids' })]);
    expect(await getSeerrAddDefaults('sonarr', 'son-2')).toEqual({
      profileId: '7',
      rootFolder: '/tv-kids',
      // No anime defaults set in Seerr: anime requests use the regular ones.
      anime: { profileId: '7', rootFolder: '/tv-kids' },
    });
    expect(mocks.resolveConnection).toHaveBeenCalledWith('SONARR', 'son-2');
    expect(mocks.getArrServers).toHaveBeenCalledWith('sonarr', expect.any(Number));
  });

  it("gives Seerr's anime profile and folder for Sonarr, each falling back to the regular one", async () => {
    mocks.getArrServers.mockResolvedValueOnce([server({ apiKey: 'key-a', activeAnimeProfileId: 9, activeAnimeDirectory: '/anime' })]);
    expect((await getSeerrAddDefaults('sonarr', 'son-2')).anime).toEqual({ profileId: '9', rootFolder: '/anime' });

    mocks.getArrServers.mockResolvedValueOnce([server({ apiKey: 'key-a', activeAnimeProfileId: 9, activeAnimeDirectory: '' })]);
    expect((await getSeerrAddDefaults('sonarr', 'son-2')).anime).toEqual({ profileId: '9', rootFolder: '/tv' });

    // Radarr has no anime variant.
    mocks.resolveConnection.mockResolvedValueOnce({ url: 'http://radarr:7878', apiKey: 'key-a' });
    mocks.getArrServers.mockResolvedValueOnce([server({ apiKey: 'key-a', activeAnimeProfileId: 9 })]);
    expect(await getSeerrAddDefaults('radarr', 'rad-1')).toEqual({ profileId: '4', rootFolder: '/tv' });
  });

  it('reads as none without Seerr, without a match, or when Seerr fails', async () => {
    mocks.seerrConnection.mockResolvedValueOnce(null);
    expect(await getSeerrAddDefaults('radarr', 'rad-1')).toEqual({ profileId: null, rootFolder: null });
    expect(mocks.getArrServers).not.toHaveBeenCalled();

    mocks.getArrServers.mockResolvedValueOnce([server({ hostname: 'elsewhere' })]);
    expect(await getSeerrAddDefaults('sonarr', 'son-2')).toEqual({ profileId: null, rootFolder: null });

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.getArrServers.mockRejectedValueOnce(new Error('timeout'));
    expect(await getSeerrAddDefaults('sonarr', 'son-2')).toEqual({ profileId: null, rootFolder: null });
  });
});
