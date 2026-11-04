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

export function phoneLinkKind(origin: string): PhoneLinkKind {
  const url = new URL(origin);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '::1') return 'loopback';
  if (url.protocol !== 'https:') return 'local';
  // IPv6 counts as local here (isLocalHostname treats every IPv6 literal that way); a
  // public IPv6 address still works from a phone on the same network.
  return isLocalHostname(host) ? 'local' : 'public';
}

/** The QR code's modules for this text: true is a dark square. */
export function qrModules(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data;
}
