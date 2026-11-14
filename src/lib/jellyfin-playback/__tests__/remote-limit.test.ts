import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isLanAddress, lanFromSubnets, remoteBitrateCap, REMOTE_FALLBACK_BITRATE, resetRemoteLimitCacheForTests } from '../remote-limit';
import type { JellyfinClient } from '@/lib/jellyfin-client';

// Jellyfin's own rules (NetworkManager InitializeLan / IsInLocalNetwork,
// NetworkUtils.TryParseToSubnet, MediaInfoHelper GetMaxBitrate).

const lan = (...subnets: string[]) => lanFromSubnets(subnets);

describe('Jellyfin\'s LAN', () => {
  it('is the private ranges, loopback, IPv6 link-local and unique local when none are set, not 169.254/16', () => {
    const fallback = lan();
    for (const ip of ['10.1.2.3', '172.20.0.1', '192.168.0.50', '127.0.0.1', '::1', 'fe80::1', 'fd12::1', '::ffff:192.168.0.50']) {
      expect(isLanAddress(ip, fallback), ip).toBe(true);
    }
    for (const ip of ['169.254.1.1', '100.100.1.2', '203.0.113.9', '2001:db8::1', 'not-an-ip']) {
      expect(isLanAddress(ip, fallback), ip).toBe(false);
    }
  });

  it('honours ! exclusions, with the defaults and with its own subnets', () => {
    const own = lan('192.168.0.0/16', '!192.168.0.66', '!192.168.9.0/24');
    expect(isLanAddress('192.168.0.50', own)).toBe(true);
    expect(isLanAddress('192.168.0.66', own)).toBe(false);
    expect(isLanAddress('192.168.9.4', own)).toBe(false);
    // Only exclusions: the defaults, minus them.
    const onlyExclusions = lan('!10.0.0.5');
    expect(isLanAddress('10.0.0.6', onlyExclusions)).toBe(true);
    expect(isLanAddress('10.0.0.5', onlyExclusions)).toBe(false);
  });

  it('always counts loopback as local, even when its own subnets leave it out', () => {
    const own = lan('192.168.5.0/24', '!127.0.0.0/8');
    expect(isLanAddress('127.0.0.1', own)).toBe(true);
    expect(isLanAddress('::1', own)).toBe(true);
    expect(isLanAddress('10.0.0.1', own)).toBe(false); // not on this list
  });

  it('skips entries .NET cannot parse instead of failing, and falls back when nothing usable is left', () => {
    expect(() => lan('10.0.0.0/33', 'fd00::/129', 'nonsense', '10.0.0.0/8/1', '192.168.1.5/24')).not.toThrow();
    // Bits set past the prefix: refused by IPNetwork.TryParse, so skipped.
    const skipped = lan('192.168.1.5/24', '100.64.0.0/10');
    expect(isLanAddress('192.168.1.9', skipped)).toBe(false);
    expect(isLanAddress('100.100.1.2', skipped)).toBe(true);
    // Nothing usable: Jellyfin's defaults.
    const unusable = lan('10.0.0.0/33', 'nonsense');
    expect(isLanAddress('192.168.0.50', unusable)).toBe(true);
    expect(isLanAddress('203.0.113.9', unusable)).toBe(false);
  });

  it('reads a single address as that address only', () => {
    const own = lan('192.168.5.7', 'fd00::7');
    expect(isLanAddress('192.168.5.7', own)).toBe(true);
    expect(isLanAddress('192.168.5.8', own)).toBe(false);
    expect(isLanAddress('fd00::7', own)).toBe(true);
    expect(isLanAddress('fd00::8', own)).toBe(false);
  });
});

describe('remoteBitrateCap', () => {
  const client = (over: Partial<Record<'server' | 'network' | 'user', () => Promise<unknown>>> = {}) => ({
    getServerConfiguration: over.server ?? (async () => ({ RemoteClientBitrateLimit: 5_000_000 })),
    getNetworkConfiguration: over.network ?? (async () => ({ LocalNetworkSubnets: ['100.64.0.0/10'] })),
    getUser: over.user ?? (async () => ({ Policy: { RemoteClientBitrateLimit: 8_000_000 } })),
  }) as unknown as JellyfinClient;
  beforeEach(() => resetRemoteLimitCacheForTests());

  it('takes the user\'s limit when it has one, else the server\'s, as Jellyfin does', async () => {
    expect(await remoteBitrateCap(client(), 'c', 'u', '203.0.113.9')).toBe(8_000_000); // above the server's: still the user's
    resetRemoteLimitCacheForTests();
    expect(await remoteBitrateCap(client({ user: async () => ({ Policy: { RemoteClientBitrateLimit: 0 } }) }), 'c', 'u', '203.0.113.9')).toBe(5_000_000);
    resetRemoteLimitCacheForTests();
    expect(await remoteBitrateCap(client({ server: async () => ({ RemoteClientBitrateLimit: 0 }), user: async () => ({ Policy: {} }) }), 'c', 'u', '203.0.113.9')).toBeUndefined();
  });

  it('keeps the server\'s own subnets when only the user read fails, and caps a remote viewer conservatively', async () => {
    const failingUser = client({ user: async () => { throw new Error('down'); } });
    expect(await remoteBitrateCap(failingUser, 'c', 'u', '100.100.1.2')).toBeUndefined(); // on the server's LAN list
    expect(await remoteBitrateCap(failingUser, 'c', 'u', '203.0.113.9')).toBe(5_000_000); // the lower of server's and the fallback
    resetRemoteLimitCacheForTests();
    const noServerLimit = client({ server: async () => ({ RemoteClientBitrateLimit: 0 }), user: async () => { throw new Error('down'); } });
    expect(await remoteBitrateCap(noServerLimit, 'c', 'u', '203.0.113.9')).toBe(REMOTE_FALLBACK_BITRATE);
  });

  it('falls back to Jellyfin\'s default LAN when the server read fails', async () => {
    const failingServer = client({ network: async () => { throw new Error('down'); } });
    expect(await remoteBitrateCap(failingServer, 'c', 'u', '192.168.0.50')).toBeUndefined();
    expect(await remoteBitrateCap(failingServer, 'c', 'u', '100.100.1.2')).toBe(REMOTE_FALLBACK_BITRATE);
  });

  it('keeps a list with a bad entry, read once, instead of failing every start', async () => {
    const network = vi.fn(async () => ({ LocalNetworkSubnets: ['10.0.0.0/33', '100.64.0.0/10'] }));
    const c = client({ network });
    expect(await remoteBitrateCap(c, 'c', 'u', '100.100.1.2')).toBeUndefined();
    expect(await remoteBitrateCap(c, 'c', 'u', '203.0.113.9')).toBe(8_000_000);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
