const LOCAL_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localhost'];

/**
 * A name only a home network uses: an IP address, localhost, a single-label name,
 * or a local-only suffix. DNS rebinding needs a public domain the attacker controls,
 * so an address like this cannot be one. The one residual case: a single-label name
 * completed through a DNS search domain whose wildcard record a hostile network
 * controls. Setting APP_ORIGIN closes it.
 */
export function isLocalHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.includes(':')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true;
  if (!name.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
