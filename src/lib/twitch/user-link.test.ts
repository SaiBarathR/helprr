import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  link: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  subscription: { findMany: vi.fn() },
}));

vi.mock('axios', () => ({
  default: { get: mocks.get, post: mocks.post, isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) },
}));
vi.mock('@/lib/db', () => ({ prisma: { twitchUserLink: mocks.link, twitchSubscription: mocks.subscription } }));
vi.mock('@/lib/twitch/helix', () => ({
  TWITCH_HELIX_URL: 'https://helix',
  getTwitchClientCredentials: async () => ({ clientId: 'id', clientSecret: 'secret' }),
}));

import { decryptTwitchToken, encryptTwitchToken } from '@/lib/twitch/token-cipher';
import { listFollows, pollDeviceLink, startDeviceLink } from '@/lib/twitch/user-link';

const apiError = (message: string) => ({ isAxiosError: true, response: { status: 400, data: { message } }, config: { data: 'client_secret=secret' } });
const pendingLink = () => ({ deviceCode: encryptTwitchToken('dev'), deviceExpires: new Date(Date.now() + 60_000) });
const linked = (expiresIn: number) => ({
  twitchUserId: '9',
  accessToken: encryptTwitchToken('access'),
  refreshToken: encryptTwitchToken('refresh'),
  tokenExpiresAt: new Date(Date.now() + expiresIn),
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'link-test';
  mocks.subscription.findMany.mockResolvedValue([]);
});

describe('device sign-in', () => {
  it('asks only for reading follows, and stores the device code encrypted', async () => {
    mocks.post.mockResolvedValue({ data: { device_code: 'dev', user_code: 'ABCD', verification_uri: 'https://twitch.tv/activate', expires_in: 1800, interval: 5 } });

    const result = await startDeviceLink('u1');

    expect((mocks.post.mock.calls[0][1] as URLSearchParams).get('scopes')).toBe('user:read:follows');
    expect(result).toEqual({ userCode: 'ABCD', verificationUri: 'https://twitch.tv/activate', interval: 5 });
    expect(JSON.stringify(result)).not.toContain('dev');
    const { deviceCode } = mocks.link.upsert.mock.calls[0][0].update;
    expect(deviceCode).not.toBe('dev');
    expect(decryptTwitchToken(deviceCode)).toBe('dev');
    expect(mocks.link.upsert.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  it('keeps waiting while the code has not been entered', async () => {
    mocks.link.findUnique.mockResolvedValue(pendingLink());
    mocks.post.mockRejectedValue(apiError('authorization_pending'));
    expect(await pollDeviceLink('u1')).toBe('pending');
  });

  it('stores tokens encrypted when it is entered', async () => {
    mocks.link.findUnique.mockResolvedValue(pendingLink());
    mocks.post.mockResolvedValue({ data: { access_token: 'a', refresh_token: 'r', expires_in: 100 } });
    mocks.get.mockResolvedValue({ data: { data: [{ id: '9', login: 'me' }] } });

    expect(await pollDeviceLink('u1')).toBe('connected');

    const { data } = mocks.link.update.mock.calls[0][0];
    expect(decryptTwitchToken(data.accessToken)).toBe('a');
    expect(data).toMatchObject({ twitchUserId: '9', login: 'me', deviceCode: null });
  });

  it('reports an expired code, with or without asking Twitch', async () => {
    mocks.link.findUnique.mockResolvedValueOnce(null);
    expect(await pollDeviceLink('u1')).toBe('expired');
    expect(mocks.post).not.toHaveBeenCalled();

    mocks.link.findUnique.mockResolvedValueOnce(pendingLink());
    mocks.post.mockRejectedValue(apiError('invalid device code'));
    expect(await pollDeviceLink('u1')).toBe('expired');
  });

  it('never rethrows the error carrying the client secret', async () => {
    mocks.link.findUnique.mockResolvedValue(pendingLink());
    mocks.post.mockRejectedValue(apiError('invalid client secret'));
    await expect(pollDeviceLink('u1')).rejects.toThrow(/^Twitch sign-in failed$/);
  });
});

describe('listFollows', () => {
  it('is null without a sign-in, for this user only', async () => {
    mocks.link.findUnique.mockResolvedValue(null);
    expect(await listFollows('u1')).toBeNull();
    expect(mocks.link.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('pages through follows and marks what is already subscribed', async () => {
    mocks.link.findUnique.mockResolvedValue(linked(3_600_000));
    mocks.get
      .mockResolvedValueOnce({ data: { data: [{ broadcaster_id: '1', broadcaster_login: 'a', broadcaster_name: 'A' }], pagination: { cursor: 'next' } } })
      .mockResolvedValueOnce({ data: { data: [{ broadcaster_id: '2', broadcaster_login: 'b', broadcaster_name: 'B' }] } });
    mocks.subscription.findMany.mockResolvedValue([{ streamer: { twitchUserId: '2' } }]);

    const follows = await listFollows('u1');

    expect(follows?.map((follow) => [follow.login, follow.subscribed])).toEqual([['a', false], ['b', true]]);
    expect(mocks.get.mock.calls[1][1].params.after).toBe('next');
    expect(mocks.subscription.findMany.mock.calls[0][0].where.userId).toBe('u1');
  });

  it('refreshes an expiring token first', async () => {
    mocks.link.findUnique.mockResolvedValue(linked(60_000));
    mocks.post.mockResolvedValue({ data: { access_token: 'new', refresh_token: 'r2', expires_in: 100 } });
    mocks.get.mockResolvedValue({ data: { data: [] } });

    await listFollows('u1');

    expect(mocks.get.mock.calls[0][1].headers.Authorization).toBe('Bearer new');
  });

  it('asks for a new sign-in when the refresh is refused', async () => {
    mocks.link.findUnique.mockResolvedValue(linked(60_000));
    mocks.post.mockRejectedValue(apiError('invalid refresh token'));
    expect(await listFollows('u1')).toBeNull();
  });
});
