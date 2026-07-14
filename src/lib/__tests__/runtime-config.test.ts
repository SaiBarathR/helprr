import { describe, expect, it, vi } from 'vitest';
import {
  StartupConfigurationError,
  getValidatedJwtSecret,
  isKnownPlaceholderSecret,
  validateRuntimeConfig,
} from '@/lib/runtime-config';
import { validateRuntimeConfigOrExit } from '@/lib/startup-config';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://helprr:actual-db-secret@db.internal:5432/helprr',
  REDIS_URL: 'redis://redis.internal:6379',
  REDIS_PASSWORD: 'actual-redis-secret',
  JWT_SECRET: 'a-valid-session-secret-that-is-longer-than-32-characters',
  APP_PASSWORD: 'actual-bootstrap-password',
};

function configurationError(env: Record<string, string | undefined>): StartupConfigurationError {
  try {
    validateRuntimeConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(StartupConfigurationError);
    return error as StartupConfigurationError;
  }
  throw new Error('Expected startup configuration validation to fail');
}

describe('runtime startup configuration', () => {
  it('accepts valid required configuration with APP_PASSWORD omitted', () => {
    const env: Record<string, string | undefined> = { ...VALID_ENV };
    delete env.APP_PASSWORD;
    expect(() => validateRuntimeConfig(env)).not.toThrow();
  });

  it('reports every missing required runtime variable in one error', () => {
    const error = configurationError({});
    expect(error.issues.map((issue) => issue.variable)).toEqual([
      'DATABASE_URL',
      'REDIS_URL',
      'REDIS_PASSWORD',
      'JWT_SECRET',
    ]);
    expect(error.message).toContain('Invalid startup configuration:');
  });

  it('validates PostgreSQL and Redis URL schemes', () => {
    const error = configurationError({
      ...VALID_ENV,
      DATABASE_URL: 'mysql://helprr:private-db-value@db.internal/helprr',
      REDIS_URL: 'https://redis.internal:6379',
    });
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variable: 'DATABASE_URL' }),
        expect.objectContaining({ variable: 'REDIS_URL' }),
      ]),
    );
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: 'postgresql://helprr:change-me-postgres@db.internal/helprr' }],
    ['REDIS_PASSWORD', { REDIS_PASSWORD: 'change-me-dev-redis' }],
    ['JWT_SECRET', { JWT_SECRET: 'change-me-to-a-32+-char-random-value' }],
    ['APP_PASSWORD', { APP_PASSWORD: 'change-me-dev-admin-password' }],
  ])('rejects the shipped %s placeholder', (variable, override) => {
    const error = configurationError({ ...VALID_ENV, ...override });
    expect(error.issues).toContainEqual(expect.objectContaining({ variable }));
  });

  it.each([
    'password-add-here',
    'use-a-long-unique-password',
    'use-a-different-long-unique-password',
    'choose-the-first-admin-password',
    'paste-the-32-or-more-character-value-generated-above',
    'replace-me-with-a-secret',
  ])('recognizes the documented placeholder %s', (value) => {
    expect(isKnownPlaceholderSecret(value)).toBe(true);
  });

  it('requires APP_PASSWORD only while an explicit bootstrap-admin reset is requested', () => {
    const env: Record<string, string | undefined> = { ...VALID_ENV };
    delete env.APP_PASSWORD;
    const error = configurationError({
      ...env,
      HELPRR_ADMIN_PASSWORD_RESET: 'true',
    });
    expect(error.issues).toContainEqual({
      variable: 'APP_PASSWORD',
      message: 'is required while HELPRR_ADMIN_PASSWORD_RESET=true',
    });
  });

  it('never includes supplied URLs, passwords, or secrets in validation errors', () => {
    const sensitiveValues = [
      'mysql://helprr:private-db-value@db.internal/helprr',
      'https://redis-user:private-redis-url-value@redis.internal',
      'change-me-private-redis-password',
      'short-private-jwt',
      'change-me-private-admin-password',
    ];
    const error = configurationError({
      DATABASE_URL: sensitiveValues[0],
      REDIS_URL: sensitiveValues[1],
      REDIS_PASSWORD: sensitiveValues[2],
      JWT_SECRET: sensitiveValues[3],
      APP_PASSWORD: sensitiveValues[4],
    });
    for (const value of sensitiveValues) expect(error.message).not.toContain(value);
    expect(error.message).toContain('Secret values are intentionally omitted.');
  });

  it('shares placeholder-safe JWT validation with auth and middleware callers', () => {
    expect(getValidatedJwtSecret(VALID_ENV.JWT_SECRET)).toBe(VALID_ENV.JWT_SECRET);
    expect(() => getValidatedJwtSecret('change-me-to-a-32+-char-random-value')).toThrow(
      StartupConfigurationError,
    );
    expect(() => getValidatedJwtSecret('too-short')).toThrow('must be at least 32 characters');
  });

  it('logs one redacted message and exits when startup configuration is invalid', () => {
    const sensitivePlaceholder = 'change-me-private-runtime-secret';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });

    expect(() =>
      validateRuntimeConfigOrExit({
        ...VALID_ENV,
        REDIS_PASSWORD: sensitivePlaceholder,
      }),
    ).toThrow('process.exit:1');
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0]?.[0]).toContain('REDIS_PASSWORD');
    expect(consoleError.mock.calls[0]?.[0]).not.toContain(sensitivePlaceholder);

    exit.mockRestore();
    consoleError.mockRestore();
  });
});
