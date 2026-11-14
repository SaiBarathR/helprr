import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Jellyfin sees every playback request come from Helprr, on its LAN, so it
// never applies its Internet streaming limits: the route applies them itself.

const mocks = vi.hoisted(() => ({
  serverConfig: vi.fn(), networkConfig: vi.fn(), user: vi.fn(), playbackInfo: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  requireUserCapability: async () => ({ ok: true, user: { id: 'member', role: 'member', jellyfinUserId: 'jf-1' } }),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({
  getJellyfinPlaybackContext: async () => ({
    client: {
      getServerConfiguration: mocks.serverConfig,
      getNetworkConfiguration: mocks.networkConfig,
      getUser: mocks.user,
      getItem: async () => ({ Id: 'abc', Type: 'Movie' }),
      getPlaybackInfo: mocks.playbackInfo,
    },
    jellyfinUserId: 'jf-1',
    connectionFingerprint: 'conn-1',
  }),
}));
vi.mock('@/lib/jellyfin-playback/item-access', () => ({ itemAccess: async () => true }));
vi.mock('@/lib/jellyfin-playback/live-stream-binding', () => ({
  bindLiveStream: vi.fn(), bindPlaySession: vi.fn(), liveStreamBelongsTo: vi.fn(),
}));
vi.mock('@/lib/jellyfin-playback/stream-info', () => ({ buildHelprrStreamInfo: () => ({ playSessionId: '' }) }));

import { POST } from './route';
import { REMOTE_FALLBACK_BITRATE, resetRemoteLimitCacheForTests } from '@/lib/jellyfin-playback/remote-limit';

const profile = { DirectPlayProfiles: [], TranscodingProfiles: [], SubtitleProfiles: [], MaxStreamingBitrate: 120_000_000 };
async function negotiate(maxStreamingBitrate: number | undefined, forwardedFor?: string) {
  const res = await POST(new NextRequest('http://helprr.test/api/jellyfin/stream/info', {
    method: 'POST',
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    body: JSON.stringify({ itemId: 'abc', deviceId: 'device-1', deviceProfile: profile, maxStreamingBitrate }),
  }));
  const asked = mocks.playbackInfo.mock.calls.at(-1)?.[0];
  return {
    status: res.status,
    body: await res.json(),
    asked: asked?.maxStreamingBitrate as number | undefined,
    profile: asked?.deviceProfile as typeof profile & { MaxStaticBitrate?: number },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRemoteLimitCacheForTests();
  vi.stubEnv('TRUST_FORWARDED_PROTO', 'true');
  mocks.serverConfig.mockResolvedValue({ RemoteClientBitrateLimit: 0 });
  mocks.networkConfig.mockResolvedValue({ LocalNetworkSubnets: [] });
  mocks.user.mockResolvedValue({ Policy: { RemoteClientBitrateLimit: 8_000_000 } });
  mocks.playbackInfo.mockResolvedValue({ MediaSources: [] });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('stream/info and Jellyfin\'s Internet streaming limits', () => {
  it('leaves a viewer on the LAN alone, a picked quality included', async () => {
    const result = await negotiate(80_000_000, '192.168.1.20');
    expect(result.asked).toBe(80_000_000);
    expect(result.body.bitrateCap).toBeUndefined();
  });

  it('caps a remote viewer at the user policy limit, Automatic and picked qualities alike', async () => {
    const automatic = await negotiate(120_000_000, '203.0.113.9');
    expect(automatic.asked).toBe(8_000_000);
    expect(automatic.profile.MaxStreamingBitrate).toBe(8_000_000);
    expect(automatic.profile.MaxStaticBitrate).toBe(8_000_000);
    expect(automatic.body.bitrateCap).toBe(8_000_000);

    expect((await negotiate(4_000_000, '203.0.113.9')).asked).toBe(4_000_000); // already under it
    expect((await negotiate(undefined, '203.0.113.9')).asked).toBe(8_000_000); // no choice sent
  });

  it('takes the lower of the server and user limits, and caps nothing when neither is set', async () => {
    mocks.serverConfig.mockResolvedValue({ RemoteClientBitrateLimit: 5_000_000 });
    expect((await negotiate(120_000_000, '203.0.113.9')).asked).toBe(5_000_000);

    resetRemoteLimitCacheForTests();
    mocks.serverConfig.mockResolvedValue({ RemoteClientBitrateLimit: 0 });
    mocks.user.mockResolvedValue({ Policy: { RemoteClientBitrateLimit: 0 } });
    const unlimited = await negotiate(120_000_000, '203.0.113.9');
    expect(unlimited.asked).toBe(120_000_000);
    expect(unlimited.body.bitrateCap).toBeUndefined();
  });

  it('uses Jellyfin\'s own LAN subnets where it has them', async () => {
    mocks.networkConfig.mockResolvedValue({ LocalNetworkSubnets: ['100.64.0.0/10', '192.168.5.7'] });
    expect((await negotiate(120_000_000, '100.100.1.2')).asked).toBe(120_000_000);
    expect((await negotiate(120_000_000, '::ffff:192.168.5.7')).asked).toBe(120_000_000);
    expect((await negotiate(120_000_000, '192.168.1.20')).asked).toBe(8_000_000); // not on that list
  });

  it('counts a viewer whose address Helprr cannot tell as remote', async () => {
    vi.stubEnv('TRUST_FORWARDED_PROTO', '');
    expect((await negotiate(120_000_000, '192.168.1.20')).asked).toBe(8_000_000);
  });

  it('keeps a conservative cap for a remote viewer when the limits cannot be read', async () => {
    mocks.user.mockRejectedValue(new Error('jellyfin down'));
    expect((await negotiate(120_000_000, '203.0.113.9')).asked).toBe(REMOTE_FALLBACK_BITRATE);
    expect((await negotiate(120_000_000, '192.168.1.20')).asked).toBe(120_000_000);
  });

  it('reads the limits once a minute, not per request', async () => {
    await negotiate(120_000_000, '203.0.113.9');
    await negotiate(120_000_000, '203.0.113.9');
    expect(mocks.serverConfig).toHaveBeenCalledTimes(1);
    expect(mocks.user).toHaveBeenCalledTimes(1);
  });
});
