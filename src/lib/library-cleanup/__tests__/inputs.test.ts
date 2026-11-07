import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@/lib/config-error';

const mocks = vi.hoisted(() => ({
  radarr: { getMovies: vi.fn(), getTags: vi.fn(), getQueue: vi.fn() },
  sonarr: { getSeries: vi.fn(), getTags: vi.fn(), getQueue: vi.fn() },
  jellyfin: { getUsers: vi.fn(), queryItems: vi.fn() },
  // Per Jellyfin user id: the items each filter returns.
  plays: {} as Record<string, { IsPlayed?: unknown[]; IsResumable?: unknown[] }>,
  jellyfinContext: vi.fn(),
  seerr: { listRequests: vi.fn() },
  getSeerrClient: vi.fn(),
  getRadarrClients: vi.fn(),
  getSonarrClients: vi.fn(),
  watchlist: vi.fn(),
  pending: vi.fn(),
  users: vi.fn(),
  anilist: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({
  getRadarrClients: mocks.getRadarrClients,
  getSonarrClients: mocks.getSonarrClients,
  getJellyfinClientContext: mocks.jellyfinContext,
  getSeerrClient: mocks.getSeerrClient,
}));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => undefined }));
vi.mock('@/lib/jellyfin-client', () => ({
  JellyfinClient: class {
    constructor(_url: string, _key: string, private userId: string) {}
    async queryItems(params: { Filters: 'IsPlayed' | 'IsResumable' }) {
      const items = mocks.plays[this.userId]?.[params.Filters] ?? [];
      return { Items: items, TotalRecordCount: items.length };
    }
  },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    watchlistItem: { findMany: mocks.watchlist },
    pendingRequest: { findMany: mocks.pending },
    user: { findMany: mocks.users },
  },
}));
vi.mock('@/lib/anilist-series-mapping', () => ({ loadAnilistIdsBySeries: mocks.anilist }));

import { gatherLibraryFacts, LibraryCleanupUnavailableError } from '../inputs';

const radarrConnection = { id: 'radarr-1', label: 'Radarr', type: 'RADARR' };
const sonarrConnection = { id: 'sonarr-1', label: 'Sonarr', type: 'SONARR' };

function movie(id: number, tmdbId: number, extra: Record<string, unknown> = {}) {
  return { id, title: `Movie ${id}`, year: 2000, tmdbId, imdbId: `tt${tmdbId}`, sizeOnDisk: 5e9, added: '2024-01-01T00:00:00Z', tags: [], images: [], ratings: { imdb: { value: 6.5, votes: 10 } }, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plays = {};
  mocks.getRadarrClients.mockResolvedValue([{ connection: radarrConnection, client: mocks.radarr }]);
  mocks.getSonarrClients.mockResolvedValue([{ connection: sonarrConnection, client: mocks.sonarr }]);
  mocks.radarr.getMovies.mockResolvedValue([movie(1, 101), movie(2, 102, { tags: [7] }), movie(3, 103)]);
  mocks.radarr.getTags.mockResolvedValue([{ id: 7, label: 'Keep' }]);
  mocks.radarr.getQueue.mockResolvedValue({ records: [{ id: 50, movieId: 3 }], totalRecords: 1 });
  mocks.jellyfinContext.mockResolvedValue({ client: mocks.jellyfin, connection: { url: 'http://jf', apiKey: 'k', username: 'admin' } });
  mocks.jellyfin.getUsers.mockResolvedValue([{ Id: 'jf-a', Name: 'a' }, { Id: 'jf-b', Name: 'b' }]);
  mocks.jellyfin.queryItems.mockResolvedValue({
    Items: [
      { Id: 'm1', ProviderIds: { Tmdb: '101' } },
      { Id: 'm1-copy', ProviderIds: { Imdb: 'TT101' } },
      { Id: 'm2', ProviderIds: { Tmdb: '102' } },
      { Id: 'm3', ProviderIds: { Tmdb: '103' } },
    ],
    TotalRecordCount: 4,
  });
  mocks.getSeerrClient.mockResolvedValue(mocks.seerr);
  mocks.seerr.listRequests.mockResolvedValue({ pageInfo: { results: 0 }, results: [] });
  mocks.watchlist.mockResolvedValue([]);
  mocks.pending.mockResolvedValue([]);
  mocks.users.mockResolvedValue([]);
  mocks.anilist.mockResolvedValue(new Map());
});

