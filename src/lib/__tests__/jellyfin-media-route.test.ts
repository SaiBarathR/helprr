import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), connection: vi.fn(), token: vi.fn(), invalidate: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/db', () => ({ prisma: { serviceConnection: { findFirst: mocks.connection } } }));
vi.mock('@/lib/service-connection-secrets', () => ({ getConnectionHeaders: () => ({ 'X-Proxy-Auth': 'proxy' }) }));
vi.mock('@/lib/jellyfin-token', () => ({ readJellyfinToken: mocks.token, invalidateJellyfinToken: mocks.invalidate }));
vi.mock('@/lib/jellyfin-playback/item-access', () => ({ canUserAccessItem: mocks.access }));
import { GET, HEAD } from '@/app/api/jellyfin/media/[...path]/route';

const context = { params: Promise.resolve({ path: ['Videos', '0123456789abcdef0123456789abcdef', 'stream.mp4'] }) };
function request(method = 'GET') {
  return new NextRequest('http://helprr.test/api/jellyfin/media/Videos/0123456789abcdef0123456789abcdef/stream.mp4?ApiKey=attacker&api_key=legacy&MediaSourceId=source', {
    method, headers: { Authorization: 'Bearer attacker', Range: 'bytes=0-99' },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member' } });
  mocks.access.mockResolvedValue(true);
  mocks.connection.mockResolvedValue({ url: 'http://jellyfin.test/base', apiKey: 'admin-key' });
  mocks.token.mockReturnValue('member-token');
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(new Response(null, { status: 206, headers: { 'Content-Type': 'video/mp4' } }));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('Jellyfin 12 media authorization', () => {
  it.each([['GET', GET], ['HEAD', HEAD]] as const)('%s forwards only the member credential with legacy auth disabled', async (method, handler) => {
    const response = await handler(request(method), context);
    expect(response.status).toBe(206);
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url.toString()).toBe('http://jellyfin.test/base/Videos/0123456789abcdef0123456789abcdef/stream.mp4?MediaSourceId=source');
    expect(options.method).toBe(method);
    expect(options.headers.get('Authorization')).toBe('MediaBrowser Token="member-token"');
    expect(options.headers.has('X-Emby-Token')).toBe(false);
    expect(options.headers.get('Range')).toBe('bytes=0-99');
    expect(options.headers.get('X-Proxy-Auth')).toBe('proxy');
  });
  it('does not substitute the API key for a disconnected member', async () => {
    mocks.token.mockReturnValue(null);
    expect((await GET(request(), context)).status).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('refuses inaccessible items before sending any credentials upstream', async () => {
    mocks.access.mockResolvedValue(false);
    expect((await GET(request(), context)).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('invalidates a revoked member token instead of retrying with the admin key', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(request(), context)).status).toBe(409);
    expect(mocks.invalidate).toHaveBeenCalledWith('member');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
