import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Jellyfin applies its Live TV policy only on /LiveTv routes called with the
// user's own token; Helprr lists with the admin key and its media routes serve a
// channel to anyone, so these routes enforce the policy themselves.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), liveTv: vi.fn(), itemAccess: vi.fn(),
  channels: vi.fn(), programs: vi.fn(), recordings: vi.fn(), catalogItems: vi.fn(),
  getItem: vi.fn(), playbackInfo: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/service-helpers', () => ({
  JellyfinNotLinkedError: class JellyfinNotLinkedError extends Error {},
  getJellyfinClientForUser: async () => {
    const client = {
      getLiveTvChannels: mocks.channels,
      getLiveTvPrograms: mocks.programs,
      getLiveTvRecordings: mocks.recordings,
      getCatalogItems: mocks.catalogItems,
      getItem: mocks.getItem,
      withReadSignal: () => client,
    };
    return client;
  },
  getJellyfinPlaybackContext: async () => ({ client: { getItem: mocks.getItem, getPlaybackInfo: mocks.playbackInfo } }),
}));
vi.mock('@/lib/jellyfin-playback/item-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/jellyfin-playback/item-access')>()),
  canUserAccessLiveTv: mocks.liveTv,
  canUserAccessItem: mocks.itemAccess,
}));
vi.mock('@/lib/jellyfin-playback/stream-info', () => ({ buildHelprrStreamInfo: () => ({ ok: true }) }));

const { GET: liveGet } = await import('@/app/api/jellyfin/catalog/live/route');
const { GET: searchGet } = await import('@/app/api/jellyfin/catalog/search/route');
const { POST: infoPost } = await import('@/app/api/jellyfin/stream/info/route');
const { GET: itemsGet } = await import('@/app/api/jellyfin/catalog/items/route');
const { GET: itemGet } = await import('@/app/api/jellyfin/catalog/items/[itemId]/route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'member', jellyfinUserId: 'jf-1' } });
  mocks.channels.mockResolvedValue({ Items: [{ Id: 'ch-1', Type: 'TvChannel' }] });
  mocks.programs.mockResolvedValue({ Items: [{ Id: 'p-1', Type: 'Program' }] });
  mocks.recordings.mockResolvedValue({ Items: [] });
  mocks.catalogItems.mockResolvedValue({ Items: [], TotalRecordCount: 0 });
  mocks.getItem.mockResolvedValue({ Id: 'ch-1', Type: 'TvChannel' });
  mocks.playbackInfo.mockResolvedValue({ MediaSources: [] });
});

describe('Live TV listing', () => {
  it('is empty for an account without Live TV, and asks Jellyfin for nothing', async () => {
    mocks.liveTv.mockResolvedValue(false);
    const res = await liveGet(new NextRequest('http://helprr.test/api/jellyfin/catalog/live'));
    expect(await res.json()).toEqual({ linked: true, liveTvAccess: false, channels: [], programs: [], recordings: [] });
    expect(mocks.channels).not.toHaveBeenCalled();
    expect(mocks.programs).not.toHaveBeenCalled();
  });

  it('lists channels for an account with Live TV', async () => {
    mocks.liveTv.mockResolvedValue(true);
    const body = await (await liveGet(new NextRequest('http://helprr.test/api/jellyfin/catalog/live'))).json();
    expect(body.channels).toEqual([{ Id: 'ch-1', Type: 'TvChannel' }]);
  });
});

