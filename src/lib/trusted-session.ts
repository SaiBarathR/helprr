// A session made by trusted-header sign-in carries the username the proxy
// named (claim `tu`), and stays valid only while the proxy still names that
// user: signing out at the proxy, or someone else signing in there on the same
// browser, ends it on the next request. Checked by the request proxy and by
// server auth. Kept free of Node-only imports for the request proxy.

export const TRUSTED_SESSION_CLAIM = 'tu';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/** True for a session from any other sign-in, or a trusted one the proxy still vouches for. */
export function trustedSessionStillVouched(
  claim: unknown,
  headers: Pick<Headers, 'get'>,
  env: RuntimeEnvironment = process.env,
): boolean {
  if (claim === undefined) return true;
  if (typeof claim !== 'string' || !claim) return false;
  // The feature turned off since: such a session is not kept on its own.
  const header = env.HELPRR_TRUSTED_AUTH_HEADER?.trim();
  if (!header) return false;
  return headers.get(header)?.trim() === claim;
}
