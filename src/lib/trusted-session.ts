import { getTrustedAuthConfig } from '@/lib/trusted-auth';

// A session made by trusted-header sign-in carries the username the proxy
// named (claim `tu`) and a stamp of the proxy secret it was made under (claim
// `ts`). It stays valid only while trusted-header sign-in is still validly on
// with that same secret, and the proxy still names that user: signing out at
// the proxy, someone else signing in there on the same browser, or a changed
// or removed secret ends it on the next request. Checked by the request proxy
// and by server auth.

export const TRUSTED_SESSION_USER_CLAIM = 'tu';
export const TRUSTED_SESSION_STAMP_CLAIM = 'ts';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/** True for a session from any other sign-in, or a trusted one the proxy still vouches for. */
export function trustedSessionStillVouched(
  payload: Readonly<Record<string, unknown>>,
  headers: Pick<Headers, 'get'>,
  env: RuntimeEnvironment = process.env,
): boolean {
  const user = payload[TRUSTED_SESSION_USER_CLAIM];
  const stamp = payload[TRUSTED_SESSION_STAMP_CLAIM];
  if (user === undefined && stamp === undefined) return true;
  if (typeof user !== 'string' || !user || typeof stamp !== 'string') return false;
  const config = getTrustedAuthConfig(env);
  if (!config || stamp !== config.sessionStamp) return false;
  return headers.get(config.userHeader)?.trim() === user;
}

/** The claims for a session trusted-header sign-in makes. */
export function trustedSessionClaims(username: string, sessionStamp: string): Record<string, string> {
  return { [TRUSTED_SESSION_USER_CLAIM]: username, [TRUSTED_SESSION_STAMP_CLAIM]: sessionStamp };
}
