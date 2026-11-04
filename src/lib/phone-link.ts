import { encode } from 'uqr';
import { isLocalHostname } from '@/lib/local-hostname';

/**
 * Getting from the server's desktop browser to a phone: what a QR code of this
 * address can do, and the code itself.
 *
 * - loopback: localhost and 127.x only work on this computer, so no code is shown.
 * - local: a home-network address or plain http. The phone must be on the same
 *   network, and push will need HTTPS.
 * - public: an https address on the internet, which works anywhere.
 */
export type PhoneLinkKind = 'loopback' | 'local' | 'public';

// Addresses only this computer can open. 0.0.0.0 and :: are what a server prints as
// "listening on every address"; a phone cannot open them.
function isThisComputer(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host === '::ffff:7f00:1'
  );
}

// Home-network IPv4 ranges: private, link-local, and carrier-grade NAT (Tailscale).
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

export function phoneLinkKind(origin: string): PhoneLinkKind {
  const url = new URL(origin);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isThisComputer(host)) return 'loopback';
  if (url.protocol !== 'https:') return 'local';
  // An IPv4 address is local only in a home range; a public one works anywhere.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host) ? 'local' : 'public';
  // IPv6 counts as local here (isLocalHostname treats every IPv6 literal that way); a
  // public IPv6 address still works from a phone on the same network.
  return isLocalHostname(host) ? 'local' : 'public';
}

/** The QR code's modules for this text: true is a dark square. */
export function qrModules(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data;
}
