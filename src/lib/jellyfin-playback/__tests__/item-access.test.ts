import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';

const getItems = vi.fn();
const getUser = vi.fn();
const getJellyfinUserContext = vi.fn();
const redisGet = vi.fn();
const redisSet = vi.fn();
const getRedisClient = vi.fn();

vi.mock('@/lib/service-helpers', () => ({
  getJellyfinUserContext: (user: User) => getJellyfinUserContext(user),
}));
vi.mock('@/lib/redis', () => ({
  getRedisClient: () => getRedisClient(),
}));

const { canUserAccessItem, canUserAccessLiveTv } = await import('@/lib/jellyfin-playback/item-access');

const USER = { id: 'user-1' } as User;

beforeEach(() => {
  vi.clearAllMocks();
  getJellyfinUserContext.mockResolvedValue({
    client: { getItems, getUser },
    jellyfinUserId: 'jf-1',
    connectionFingerprint: 'fp-1',
  });
  getRedisClient.mockResolvedValue({ get: redisGet, set: redisSet });
  redisGet.mockResolvedValue(null);
  redisSet.mockResolvedValue('OK');
});

describe('canUserAccessItem', () => {
  it('allows an item the linked Jellyfin account can see, and caches the verdict', () => {
    getItems.mockResolvedValue({ Items: [{ Id: 'item-1' }] });
    return canUserAccessItem(USER, 'item-1').then((allowed) => {
      expect(allowed).toBe(true);
      expect(redisSet).toHaveBeenCalledWith(expect.stringContaining('jf-1'), '1', { EX: 900 });
    });
  });

  it('denies an item the account cannot see', async () => {
    getItems.mockResolvedValue({ Items: [] });
    expect(await canUserAccessItem(USER, 'item-2')).toBe(false);
    expect(redisSet).toHaveBeenCalledWith(expect.any(String), '0', { EX: 900 });
  });

  it('serves a cached verdict without hitting Jellyfin', async () => {
    redisGet.mockResolvedValue('1');
    expect(await canUserAccessItem(USER, 'item-3')).toBe(true);
    expect(getItems).not.toHaveBeenCalled();
  });

  it('honours a cached denial', async () => {
    redisGet.mockResolvedValue('0');
    expect(await canUserAccessItem(USER, 'item-4')).toBe(false);
    expect(getItems).not.toHaveBeenCalled();
  });

  it('keys the cache per connection, user, and item so verdicts cannot leak across accounts', async () => {
    getItems.mockResolvedValue({ Items: [{ Id: 'x' }] });
    await canUserAccessItem(USER, 'ITEM-5');
    const key = redisSet.mock.calls[0][0] as string;
    expect(key).toContain('fp-1');
    expect(key).toContain('jf-1');
    // Item ids are lowercased so casing cannot produce two verdicts for one item.
    expect(key.endsWith('item-5')).toBe(true);
  });

  it('falls back to a live check when Redis is unavailable', async () => {
    getRedisClient.mockRejectedValue(new Error('redis down'));
    getItems.mockResolvedValue({ Items: [{ Id: 'item-6' }] });
    expect(await canUserAccessItem(USER, 'item-6')).toBe(true);
    expect(getItems).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the account is not linked', async () => {
    getJellyfinUserContext.mockRejectedValue(new Error('not linked'));
    expect(await canUserAccessItem(USER, 'item-7')).toBe(false);
  });

  it('fails closed when Jellyfin errors', async () => {
    getItems.mockRejectedValue(new Error('upstream 500'));
    expect(await canUserAccessItem(USER, 'item-8')).toBe(false);
    expect(redisSet).not.toHaveBeenCalled();
  });

  // Jellyfin returns a channel to /Items for any account and applies its Live TV
  // policy only on /LiveTv routes, so the policy is checked here.
  it('refuses a Live TV channel to an account whose Jellyfin policy has Live TV off', async () => {
    getItems.mockResolvedValue({ Items: [{ Id: 'ch-1', Type: 'TvChannel' }] });
    getUser.mockResolvedValue({ Id: 'jf-1', Policy: { EnableLiveTvAccess: false } });
    expect(await canUserAccessItem(USER, 'ch-1')).toBe(false);
    expect(getUser).toHaveBeenCalledWith('jf-1');
  });

  it('allows the channel with Live TV on, and to a Jellyfin administrator', async () => {
    getItems.mockResolvedValue({ Items: [{ Id: 'ch-2', Type: 'TvChannel' }] });
    getUser.mockResolvedValue({ Id: 'jf-1', Policy: { EnableLiveTvAccess: true } });
    expect(await canUserAccessItem(USER, 'ch-2')).toBe(true);
    getUser.mockResolvedValue({ Id: 'jf-1', Policy: { IsAdministrator: true } });
    expect(await canUserAccessLiveTv(USER)).toBe(true);
  });

  it('does not read verdicts cached before the Live TV check', async () => {
    getItems.mockResolvedValue({ Items: [{ Id: 'ch-4', Type: 'TvChannel' }] });
    getUser.mockResolvedValue({ Id: 'jf-1', Policy: { EnableLiveTvAccess: false } });
    await canUserAccessItem(USER, 'ch-4');
    expect(redisGet.mock.calls[0][0]).toBe('jellyfin:item-access:v2:fp-1:jf-1:ch-4');
  });

  it('refuses the channel when the policy cannot be read, and leaves other items alone', async () => {
    getUser.mockRejectedValue(new Error('upstream 500'));
    getItems.mockResolvedValue({ Items: [{ Id: 'ch-3', Type: 'TvChannel' }] });
    expect(await canUserAccessItem(USER, 'ch-3')).toBe(false);
    getUser.mockClear();
    getItems.mockResolvedValue({ Items: [{ Id: 'movie-1', Type: 'Movie' }] });
    expect(await canUserAccessItem(USER, 'movie-1')).toBe(true);
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe('canUserAccessLiveTv', () => {
  it('caches the verdict per connection and Jellyfin user', async () => {
    getUser.mockResolvedValue({ Id: 'jf-1', Policy: { EnableLiveTvAccess: false } });
    expect(await canUserAccessLiveTv(USER)).toBe(false);
    expect(redisSet).toHaveBeenCalledWith('jellyfin:livetv-access:fp-1:jf-1', '0', { EX: 900 });
    redisGet.mockResolvedValue('1');
    getUser.mockClear();
    expect(await canUserAccessLiveTv(USER)).toBe(true);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('fails closed when the account is not linked', async () => {
    getJellyfinUserContext.mockRejectedValue(new Error('not linked'));
    expect(await canUserAccessLiveTv(USER)).toBe(false);
  });
});
