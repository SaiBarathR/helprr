import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { isKnownPlaceholderSecret } from '@/lib/runtime-config';

// ─────────────────────────────────────────────────────────────────────────────
// Trusted-header sign-in: an authenticating proxy (Authelia, Authentik, …) that
// has already signed the visitor in names them in a header, and proves it is
// the proxy with a shared secret in a second header. Off unless both the user
// header and a valid secret are set. Addresses are never trusted: Next route
// handlers cannot see the connecting address, and X-Forwarded-For is the
// visitor's to write. A bad setting turns the feature off with a warning; it
// never stops startup and never prints a value.
// ─────────────────────────────────────────────────────────────────────────────

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export const TRUSTED_AUTH_DEFAULT_SECRET_HEADER = 'X-Helprr-Proxy-Secret';
export const TRUSTED_AUTH_SECRET_MIN_LENGTH = 32;

// An HTTP field name (RFC 9110 token).
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Headers that HTTP, Next.js or Helprr already give a meaning, or store (the
// user agent is kept on the session and in the audit trail; Range and If-*
// are passed on to Jellyfin): never usable here.
const RESERVED_HEADER = /^(?:host|cookie|authorization|proxy-authorization|user-agent|origin|referer|content-[a-z-]+|connection|upgrade|keep-alive|transfer-encoding|te|trailer|expect|accept(?:-[a-z-]+)?|forwarded|x-forwarded-(?:for|proto|host|port|prefix|uri|method|ssl|scheme|server)|x-real-ip|x-request-id|x-nonce|content-security-policy|rsc|next-[a-z-]+|x-middleware-[a-z-]+|x-nextjs-[a-z-]+|x-matched-path|x-invoke-[a-z-]+|x-next-[a-z-]+|x-prerender-revalidate|sec-[a-z-]+|range|if-[a-z-]+)$/i;
// Printable ASCII without spaces: proxies trim and may re-encode anything else,
// so such a secret could never match.
const SECRET_VALUE = /^[\x21-\x7e]+$/;

export interface TrustedAuthConfig {
  /** Lower-cased, as Headers.get matches either way. */
  userHeader: string;
  secretHeader: string;
  secretDigest: Buffer;
  /**
   * Stamped into each session this sign-in makes, so changing the secret ends
   * them. An HMAC of the secret under JWT_SECRET: the token's holder can read
   * it, but cannot test guesses at the secret against it without JWT_SECRET.
   */
  sessionStamp: string;
}

type TrustedAuthState =
  | { enabled: false; problem: string | null }
  | { enabled: true; config: TrustedAuthConfig };

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function readTrustedAuth(env: RuntimeEnvironment): TrustedAuthState {
  const userHeader = env.HELPRR_TRUSTED_AUTH_HEADER?.trim() ?? '';
  const secretHeader = env.HELPRR_TRUSTED_AUTH_SECRET_HEADER?.trim() || TRUSTED_AUTH_DEFAULT_SECRET_HEADER;
  const secret = env.HELPRR_TRUSTED_AUTH_SECRET ?? '';
  const off = (problem: string | null): TrustedAuthState => ({ enabled: false, problem });

  if (!userHeader && !secret) return off(null);
  if (!userHeader) return off('HELPRR_TRUSTED_AUTH_SECRET is set but HELPRR_TRUSTED_AUTH_HEADER is not');
  if (!secret) return off('HELPRR_TRUSTED_AUTH_HEADER is set but HELPRR_TRUSTED_AUTH_SECRET is not');
  if (!HEADER_NAME.test(userHeader)) return off('HELPRR_TRUSTED_AUTH_HEADER is not a valid header name');
  if (!HEADER_NAME.test(secretHeader)) return off('HELPRR_TRUSTED_AUTH_SECRET_HEADER is not a valid header name');
  if (RESERVED_HEADER.test(userHeader)) return off('HELPRR_TRUSTED_AUTH_HEADER names a header with another use');
  if (RESERVED_HEADER.test(secretHeader)) return off('HELPRR_TRUSTED_AUTH_SECRET_HEADER names a header with another use');
  if (userHeader.toLowerCase() === secretHeader.toLowerCase()) {
    return off('HELPRR_TRUSTED_AUTH_HEADER and HELPRR_TRUSTED_AUTH_SECRET_HEADER must be different headers');
  }
  if (secret.length < TRUSTED_AUTH_SECRET_MIN_LENGTH) {
    return off(`HELPRR_TRUSTED_AUTH_SECRET must be at least ${TRUSTED_AUTH_SECRET_MIN_LENGTH} characters`);
  }
  if (!SECRET_VALUE.test(secret)) {
    return off('HELPRR_TRUSTED_AUTH_SECRET must be letters, digits and symbols only, with no spaces');
  }
  if (isKnownPlaceholderSecret(secret)) {
    return off('HELPRR_TRUSTED_AUTH_SECRET must not use an example or change-me value');
  }
  if (!env.JWT_SECRET) return off('JWT_SECRET is required');
  // The proxy's configuration holds this secret; it must not also sign sessions.
  if (secret === env.JWT_SECRET) return off('HELPRR_TRUSTED_AUTH_SECRET must not be the same as JWT_SECRET');

  return {
    enabled: true,
    config: {
      userHeader: userHeader.toLowerCase(),
      secretHeader: secretHeader.toLowerCase(),
      secretDigest: digest(secret),
      sessionStamp: createHmac('sha256', env.JWT_SECRET ?? '')
        .update(JSON.stringify(['helprr:trusted-session', secret]))
        .digest('base64url')
        .slice(0, 22),
    },
  };
}

/** The configuration when trusted-header sign-in is on and valid; null otherwise. */
export function getTrustedAuthConfig(env: RuntimeEnvironment = process.env): TrustedAuthConfig | null {
  const state = readTrustedAuth(env);
  return state.enabled ? state.config : null;
}

/** Why trusted-header sign-in is off although it was configured, or null. Names variables only. */
export function trustedAuthConfigProblem(env: RuntimeEnvironment = process.env): string | null {
  const state = readTrustedAuth(env);
  return state.enabled ? null : state.problem;
}

/**
 * Whether the request carries the proxy's secret. Both sides are hashed first,
 * so the constant-time compare always sees equal lengths and the secret's
 * length never shows in the timing.
 */
export function trustedAuthSecretMatches(config: TrustedAuthConfig, provided: string | null): boolean {
  if (provided === null) return false;
  return timingSafeEqual(digest(provided), config.secretDigest);
}
