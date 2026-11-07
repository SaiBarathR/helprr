import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Where Helprr may send a notification a user configured (ntfy, Gotify,
 * Apprise, a webhook, an SMTP server).
 *
 * For an admin, the same reach as service connections (which only admins
 * manage): http or https, and LAN and loopback addresses are fine, because
 * that is where a self-hosted ntfy or Home Assistant lives. For everyone else,
 * public addresses only (`allowPrivate: false`), so a member cannot use a
 * channel to make the server call something on its own network.
 *
 * Always refused: the link-local range the cloud metadata services answer on
 * (169.254.169.254 and its IPv6 and provider-specific twins), the unspecified,
 * multicast and reserved ranges, those addresses wrapped in IPv6 (NAT64, 6to4,
 * IPv4-compatible), and credentials written into the URL. The check runs
 * twice: on the address as typed, and on every address its name resolves to
 * when the connection is made, so a name that points at a refused address, or
 * is changed to later, is refused too. Redirects to another host are refused
 * by `refuseRedirectToAnotherHost`.
 */
export class OutboundAddressError extends Error {}

export interface OutboundRules {
  /** LAN, loopback and Tailscale addresses: admins only. */
  allowPrivate: boolean;
}

const BLOCKED = new BlockList();
// Link-local: AWS, GCP and Azure metadata (169.254.169.254), AWS ECS task
// metadata (169.254.170.2), and the IPv6 link-local range.
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4');
BLOCKED.addSubnet('fe80::', 10, 'ipv6');
// AWS's IPv6 metadata address, Alibaba Cloud's, Azure's WireServer, and OCI's older one.
BLOCKED.addAddress('fd00:ec2::254', 'ipv6');
BLOCKED.addAddress('100.100.100.200', 'ipv4');
BLOCKED.addAddress('168.63.129.16', 'ipv4');
BLOCKED.addAddress('192.0.0.192', 'ipv4');
// "This network" (0.0.0.0 reaches the local host on Linux), multicast and reserved.
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4');
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4');
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4');
BLOCKED.addAddress('::', 'ipv6');
BLOCKED.addSubnet('ff00::', 8, 'ipv6');

const PRIVATE = new BlockList();
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT, Tailscale
PRIVATE.addSubnet('192.0.0.0', 24, 'ipv4');
PRIVATE.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6'); // unique local

// Names the metadata services answer to without DNS pointing anywhere unusual.
const BLOCKED_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
  'metadata.azure.com',
]);
// Names that only ever mean this machine or the local network.
const PRIVATE_NAME = /^(localhost|.*\.(localhost|local|lan|home|internal|home\.arpa))$/;

export const OUTBOUND_ADDRESS_MESSAGE = 'Helprr does not send to this address (a cloud metadata, link-local or reserved address).';
export const PRIVATE_ADDRESS_MESSAGE = 'Only an admin can send to an address on the local network. Use a public address.';

/** The 16 bytes of an IPv6 address, or null. */
function ipv6Bytes(address: string): number[] | null {
  let text = address;
  let tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    tail = dotted[1].split('.').map(Number);
    text = `${text.slice(0, -dotted[1].length)}0:0`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(':') : []).map((group) => parseInt(group, 16));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const groups = halves.length === 2 ? [...head, ...new Array(8 - head.length - rest.length).fill(0), ...rest] : head;
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
  if (dotted) bytes.splice(12, 4, ...tail);
  return bytes;
}

/** The IPv4 address an IPv6 one carries: NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16), IPv4-compatible (::/96). */
function embeddedIpv4(address: string): string | null {
  const b = ipv6Bytes(address);
  if (!b) return null;
  const v4 = (offset: number) => b.slice(offset, offset + 4).join('.');
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    if (b.slice(4, 12).every((x) => x === 0)) return v4(12);
    if (b[4] === 0 && b[5] === 1) return v4(12);
  }
  if (b[0] === 0x20 && b[1] === 0x02) return v4(2);
  if (b.slice(0, 12).every((x) => x === 0) && !(b[12] === 0 && b[13] === 0 && b[14] === 0)) return v4(12);
  return null;
}

/** Whether an IP address (v4, v6, or IPv4 wrapped in v6) is one Helprr never connects to under these rules. */
export function isBlockedAddress(address: string, rules: OutboundRules = { allowPrivate: true }): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (BLOCKED.check(address, type) || (!rules.allowPrivate && PRIVATE.check(address, type))) return true;
  const inner = family === 6 ? embeddedIpv4(address) : null;
  return inner !== null && isBlockedAddress(inner, rules);
}

