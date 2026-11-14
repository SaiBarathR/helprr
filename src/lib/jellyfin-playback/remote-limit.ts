import { BlockList, isIP } from 'net';
import type { JellyfinClient } from '@/lib/jellyfin-client';

/**
 * Jellyfin's "Internet streaming bitrate limit", applied by Helprr.
 *
 * Jellyfin caps a remote client at the lower of the server's
 * `RemoteClientBitrateLimit` and the user's policy one, and it decides
 * "remote" from the address the request comes from. Every playback request
 * reaches Jellyfin from Helprr's own address, which is on Jellyfin's LAN, so
 * Jellyfin treats every viewer as local and never applies either limit
 * (verified against 12.4.0). Helprr knows the viewer's address (behind a
 * trusted proxy, see `getClientIp`), so it makes the same decision and caps
 * the request itself.
 */

/** A remote viewer's cap when Jellyfin's limits cannot be read: Automatic's
 *  old ceiling, so a failed read never means "unlimited". */
export const REMOTE_FALLBACK_BITRATE = 20_000_000;
const CACHE_MS = 60_000;

/** Jellyfin's LAN when `LocalNetworkSubnets` is empty: the private ranges,
 *  loopback and link-local. */
const DEFAULT_LAN = [
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16',
  '::1/128', 'fc00::/7', 'fe80::/10',
];

type ServerLimits = { limit: number; lan: BlockList };
const serverCache = new Map<string, { at: number; value: Promise<ServerLimits> }>();
const userCache = new Map<string, { at: number; value: Promise<number> }>();

function blockList(subnets: string[]): BlockList {
  const list = new BlockList();
  for (const subnet of subnets) {
    const [address, prefix] = subnet.trim().split('/');
    const family = isIP(address);
    if (!family) continue;
    const type = family === 6 ? 'ipv6' : 'ipv4';
    const bits = prefix === undefined ? (family === 6 ? 128 : 32) : Number(prefix);
    if (Number.isInteger(bits)) list.addSubnet(address, bits, type);
  }
  return list;
}

/** Whether `ip` is on the LAN `lan` describes; an IPv4-mapped IPv6 address
 *  counts as its IPv4 one. */
export function isLanAddress(ip: string, lan: BlockList): boolean {
  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip;
  const family = isIP(mapped);
  if (!family) return false;
  return lan.check(mapped, family === 6 ? 'ipv6' : 'ipv4');
}

function cached<T>(cache: Map<string, { at: number; value: Promise<T> }>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  // A failed read is not kept: the next request asks again.
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

/**
 * The highest bitrate this viewer may be served, or undefined for no cap.
 * `serverKey` identifies the Jellyfin connection for the cache. `clientIp`
 * undefined (no trusted proxy tells Helprr the address) counts as remote,
 * since Helprr cannot show the viewer is on the LAN.
 */
export async function remoteBitrateCap(
  client: JellyfinClient,
  serverKey: string,
  jellyfinUserId: string,
  clientIp: string | undefined,
): Promise<number | undefined> {
  try {
    const [server, userLimit] = await Promise.all([
      cached(serverCache, serverKey, async () => {
        const [config, network] = await Promise.all([client.getServerConfiguration(), client.getNetworkConfiguration()]);
        const subnets = (network.LocalNetworkSubnets ?? []).filter((subnet) => typeof subnet === 'string' && subnet.trim());
        return { limit: config.RemoteClientBitrateLimit ?? 0, lan: blockList(subnets.length ? subnets : DEFAULT_LAN) };
      }),
      cached(userCache, `${serverKey}|${jellyfinUserId}`, async () => (await client.getUser(jellyfinUserId)).Policy?.RemoteClientBitrateLimit ?? 0),
    ]);
    if (clientIp && isLanAddress(clientIp, server.lan)) return undefined;
    const limits = [server.limit, userLimit].filter((limit) => Number.isFinite(limit) && limit > 0);
    return limits.length ? Math.min(...limits) : undefined;
  } catch {
    if (clientIp && isLanAddress(clientIp, blockList(DEFAULT_LAN))) return undefined;
    return REMOTE_FALLBACK_BITRATE;
  }
}

export function resetRemoteLimitCacheForTests() {
  serverCache.clear();
  userCache.clear();
}
