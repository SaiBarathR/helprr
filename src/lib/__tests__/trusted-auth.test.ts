import { afterEach, describe, expect, it, vi } from 'vitest';

const timingSafeEqual = vi.hoisted(() => vi.fn());
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, default: { ...actual, timingSafeEqual }, timingSafeEqual };
});

import {
  getTrustedAuthConfig,
  trustedAuthConfigProblem,
  trustedAuthSecretMatches,
} from '@/lib/trusted-auth';
import { redact } from '@/lib/logger';

const SECRET = 'proxy-secret-0123456789abcdefghijklmnop';
const BASE = { HELPRR_TRUSTED_AUTH_HEADER: 'Remote-User', HELPRR_TRUSTED_AUTH_SECRET: SECRET };

afterEach(() => {
  vi.unstubAllEnvs();
  timingSafeEqual.mockClear();
});

describe('trusted-header sign-in configuration', () => {
  it('is off, without a warning, when nothing is set', () => {
    expect(getTrustedAuthConfig({})).toBeNull();
    expect(trustedAuthConfigProblem({})).toBeNull();
  });

  it.each(['X-authentik-username', 'X-Forwarded-User', 'X-Forwarded-Preferred-Username', 'Remote-Email'])('accepts the ordinary proxy header %s', (header) => {
    expect(getTrustedAuthConfig({ ...BASE, HELPRR_TRUSTED_AUTH_HEADER: header })).not.toBeNull();
  });

  it('is on with a user header and a long secret, defaulting the secret header', () => {
    expect(getTrustedAuthConfig(BASE)).toEqual({
      userHeader: 'remote-user',
      secretHeader: 'x-helprr-proxy-secret',
      secretDigest: expect.any(Buffer),
    });
    expect(trustedAuthConfigProblem(BASE)).toBeNull();
  });

  it.each<[Record<string, string>, string]>([
    [{ HELPRR_TRUSTED_AUTH_SECRET: SECRET }, 'HELPRR_TRUSTED_AUTH_HEADER is not'],
    [{ HELPRR_TRUSTED_AUTH_HEADER: 'Remote-User' }, 'HELPRR_TRUSTED_AUTH_SECRET is not'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_SECRET: 'x'.repeat(31) }, 'at least 32 characters'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_SECRET: `${'x'.repeat(31)} y` }, 'no spaces'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_SECRET: `replace-me-${'x'.repeat(30)}` }, 'change-me'],
    [{ ...BASE, JWT_SECRET: SECRET }, 'same as JWT_SECRET'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_HEADER: 'Remote User' }, 'HELPRR_TRUSTED_AUTH_HEADER is not a valid header name'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_SECRET_HEADER: 'X:Secret' }, 'HELPRR_TRUSTED_AUTH_SECRET_HEADER is not a valid header name'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_SECRET_HEADER: 'REMOTE-USER' }, 'must be different headers'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_SECRET_HEADER: 'User-Agent' }, 'SECRET_HEADER names a header with another use'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_SECRET_HEADER: 'x-forwarded-for' }, 'SECRET_HEADER names a header with another use'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_HEADER: 'Cookie' }, 'HELPRR_TRUSTED_AUTH_HEADER names a header with another use'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_HEADER: 'Authorization' }, 'HELPRR_TRUSTED_AUTH_HEADER names a header with another use'],
    [{ ...BASE, HELPRR_TRUSTED_AUTH_HEADER: 'sec-fetch-site' }, 'HELPRR_TRUSTED_AUTH_HEADER names a header with another use'],
  ])('is off with a warning that names the variable, never the value (%#)', (env, problem) => {
    expect(getTrustedAuthConfig(env)).toBeNull();
    const message = trustedAuthConfigProblem(env)!;
    expect(message).toContain(problem);
    expect(message).not.toContain(env.HELPRR_TRUSTED_AUTH_SECRET ?? '\u0000');
  });

  it('compares the secret in constant time on equal-length digests', () => {
    const config = getTrustedAuthConfig(BASE)!;
    expect(trustedAuthSecretMatches(config, SECRET)).toBe(true);
    expect(trustedAuthSecretMatches(config, 'short')).toBe(false);
    expect(trustedAuthSecretMatches(config, `${SECRET}${SECRET}`)).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(3);
    for (const [a, b] of timingSafeEqual.mock.calls) {
      expect(a).toHaveLength(32);
      expect(b).toHaveLength(32);
    }
    expect(trustedAuthSecretMatches(config, null)).toBe(false);
  });
});

describe('logger redaction of the proxy secret', () => {
  it('removes the configured secret from any logged string and the default header from objects', () => {
    vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET', SECRET);
    expect(redact(`headers: X-Custom-Key=${SECRET}; done`)).toBe('headers: X-Custom-Key=[REDACTED]; done');
    expect(redact({ headers: { 'x-helprr-proxy-secret': 'anything', 'remote-user': 'alice' } })).toEqual({
      headers: { 'x-helprr-proxy-secret': '[REDACTED]', 'remote-user': 'alice' },
    });
    expect(JSON.stringify(redact({ nested: [{ value: `pre${SECRET}post` }] }))).not.toContain(SECRET);
  });

  it('leaves strings alone when no secret is set', () => {
    vi.stubEnv('HELPRR_TRUSTED_AUTH_SECRET', '');
    expect(redact('nothing secret here')).toBe('nothing secret here');
  });
});
