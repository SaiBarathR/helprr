import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));

vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'admin' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: <T,>(handler: T) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { youtubeSettings: { update: mocks.update, updateMany: mocks.updateMany } } }));
vi.mock('@/lib/youtube/settings', () => ({ getYoutubeSettings: mocks.settings }));
vi.mock('@/lib/twitch/token-cipher', () => ({ encryptTwitchToken: (value: string) => `enc:v1:${Buffer.from(value).toString('base64')}` }));

import { DELETE, GET, PUT } from './route';

const SECRET = 'not-a-real-session-value';
const FILE = ['.youtube.com', 'TRUE', '/', 'TRUE', '0', '__Secure-3PSID', SECRET].join('\t');
const put = (body: unknown) => PUT(new NextRequest('http://test/api/youtube/cookies', {
  method: 'PUT',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
}));

describe('the spare account routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({ cookies: 'enc:v1:stored', cookiesValid: true, cookiesCheckedAt: null });
  });

  it('says whether an account is set, and never returns it', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ set: true, valid: true, checkedAt: null });
  });

  it('stores it encrypted, and clears the old verdict', async () => {
    expect((await put({ cookies: FILE })).status).toBe(200);
    const { data } = mocks.update.mock.calls[0][0];
    expect(data.cookies.startsWith('enc:v1:')).toBe(true);
    expect(JSON.stringify(data)).not.toContain(SECRET);
    expect(data).toMatchObject({ cookiesValid: null, cookiesCheckedAt: null });
  });

  it('refuses a bad file, stores nothing and echoes nothing', async () => {
    const response = await put({ cookies: ['.youtube.com', 'TRUE', '/', 'TRUE', '0', 'other', SECRET].join('\t') });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(SECRET);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('removes it completely', async () => {
    expect((await DELETE()).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({ data: { cookies: null, cookiesValid: null, cookiesCheckedAt: null } });
  });
});
