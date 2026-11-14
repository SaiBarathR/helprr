import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isLanAddress, lanFromSubnets, remoteBitrateCap, REMOTE_FALLBACK_BITRATE, resetRemoteLimitCacheForTests } from '../remote-limit';
import type { JellyfinClient } from '@/lib/jellyfin-client';

// Jellyfin's own rules (NetworkManager InitializeLan / IsInLocalNetwork,
// NetworkUtils.TryParseToSubnet, MediaInfoHelper GetMaxBitrate).

const lan = (...subnets: string[]) => lanFromSubnets(subnets);

describe('Jellyfin\'s LAN', () => {
  it('is loopback and the private IPv4 ranges when none are set, not 169.254/16, and no IPv6 range while IPv6 is off', () => {
    const fallback = lan();
    for (const ip of ['10.1.2.3', '172.20.0.1', '192.168.0.50', '127.0.0.1', '::1', '::ffff:192.168.0.50']) {
      expect(isLanAddress(ip, fallback), ip).toBe(true);
    }
    // fe80::/10 and fc00::/7 count only with IPv6 on (off by default): a
    // Tailscale IPv6 address (fd7a:115c:a1e0::/48) is remote.
    for (const ip of ['169.254.1.1', '100.100.1.2', '203.0.113.9', '2001:db8::1', 'fe80::1', 'fd12::1', 'fd7a:115c:a1e0::1234:5678', 'not-an-ip']) {
      expect(isLanAddress(ip, fallback), ip).toBe(false);
    }
  });

  it('adds the IPv6 ranges when IPv6 is on, and drops the IPv4 ones when IPv4 is off, as Jellyfin builds them', () => {
    const both = lanFromSubnets([], { ipv4: true, ipv6: true });
    expect(isLanAddress('fe80::1', both)).toBe(true);
    expect(isLanAddress('fd7a:115c:a1e0::1234:5678', both)).toBe(true);
    expect(isLanAddress('192.168.0.50', both)).toBe(true);
    const v6only = lanFromSubnets([], { ipv4: false, ipv6: true });
    expect(isLanAddress('192.168.0.50', v6only)).toBe(false);
    expect(isLanAddress('127.0.0.1', v6only)).toBe(true); // loopback always
    // Its own subnets are taken as listed, whichever families are on.
    expect(isLanAddress('fd00::7', lanFromSubnets(['fd00::/8'], { ipv4: true, ipv6: false }))).toBe(true);
  });

  it('matches an address only against subnets of its own family', () => {
    for (const subnets of [['::/0'], ['::ffff:0:0/96'], ['::ffff:203.0.113.0/120']]) {
      expect(isLanAddress('203.0.113.9', lan(...subnets)), subnets[0]).toBe(false);
      expect(isLanAddress('::ffff:203.0.113.9', lan(...subnets)), subnets[0]).toBe(false); // compared as IPv4
    }
    expect(isLanAddress('2001:db8::1', lan('::/0'))).toBe(true);
    expect(isLanAddress('2001:db8::1', lan('0.0.0.0/0'))).toBe(false);
  });

  it('reads a mapped address in either form as its IPv4 one', () => {
    const own = lan('192.168.1.0/24');
    expect(isLanAddress('::ffff:192.168.1.5', own)).toBe(true);
    expect(isLanAddress('::ffff:c0a8:105', own)).toBe(true);
    expect(isLanAddress('::FFFF:C0A8:0105', own)).toBe(true);
    expect(isLanAddress('::ffff:c0a8:205', own)).toBe(false); // 192.168.2.5
  });

  it('reads a bare 0.0.0.0 or :: as "any", as Jellyfin does', () => {
    expect(isLanAddress('203.0.113.9', lan('0.0.0.0'))).toBe(true);
    expect(isLanAddress('2001:db8::1', lan('0.0.0.0'))).toBe(false);
    expect(isLanAddress('2001:db8::1', lan('::'))).toBe(true);
    expect(isLanAddress('203.0.113.9', lan('::'))).toBe(false);
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

  it('skips entries .NET refuses, without failing, and falls back to the defaults when nothing usable is left', () => {
    const refused = ['10.0.0.0/33', 'fd00::/129', '10.0.0.0/8/1', '192.168.1.5/24', '', '!', '10.0.0.0/', '10.0.0.0/ 8', '10.0.0.0/+8', '/8'];
    expect(() => lan(...refused)).not.toThrow();
    // Bits set past the prefix: refused by IPNetwork.TryParse, so skipped.
    const skipped = lan('192.168.1.5/24', '100.64.0.0/10');
    expect(isLanAddress('192.168.1.9', skipped)).toBe(false);
    expect(isLanAddress('100.100.1.2', skipped)).toBe(true);
    // Only refused entries: Jellyfin's defaults, as Jellyfin does.
    for (const list of [refused, ['10.0.0.0/33'], ['', '!']]) {
      expect(isLanAddress('192.168.0.50', lan(...list)), JSON.stringify(list)).toBe(true);
      expect(isLanAddress('203.0.113.9', lan(...list)), JSON.stringify(list)).toBe(false);
    }
  });

  it('ignores a lone or malformed ! that Jellyfin ignores, instead of capping everyone', () => {
    for (const exclusion of ['!', '!/8', '!10.0.0.0/', '!10.0.0.0/ 8', '!10.0.0.0/+8', '!10.0.0.0/33']) {
      const own = lan('192.168.0.0/16', exclusion);
      expect(isLanAddress('192.168.0.50', own), exclusion).toBe(true);
      expect(isLanAddress('10.0.0.1', own), exclusion).toBe(false); // the list's own subnets still decide
    }
  });

  it('reads a single address as that address only', () => {
    const own = lan('192.168.5.7', 'fd00::7');
    expect(isLanAddress('192.168.5.7', own)).toBe(true);
    expect(isLanAddress('192.168.5.8', own)).toBe(false);
    expect(isLanAddress('fd00::7', own)).toBe(true);
    expect(isLanAddress('fd00::8', own)).toBe(false);
  });

  it('fails closed on "! address" with a space after the mark, and trims only the whole entry', () => {
    // .NET may or may not read " 192.168.0.66": Helprr cannot tell, so only loopback stays local.
    const own = lan('192.168.0.0/16', '! 192.168.0.66', '!192.168.0.77');
    expect(isLanAddress('192.168.0.50', own)).toBe(false);
    expect(isLanAddress('192.168.0.66', own)).toBe(false);
    expect(isLanAddress('127.0.0.1', own)).toBe(true);
    const trimmed = lan(' !192.168.0.66 ', '192.168.0.0/16');
    expect(isLanAddress('192.168.0.66', trimmed)).toBe(false);
    expect(isLanAddress('192.168.0.67', trimmed)).toBe(true);
  });

  it('leaves only loopback local when an exclusion is written in a form .NET reads and Node cannot', () => {
    // Jellyfin excludes 192.168.1.8 for "!192.168.1.010" (octal); skipping it would make that host local.
    for (const exclusion of ['!0xc0.168.0.66', '!192.168.1.010', '!10.0', '![fe80::5]', '!fe80::1%eth0', '!nonsense']) {
      const own = lan('192.168.0.0/16', exclusion);
      expect(isLanAddress('192.168.0.50', own), exclusion).toBe(false);
      expect(isLanAddress('10.1.2.3', lan(exclusion)), exclusion).toBe(false);
      expect(isLanAddress('127.0.0.1', own), exclusion).toBe(true);
      expect(isLanAddress('::1', own), exclusion).toBe(true);
    }
  });

  it('does not widen to the defaults when every include is in a form Node cannot read', () => {
    for (const include of ['10.0/16', '192.168.1', '0x0a.0.0.0/8', '[fe80::]/10', 'fe80::%eth0/10', 'nonsense']) {
      const own = lan(include);
      expect(isLanAddress('192.168.0.50', own), include).toBe(false);
      expect(isLanAddress('10.1.2.3', own), include).toBe(false);
      expect(isLanAddress('127.0.0.1', own), include).toBe(true);
    }
  });

  it('skips an unreadable include beside readable ones, which only narrows the LAN', () => {
    const mixed = lan('10.0/16', '192.168.1.0/24', 'fe80::1%eth0');
    expect(isLanAddress('192.168.1.5', mixed)).toBe(true);
    expect(isLanAddress('192.168.2.5', mixed)).toBe(false);
    expect(isLanAddress('10.0.0.5', mixed)).toBe(false);
    expect(isLanAddress('fe80::1', mixed)).toBe(false); // the scoped entry gave no rule
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

  it('counts only loopback as local when the server read fails, and still applies a user limit it read', async () => {
    const failingServer = client({ network: async () => { throw new Error('down'); } });
    // The admin's LAN is unknown, and the defaults could be wider than it.
    expect(await remoteBitrateCap(failingServer, 'c', 'u', '192.168.0.50')).toBe(8_000_000);
    expect(await remoteBitrateCap(failingServer, 'c', 'u', '10.1.2.3')).toBe(8_000_000);
    expect(await remoteBitrateCap(failingServer, 'c', 'u', '127.0.0.1')).toBeUndefined();
    // The user's 8 Mbps decides alone in GetMaxBitrate, whatever the server's is.
    expect(await remoteBitrateCap(failingServer, 'c', 'u', '100.100.1.2')).toBe(8_000_000);
    resetRemoteLimitCacheForTests();
    const lowUser = client({ network: async () => { throw new Error('down'); }, user: async () => ({ Policy: { RemoteClientBitrateLimit: 3_000_000 } }) });
    expect(await remoteBitrateCap(lowUser, 'c', 'u', '203.0.113.9')).toBe(3_000_000);
    resetRemoteLimitCacheForTests();
    const noUserLimit = client({ network: async () => { throw new Error('down'); }, user: async () => ({ Policy: {} }) });
    expect(await remoteBitrateCap(noUserLimit, 'c', 'u', '203.0.113.9')).toBe(REMOTE_FALLBACK_BITRATE); // the server's is unknown
  });

  it('reads Jellyfin\'s IPv6 switch for the default LAN', async () => {
    const ipv6On = client({ network: async () => ({ LocalNetworkSubnets: [], EnableIPv6: true }) });
    expect(await remoteBitrateCap(ipv6On, 'c', 'u', 'fd7a:115c:a1e0::1234:5678')).toBeUndefined();
    resetRemoteLimitCacheForTests();
    const ipv6Default = client({ network: async () => ({ LocalNetworkSubnets: [] }) });
    expect(await remoteBitrateCap(ipv6Default, 'c', 'u', 'fd7a:115c:a1e0::1234:5678')).toBe(8_000_000);
  });

  it('keeps a list with a bad entry, read once, instead of failing every start', async () => {
    const network = vi.fn(async () => ({ LocalNetworkSubnets: ['10.0.0.0/33', '100.64.0.0/10'] }));
    const c = client({ network });
    expect(await remoteBitrateCap(c, 'c', 'u', '100.100.1.2')).toBeUndefined();
    expect(await remoteBitrateCap(c, 'c', 'u', '203.0.113.9')).toBe(8_000_000);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
