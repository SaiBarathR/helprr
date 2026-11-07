// Client-safe: the shape of a Tonight pick id (128 random bits, base64url).
const TONIGHT_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function isTonightSessionId(value: unknown): value is string {
  return typeof value === 'string' && TONIGHT_ID_RE.test(value);
}
