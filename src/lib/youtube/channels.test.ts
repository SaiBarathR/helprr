import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  byHandle: vi.fn(),
  byId: vi.fn(),
  taken: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { creator: { findUnique: mocks.taken } } }));
vi.mock('@/lib/archive/subscribe', () => ({ subscribeToCreator: mocks.subscribe }));
vi.mock('@/lib/youtube/sync', () => ({ syncChannelVideos: vi.fn() }));
vi.mock('@/lib/youtube/api', () => ({ channelByHandle: mocks.byHandle, channelById: mocks.byId }));

import { channelFolderBase, followChannel } from './channels';

const CHANNEL_ID = 'UCVlfe3MRSCZSeIWByrWHhkg';
const channel = { id: CHANNEL_ID, title: 'The WAN Show', handle: '@wanshowyt', description: null, avatarUrl: null, bannerUrl: null, uploadsPlaylistId: null };

describe('channel folders', () => {
  it.each([
    ['@wanshowyt', 'wanshowyt'],
    ['@ThePrimeTimeagen', 'theprimetimeagen'],
    ['@Some.Name_1-x', 'some.name_1-x'],
    ['@..sneaky..', 'sneaky'],
    ['@-dash', 'dash'],
    ['@日本語', CHANNEL_ID.toLowerCase()],
    [null, CHANNEL_ID.toLowerCase()],
  ])('turns %s into %s', (handle, folder) => {
    expect(channelFolderBase({ id: CHANNEL_ID, handle })).toBe(folder);
  });
});

describe('following a channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taken.mockResolvedValue(null);
    mocks.subscribe.mockResolvedValue({ creator: { id: 'c' }, subscription: { id: 's' } });
  });

  it('returns nothing for a handle YouTube does not know, and follows nothing', async () => {
    mocks.byHandle.mockResolvedValue(null);
    expect(await followChannel('u', { handle: 'nobody' })).toBeNull();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('follows by handle or id, storing the handle without its @', async () => {
    mocks.byId.mockResolvedValue(channel);
    await followChannel('u', { channelId: CHANNEL_ID });
    expect(mocks.subscribe.mock.calls[0][0]).toMatchObject({
      platform: 'YOUTUBE', externalId: CHANNEL_ID, userId: 'u', folderName: 'wanshowyt',
      profile: { login: 'wanshowyt', displayName: 'The WAN Show' },
    });
  });

  it('keeps folders apart when a handle has passed to another channel', async () => {
    mocks.byHandle.mockResolvedValue(channel);
    mocks.taken.mockResolvedValue({ id: 'someone-else' });
    await followChannel('u', { handle: 'wanshowyt' });
    expect(mocks.subscribe.mock.calls[0][0].folderName).toBe(`wanshowyt-${CHANNEL_ID.slice(-6).toLowerCase()}`);
  });
});