/** Whether a hostname (as URL parsing leaves it, IPv6 in brackets) is refused before any lookup. */
export function isBlockedHostname(hostname: string, rules: OutboundRules = { allowPrivate: true }): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (isIP(host) !== 0) return isBlockedAddress(host, rules);
  return !rules.allowPrivate && (PRIVATE_NAME.test(host) || !host.includes('.'));
}

function refusal(rules: OutboundRules, hostname: string): string {
  return !rules.allowPrivate && !isBlockedHostname(hostname) ? PRIVATE_ADDRESS_MESSAGE : OUTBOUND_ADDRESS_MESSAGE;
}

export type OutboundUrlResult = { ok: true; url: URL } | { ok: false; error: string };

/**
 * Parse and check an address a user typed. The scheme must be written out (a
 * notification server on the internet should be https, and guessing http for
 * it would send the message in the clear).
 */
export function checkOutboundUrl(raw: unknown, rules: OutboundRules = { allowPrivate: true }): OutboundUrlResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'Enter the address.' };
  const trimmed = raw.trim();
  if (trimmed.length > 2048) return { ok: false, error: 'This address is too long.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter the full address, starting with https:// or http://.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Enter the full address, starting with https:// or http://.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Leave the user name and password out of the address; use the fields for them.' };
  }
  if (isBlockedHostname(url.hostname, rules)) return { ok: false, error: refusal(rules, url.hostname) };
  return { ok: true, url };
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type LookupOptions = { family?: number | string; all?: boolean; hints?: number };

// dns.lookup runs on libuv's small thread pool, which password hashing and file
// access share; a name server that never answers holds a thread until the
// resolver gives up. At most two channel lookups run at once.
const MAX_CONCURRENT_LOOKUPS = 2;
let activeLookups = 0;
const waitingLookups: Array<() => void> = [];

function withLookupSlot(run: (done: () => void) => void): void {
  const start = () => {
    activeLookups++;
    let released = false;
    run(() => {
      if (released) return;
      released = true;
      activeLookups--;
      waitingLookups.shift()?.();
    });
  };
  if (activeLookups < MAX_CONCURRENT_LOOKUPS) start();
  else waitingLookups.push(start);
}

/**
 * A `dns.lookup` replacement that fails when any address the name resolves to
 * is refused under the rules. Pass it as `lookup` to an HTTP request. IP
 * literals never reach a lookup, so callers also check the hostname with
 * `checkOutboundUrl` / `isBlockedHostname`.
 */
export function createGuardedLookup(rules: OutboundRules) {
  return function guardedLookup(
    hostname: string,
    options: LookupOptions | number | LookupCallback,
    callback?: LookupCallback,
  ): void {
    const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
    const opts = typeof options === 'object' && options !== null ? options : {};
    const family = typeof options === 'number' ? options : opts.family;
    if (isBlockedHostname(hostname, rules)) {
      cb(new OutboundAddressError(refusal(rules, hostname)) as NodeJS.ErrnoException, []);
      return;
    }
    withLookupSlot((done) => {
      dnsLookup(hostname, { family: family as number | undefined, hints: opts.hints, all: true }, (error, addresses) => {
        done();
        if (error) return cb(error, []);
        const list = addresses as LookupAddress[];
        if (list.length === 0 || list.some((entry) => isBlockedAddress(entry.address, rules))) {
          return cb(new OutboundAddressError(refusal(rules, hostname)) as NodeJS.ErrnoException, []);
        }
        if (opts.all) return cb(null, list);
        return cb(null, list[0].address, list[0].family);
      });
    });
  };
}

/** The admin-reach lookup (LAN allowed). */
export const guardedLookup = createGuardedLookup({ allowPrivate: true });

/** Resolve a hostname once through the guard: for clients (SMTP) that take an address, not a lookup. */
export function resolveOutboundHost(hostname: string, rules: OutboundRules = { allowPrivate: true }): Promise<string> {
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal)) {
    return isBlockedAddress(literal, rules)
      ? Promise.reject(new OutboundAddressError(refusal(rules, literal)))
      : Promise.resolve(literal);
  }
  return new Promise((resolve, reject) => {
    createGuardedLookup(rules)(hostname, {}, (error, address) => {
      if (error) reject(error);
      else resolve(address as string);
    });
  });
}
