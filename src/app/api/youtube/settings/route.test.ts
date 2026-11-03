import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'admin' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: <T,>(handler: T) => handler }));
vi.mock('@/lib/db', () => ({ prisma: { youtubeSettings: { update: mocks.update } } }));
vi.mock('@/lib/youtube/settings', () => ({ getYoutubeSettings: mocks.settings }));

import { GET, PUT } from './route';

const put = (body: unknown) => PUT(new NextRequest('http://test/api/youtube/settings', {
  method: 'PUT',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
}));

describe('YouTube settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.mockResolvedValue({ autoDownloadEnabled: false, pollVideosSecs: 600, cookies: 'enc:v1:secret', quotaUsed: 5 });
  });

  it('never returns the spare account', async () => {
    const body = await (await GET()).text();
    expect(body).toBe('{"autoDownloadEnabled":false,"pollVideosSecs":600}');
  });

  it('saves only what it knows, and cannot be told to change the cookies', async () => {
    await put({ autoDownloadEnabled: true, cookies: 'planted', quotaUsed: 0 });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ autoDownloadEnabled: true });
  });

  it.each([60, 90_000, 'often', 600.5])('refuses a check every %s seconds', async (pollVideosSecs) => {
    expect((await put({ pollVideosSecs })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
