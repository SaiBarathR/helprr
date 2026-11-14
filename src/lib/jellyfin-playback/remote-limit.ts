import { BlockList, isIP } from 'net';
import type { JellyfinClient } from '@/lib/jellyfin-client';

/**
 * Jellyfin's "Internet streaming bitrate limit", applied by Helprr.
 *
 * Jellyfin caps a remote client at the user's policy `RemoteClientBitrateLimit`,
 * or the server's when the user has none (MediaInfoHelper `GetMaxBitrate`), and
 * it decides "remote" from the address the request comes from. Every playback
 * request reaches Jellyfin from Helprr's own address, which is on Jellyfin's
 * LAN, so Jellyfin treats every viewer as local and never applies either limit
 * (verified against 12.4.0). Helprr knows the viewer's address (behind a
 * trusted proxy, see `getClientIp`), so it makes the same decision, by the same
 * rules (NetworkManager `InitializeLan`, `IsInLocalNetwork`), and caps the
 * request itself.
 */

/** A remote viewer's cap when Jellyfin's limits cannot be read: Automatic's
 *  old ceiling, so a failed read never means "unlimited". */
export const REMOTE_FALLBACK_BITRATE = 20_000_000;
const CACHE_MS = 60_000;

/** Jellyfin's LAN when `LocalNetworkSubnets` gives none (NetworkConstants):
 *  loopback, the RFC 1918 ranges, IPv6 link-local and unique local. */
const DEFAULT_LAN = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fe80::/10', 'fc00::/7'];

type Lan = { include: BlockList; exclude: BlockList };
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
type ServerLimits = { limit: number; lan: Lan };
const serverCache = new Map<string, { at: number; value: Promise<ServerLimits> }>();
const userCache = new Map<string, { at: number; value: Promise<number> }>();

/** One `LocalNetworkSubnets` entry as .NET's `IPNetwork.TryParse` reads it: an
 *  address, or an address and a prefix within its size with no bits set past
 *  it. Null for anything else, which Jellyfin skips too. */
function parseSubnet(entry: string): { address: string; prefix: number; type: 'ipv4' | 'ipv6' } | null {
  const [address, prefixText, extra] = entry.split('/');
  const family = isIP(address);
  if (!family || extra !== undefined) return null;
  const size = family === 6 ? 128 : 32;
  const prefix = prefixText === undefined ? size : /^\d+$/.test(prefixText) ? Number(prefixText) : NaN;
  if (!(prefix >= 0 && prefix <= size)) return null;
  const type = family === 6 ? 'ipv6' : 'ipv4';
  // Bits set past the prefix: .NET refuses the network, so Jellyfin skips it.
  if (prefix < size && !hostBitsClear(address, prefix, type)) return null;
  return { address, prefix, type };
}

function hostBitsClear(address: string, prefix: number, type: 'ipv4' | 'ipv6'): boolean {
  const bytes = type === 'ipv4'
    ? address.split('.').map(Number)
    : expandIPv6(address);
  for (let bit = prefix; bit < bytes.length * 8; bit++) {
    if (bytes[bit >> 3] & (0x80 >> (bit & 7))) return false;
  }
  return true;
}

function expandIPv6(address: string): number[] {
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes its two groups.
  const tail = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let text = address;
  if (tail) {
    const [a, b, c, d] = tail[1].split('.').map(Number);
    text = address.slice(0, -tail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest = ''] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = text.includes('::') && rest ? rest.split(':') : [];
  const groups = text.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.flatMap((group) => { const value = parseInt(group || '0', 16); return [value >> 8, value & 0xff]; });
}

/** Jellyfin's LAN from `LocalNetworkSubnets`: its entries, or the defaults
 *  when none of them is a usable subnet, minus the `!` exclusions. */
export function lanFromSubnets(subnets: readonly unknown[]): Lan {
  const include = new BlockList();
  const exclude = new BlockList();
  let included = 0;
  for (const raw of subnets) {
    if (typeof raw !== 'string') continue;
    const entry = raw.trim();
    const negated = entry.startsWith('!');
    const subnet = parseSubnet(negated ? entry.slice(1).trim() : entry);
    if (!subnet) continue;
    (negated ? exclude : include).addSubnet(subnet.address, subnet.prefix, subnet.type);
    if (!negated) included++;
  }
  if (!included) {
    for (const entry of DEFAULT_LAN) {
      const subnet = parseSubnet(entry)!;
      include.addSubnet(subnet.address, subnet.prefix, subnet.type);
    }
  }
  return { include, exclude };
}

/** Whether `ip` is on Jellyfin's LAN: loopback always is; otherwise in a LAN
 *  subnet and in no excluded one. An IPv4-mapped IPv6 address counts as its
 *  IPv4 one. */
export function isLanAddress(ip: string, lan: Lan): boolean {
  const mapped = ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(mapped);
  if (!family) return false;
  const type = family === 6 ? 'ipv6' : 'ipv4';
  if (LOOPBACK.check(mapped, type)) return true;
  return lan.include.check(mapped, type) && !lan.exclude.check(mapped, type);
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
  const [server, user] = await Promise.allSettled([
    cached(serverCache, serverKey, async () => {
      const [config, network] = await Promise.all([client.getServerConfiguration(), client.getNetworkConfiguration()]);
      return { limit: config.RemoteClientBitrateLimit ?? 0, lan: lanFromSubnets(network.LocalNetworkSubnets ?? []) };
    }),
    cached(userCache, `${serverKey}|${jellyfinUserId}`, async () => (await client.getUser(jellyfinUserId)).Policy?.RemoteClientBitrateLimit ?? 0),
  ]);
  // The server's own LAN where it could be read, else Jellyfin's default one.
  const lan = server.status === 'fulfilled' ? server.value.lan : lanFromSubnets([]);
  if (clientIp && isLanAddress(clientIp, lan)) return undefined;
  if (server.status === 'fulfilled' && user.status === 'fulfilled') {
    // The user's limit, else the server's, as Jellyfin's GetMaxBitrate has it.
    const limit = user.value > 0 ? user.value : server.value.limit;
    return Number.isFinite(limit) && limit > 0 ? limit : undefined;
  }
  // A limit that could not be read is never "unlimited": the fallback, or a
  // server limit that was read and is lower (the unread user limit might be
  // higher, but a failed read only ever errs low).
  const serverLimit = server.status === 'fulfilled' ? server.value.limit : 0;
  return serverLimit > 0 ? Math.min(serverLimit, REMOTE_FALLBACK_BITRATE) : REMOTE_FALLBACK_BITRATE;
}

export function resetRemoteLimitCacheForTests() {
  serverCache.clear();
  userCache.clear();
}
