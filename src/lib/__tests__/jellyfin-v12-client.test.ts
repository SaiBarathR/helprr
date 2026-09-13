import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, create, post } = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ data: { Items: [] } }),
  create: vi.fn(),
  post: vi.fn().mockResolvedValue({ data: { User: { Id: 'member', Name: 'Member' }, AccessToken: 'member-token' } }),
}));
vi.mock('axios', () => ({ default: { create, post, isAxiosError: () => false } }));
import { JellyfinClient } from '@/lib/jellyfin-client';

beforeEach(() => {
  vi.clearAllMocks();
  create.mockReturnValue({ get });
});

const client = () => new JellyfinClient('http://jellyfin.test', 'api-key', 'member');

describe('Jellyfin 12 documented catalog routes', () => {
  it.each([
    ['views', '/UserViews', (c: JellyfinClient) => c.getLibraries()],
    ['latest', '/Items/Latest', (c: JellyfinClient) => c.getRecentlyAdded({ limit: 7 })],
    ['item', '/Items/item', (c: JellyfinClient) => c.getItem('item')],
    ['trailers', '/Items/item/LocalTrailers', (c: JellyfinClient) => c.getLocalTrailers('item')],
    ['extras', '/Items/item/SpecialFeatures', (c: JellyfinClient) => c.getSpecialFeatures('item')],
  ])('scopes %s to the member with a query parameter', async (_name, path, run) => {
    await run(client());
    expect(get).toHaveBeenCalledWith(path, expect.objectContaining({ params: expect.objectContaining({ userId: 'member' }) }));
  });

  it.each(['getItems', 'queryItems', 'getCatalogItems'] as const)('%s preserves filters and cannot override the scoped user', async (method) => {
    await client()[method]({ userId: 'other', UserId: 'other', USERID: 'other', Recursive: false, ParentId: 'library', IncludeItemTypes: 'Movie', StartIndex: 20, Limit: 10 });
    expect(get).toHaveBeenCalledWith('/Items', expect.objectContaining({ params: expect.objectContaining({ UserId: 'member', Recursive: false, ParentId: 'library', IncludeItemTypes: 'Movie', StartIndex: 20, Limit: 10 }) }));
    const keys = Object.keys(get.mock.calls[0][1].params).filter((key) => key.toLowerCase() === 'userid');
    expect(keys).toEqual(['UserId']);
  });

  it('fails closed without a scoped user', async () => {
    await expect(new JellyfinClient('http://jellyfin.test', 'api-key').getCatalogItems()).rejects.toThrow('userId');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('Jellyfin 12 authentication with legacy mechanisms disabled', () => {
  it('uses the standard Authorization header for reads and proxy helpers', () => {
    const c = client();
    const headers = create.mock.calls[0][0].headers;
    expect(headers.Authorization).toContain('Token="api-key"');
    expect(headers).not.toHaveProperty('X-Emby-Token');
    expect(c.tokenHeader()).toEqual({ Authorization: headers.Authorization });
  });

  it('authenticates by name using the standard header and a distinct device identity', async () => {
    await JellyfinClient.authenticateByName('http://jellyfin.test', 'member', 'password');
    const headers = post.mock.calls[0][2].headers;
    expect(headers.Authorization).toContain('DeviceId="helprr-user-');
    expect(headers).not.toHaveProperty('X-Emby-Authorization');
  });
});