describe('Jellyfin search', () => {
  const search = (query: string) => searchGet(new NextRequest(`http://helprr.test/api/jellyfin/catalog/search?${query}`));

  it('drops channels from the default search for an account without Live TV', async () => {
    mocks.liveTv.mockResolvedValue(false);
    await search('q=news');
    const types = mocks.catalogItems.mock.calls[0][0].IncludeItemTypes as string;
    expect(types.split(',')).not.toContain('LiveTvChannel');
    expect(types.split(',')).toContain('Movie');
  });

  it('answers a channels-only search with nothing for that account', async () => {
    mocks.liveTv.mockResolvedValue(false);
    const body = await (await search('q=news&includeItemTypes=LiveTvChannel')).json();
    expect(body.items).toEqual([]);
    expect(mocks.catalogItems).not.toHaveBeenCalled();
  });

  it('cannot be steered past the check with spaces or empty entries', async () => {
    mocks.liveTv.mockResolvedValue(false);
    const body = await (await search('q=news&includeItemTypes=%20LiveTvChannel,')).json();
    expect(body.items).toEqual([]);
    expect(mocks.catalogItems).not.toHaveBeenCalled();
    await search('q=news&includeItemTypes=Movie,%20LiveTvChannel');
    expect(mocks.catalogItems.mock.calls[0][0].IncludeItemTypes).toBe('Movie');
  });

  it('drops a channel that comes back anyway', async () => {
    mocks.liveTv.mockResolvedValue(false);
    mocks.catalogItems.mockResolvedValue({ Items: [{ Id: 'm1', Type: 'Movie' }, { Id: 'ch-1', Type: 'TvChannel' }], TotalRecordCount: 2 });
    const body = await (await search('q=news&includeItemTypes=Movie')).json();
    expect(body.items).toEqual([{ Id: 'm1', Type: 'Movie' }]);
    expect(body.total).toBe(1);
  });

  it('keeps channels for an account with Live TV, and skips the check when none are asked for', async () => {
    mocks.liveTv.mockResolvedValue(true);
    await search('q=news');
    expect(mocks.catalogItems.mock.calls[0][0].IncludeItemTypes).toContain('LiveTvChannel');
    mocks.liveTv.mockClear();
    await search('q=news&includeItemTypes=Movie,Series');
    expect(mocks.liveTv).not.toHaveBeenCalled();
  });
});

describe('Catalog items and item detail', () => {
  it('does not list a channel to an account without Live TV, even by id', async () => {
    mocks.liveTv.mockResolvedValue(false);
    mocks.catalogItems.mockResolvedValue({ Items: [{ Id: 'ch-1', Type: 'TvChannel' }], TotalRecordCount: 1 });
    const body = await (await itemsGet(new NextRequest('http://helprr.test/api/jellyfin/catalog/items?ids=ch-1'))).json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('answers a channel\'s detail with 404 for that account, and leaves films alone', async () => {
    mocks.liveTv.mockResolvedValue(false);
    const detail = (id: string) => itemGet(new NextRequest(`http://helprr.test/api/jellyfin/catalog/items/${id}?expand=none`), { params: Promise.resolve({ itemId: id }) });
    expect((await detail('abc123')).status).toBe(404);
    mocks.getItem.mockResolvedValue({ Id: 'def456', Type: 'Movie' });
    expect((await detail('def456')).status).toBe(200);
  });
});

describe('Playback negotiation', () => {
  const profile = { DirectPlayProfiles: [], TranscodingProfiles: [], SubtitleProfiles: [] };
  const negotiate = () => infoPost(new NextRequest('http://helprr.test/api/jellyfin/stream/info', {
    method: 'POST',
    body: JSON.stringify({ itemId: 'abcdef0123', deviceId: 'device-1', deviceProfile: profile }),
  }));

  it('refuses an item the access check denies before opening any stream', async () => {
    mocks.itemAccess.mockResolvedValue(false);
    expect((await negotiate()).status).toBe(404);
    expect(mocks.playbackInfo).not.toHaveBeenCalled();
    expect(mocks.itemAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'member' }), 'abcdef0123');
  });

  it('negotiates an item the access check allows', async () => {
    mocks.itemAccess.mockResolvedValue(true);
    expect((await negotiate()).status).toBe(200);
    expect(mocks.playbackInfo).toHaveBeenCalledTimes(1);
  });
});
