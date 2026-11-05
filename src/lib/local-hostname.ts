const LOCAL_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localhost'];

/**
 * An address only a home network or this machine uses: private, loopback, link-local or
 * Tailscale (100.64.0.0/10) IPv4; loopback, unique-local or link-local IPv6.
 */
export function isLocalAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = address.toLowerCase();
  return v6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
}

/**
 * A name only a home network uses: a local address (above), localhost, a single-label
 * name, or a local-only suffix. DNS rebinding needs a public domain the attacker controls,
 * so an address like this cannot be one. A public IP address is not one: a server's
 * public address is the internet's too. The one residual case: a single-label name
 * completed through a DNS search domain whose wildcard record a hostile network
 * controls. Setting APP_ORIGIN closes it.
 */
export function isLocalHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost') return true;
  if (name.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return isLocalAddress(name);
  if (!name.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