describe('gatherLibraryFacts', () => {
  it('aggregates plays over every Jellyfin user and every matching item', async () => {
    mocks.plays['jf-a'] = { IsPlayed: [{ Id: 'm1', UserData: { Played: true, PlayCount: 1, LastPlayedDate: '2026-01-01T00:00:00Z' } }] };
    mocks.plays['jf-b'] = { IsResumable: [{ Id: 'm1-copy', UserData: { Played: false, PlayCount: 1, PlaybackPositionTicks: 5, LastPlayedDate: '2026-03-01T00:00:00Z' } }] };
    const { titles } = await gatherLibraryFacts('movie', 'keep');
    const one = titles.find((t) => t.arrId === 1)!;
    expect(one.inJellyfin).toBe(true);
    expect(one.lastWatchedAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // Keep tag matched case-insensitively; the queue marks movie 3 downloading.
    expect(titles.find((t) => t.arrId === 2)!.keepTagged).toBe(true);
    expect(titles.find((t) => t.arrId === 3)!.downloading).toBe(true);
    expect(one.rating).toBe(6.5);
  });

  it('flags a play with no date', async () => {
    mocks.plays['jf-a'] = { IsPlayed: [{ Id: 'm2', UserData: { Played: true, PlayCount: 1 } }] };
    const { titles } = await gatherLibraryFacts('movie', 'keep');
    expect(titles.find((t) => t.arrId === 2)!.watchedWithoutDate).toBe(true);
  });

  it('maps Seerr requests, open state and requesters to titles', async () => {
    mocks.users.mockResolvedValue([{ id: 'helprr-ana', seerrUserId: '5' }]);
    mocks.seerr.listRequests.mockResolvedValue({
      pageInfo: { results: 2 },
      results: [
        { type: 'movie', status: 2, createdAt: '2025-01-01T00:00:00Z', media: { tmdbId: 101, status: 3 }, requestedBy: { id: 5, displayName: 'Ana' } },
        { type: 'movie', status: 5, createdAt: '2024-06-01T00:00:00Z', media: { tmdbId: 102, status: 5 }, requestedBy: { id: 6, username: 'bo' } },
      ],
    });
    const { titles } = await gatherLibraryFacts('movie', 'keep');
    const one = titles.find((t) => t.arrId === 1)!;
    expect(one).toMatchObject({ openRequest: true, requestedBy: ['Ana'], requesterUserIds: ['helprr-ana'] });
    expect(titles.find((t) => t.arrId === 2)).toMatchObject({ openRequest: false, requestedBy: ['bo'] });
  });

  it('protects watchlisted titles, including library-id and AniList saves', async () => {
    mocks.watchlist.mockResolvedValue([
      { userId: 'u1', source: 'TMDB', externalId: '101', mediaType: 'movie', title: 'x' },
      { userId: 'u2', source: 'RADARR', externalId: '3', mediaType: 'movie', title: 'Different title' },
    ]);
    const { titles } = await gatherLibraryFacts('movie', 'keep');
    expect(titles.find((t) => t.arrId === 1)!.watchlistUserIds).toEqual(['u1']);
    expect(titles.find((t) => t.arrId === 3)!.watchlistUserIds).toEqual(['u2']);
    expect(titles.find((t) => t.arrId === 2)!.watchlistUserIds).toEqual([]);
  });

  it('treats Helprr pending requests as open', async () => {
    mocks.pending.mockResolvedValue([{ tmdbId: 103, createdAt: new Date('2025-01-01'), userId: 'u9', user: { displayName: 'Cy' } }]);
    const { titles } = await gatherLibraryFacts('movie', 'keep');
    expect(titles.find((t) => t.arrId === 3)).toMatchObject({ openRequest: true, requestedBy: ['Cy'], requesterUserIds: ['u9'] });
  });

  it('warns but continues when Seerr is not connected', async () => {
    mocks.getSeerrClient.mockRejectedValue(new ConfigurationError('Seerr is not configured.'));
    const { titles, warnings } = await gatherLibraryFacts('movie', 'keep');
    expect(titles).toHaveLength(3);
    expect(warnings[0]).toMatch(/Seerr is not connected/);
  });

  describe('fails closed', () => {
    it.each<[string, () => void]>([
      ['no Radarr instance', () => mocks.getRadarrClients.mockResolvedValue([])],
      ['Radarr unreachable', () => mocks.radarr.getMovies.mockRejectedValue(new Error('ECONNREFUSED'))],
      ['Radarr tags unreadable', () => mocks.radarr.getTags.mockRejectedValue(new Error('500'))],
      ['Radarr queue incomplete', () => mocks.radarr.getQueue.mockResolvedValue({ records: [{ id: 1 }], totalRecords: 5 })],
      ['Radarr queue not a page', () => mocks.radarr.getQueue.mockResolvedValue({})],
      ['Jellyfin not connected', () => mocks.jellyfinContext.mockRejectedValue(new ConfigurationError('Jellyfin is not configured.'))],
      ['Jellyfin unreachable', () => mocks.jellyfin.getUsers.mockRejectedValue(new Error('timeout'))],
      ['Jellyfin has no users', () => mocks.jellyfin.getUsers.mockResolvedValue([])],
      ['Jellyfin library truncated', () => mocks.jellyfin.queryItems.mockResolvedValue({ Items: [], TotalRecordCount: 10 })],
      ['Seerr unreachable', () => mocks.seerr.listRequests.mockRejectedValue(new Error('502'))],
      ['Seerr truncated', () => mocks.seerr.listRequests.mockResolvedValue({ pageInfo: { results: 300 }, results: [] })],
      ['Seerr returns junk', () => mocks.seerr.listRequests.mockResolvedValue({ html: '<login>' })],
    ])('%s', async (_name, arrange) => {
      arrange();
      await expect(gatherLibraryFacts('movie', 'keep')).rejects.toBeInstanceOf(LibraryCleanupUnavailableError);
    });

    it('a Seerr error that is not "not configured" also blocks', async () => {
      mocks.getSeerrClient.mockRejectedValue(new Error('db down'));
      await expect(gatherLibraryFacts('movie', 'keep')).rejects.toBeInstanceOf(LibraryCleanupUnavailableError);
    });
  });

  it('reads series plays from episodes', async () => {
    mocks.sonarr.getSeries.mockResolvedValue([{ id: 9, title: 'Show', year: 2010, tvdbId: 900, tmdbId: null, imdbId: '', added: '2020-01-01T00:00:00Z', tags: [], images: [], ratings: { value: 0, votes: 0 }, statistics: { sizeOnDisk: 1e10 } }]);
    mocks.sonarr.getTags.mockResolvedValue([]);
    mocks.sonarr.getQueue.mockResolvedValue({ records: [], totalRecords: 0 });
    mocks.jellyfin.queryItems.mockResolvedValue({ Items: [{ Id: 's9', ProviderIds: { Tvdb: '900' } }], TotalRecordCount: 1 });
    mocks.plays['jf-b'] = { IsPlayed: [{ Id: 'e1', SeriesId: 's9', UserData: { Played: true, PlayCount: 1, LastPlayedDate: '2026-10-01T00:00:00Z' } }] };
    const { titles } = await gatherLibraryFacts('series', 'keep');
    expect(titles[0]).toMatchObject({ arrId: 9, inJellyfin: true, rating: null, sizeBytes: 1e10 });
    expect(titles[0].lastWatchedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
