import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, findFirst, update } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock('axios', () => ({
  default: { get, post, isAxiosError: (e: { isAxiosError?: boolean }) => Boolean(e?.isAxiosError) },
}));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findFirst, update } } }));

import { helixGet, parseHelixDuration, parseRateLimit, requestTwitchAppToken, TwitchCredentialsRejectedError, TwitchNotConfiguredError, verifyTwitchAppToken } from '@/lib/twitch/helix';
import { decryptTwitchToken, encryptTwitchToken } from '@/lib/twitch/token-cipher';

const HOUR = 3_600_000;

function row(expiresInMs: number, token: string | null = 'stored-token') {
  return {
    id: 'c1',
    externalUrl: 'client-id',
    apiKey: 'client-secret',
    accessToken: token ? encryptTwitchToken(token) : null,
    tokenExpiresAt: new Date(Date.now() + expiresInMs),
  };
}

const unauthorized = { isAxiosError: true, response: { status: 401 } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret';
  post.mockResolvedValue({ data: { access_token: 'new-token', expires_in: 5_000_000 } });
  update.mockResolvedValue({});
});

describe('parseHelixDuration', () => {
  it.each([
    ['3h2m1s', 10921],
    ['2m1s', 121],
    ['45s', 45],
    ['1h', 3600],
    ['', 0],
    ['junk', 0],
    [null, 0],
  ])('reads %s', (value, seconds) => {
    expect(parseHelixDuration(value)).toBe(seconds);
  });
});

describe('parseRateLimit', () => {
  it('reads the headers and tolerates their absence', () => {
    expect(parseRateLimit({ 'ratelimit-remaining': '42', 'ratelimit-reset': '1700000000' })).toEqual({
      remaining: 42,
      resetAt: new Date(1_700_000_000_000),
    });
    expect(parseRateLimit({})).toEqual({ remaining: null, resetAt: null });
  });
});

describe('requestTwitchAppToken', () => {
  it('sends credentials in the form body, never the URL', async () => {
    await requestTwitchAppToken('id', 'shh');
    const [url, body] = post.mock.calls[0];
    expect(url).not.toContain('shh');
    expect((body as URLSearchParams).get('client_secret')).toBe('shh');
  });

  it('maps a rejection and drops the axios error that carries the secret', async () => {
    post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 403 }, config: { data: 'client_secret=shh' } });
    await expect(requestTwitchAppToken('id', 'shh')).rejects.toBeInstanceOf(TwitchCredentialsRejectedError);

    post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 }, config: { data: 'client_secret=shh' } });
    await expect(requestTwitchAppToken('id', 'shh')).rejects.toThrow(/^Twitch token request failed \(500\)$/);
  });
});

describe('helixGet', () => {
  it('fails closed without a connection', async () => {
    findFirst.mockResolvedValue(null);
    await expect(helixGet('/users', {})).rejects.toBeInstanceOf(TwitchNotConfiguredError);
  });

  it('uses a stored token that is not close to expiry', async () => {
    findFirst.mockResolvedValue(row(5 * HOUR));
    get.mockResolvedValue({ data: { data: [{ id: '1' }], pagination: { cursor: 'next' } }, headers: {} });

    const page = await helixGet('/users', { id: ['1', '2'] });

    expect(page.data).toEqual([{ id: '1' }]);
    expect(page.cursor).toBe('next');
    expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer stored-token', 'Client-Id': 'client-id' });
  });

  it('refreshes within an hour of expiry and stores the token encrypted', async () => {
    findFirst.mockResolvedValue(row(30 * 60_000));
    get.mockResolvedValue({ data: { data: [] }, headers: {} });

    await helixGet('/users', {});

    expect(post).toHaveBeenCalledTimes(1);
    const saved = update.mock.calls[0][0].data.accessToken as string;
    expect(saved).not.toContain('new-token');
    expect(decryptTwitchToken(saved)).toBe('new-token');
    expect(get.mock.calls[0][1].headers.Authorization).toBe('Bearer new-token');
  });

  it('refreshes once on a 401 and retries', async () => {
    findFirst.mockResolvedValue(row(5 * HOUR));
    get.mockRejectedValueOnce(unauthorized).mockResolvedValueOnce({ data: { data: [] }, headers: {} });

    await helixGet('/users', {});

    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second 401, without the bearer token in the error', async () => {
    findFirst.mockResolvedValue(row(5 * HOUR));
    get.mockRejectedValue({ ...unauthorized, config: { headers: { Authorization: 'Bearer stored-token' } } });

    await expect(helixGet('/users', {})).rejects.toThrow(/^Twitch API request failed \(401\)$/);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('verifyTwitchAppToken', () => {
  it('spends no Helix call and refreshes a revoked token', async () => {
    findFirst.mockResolvedValue(row(5 * HOUR));
    get.mockRejectedValueOnce(unauthorized);

    await verifyTwitchAppToken();

    expect(get.mock.calls[0][0]).toContain('id.twitch.tv/oauth2/validate');
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('token cipher', () => {
  it('round-trips and treats unreadable values as absent', () => {
    const encrypted = encryptTwitchToken('abc');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(decryptTwitchToken(encrypted)).toBe('abc');
    expect(decryptTwitchToken('plaintext')).toBeNull();
    expect(decryptTwitchToken(null)).toBeNull();
    process.env.JWT_SECRET = 'rotated';
    expect(decryptTwitchToken(encrypted)).toBeNull();
  });
});
