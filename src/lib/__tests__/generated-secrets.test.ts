import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { user: { count: mocks.count } } }));

import { checkGeneratedSecretsAtStartup, secretsStatus } from '@/lib/generated-secrets';

const NOW = Date.UTC(2026, 10, 4, 12);
const createdAt = (msAgo: number) => String(Math.floor((NOW - msAgo) / 1000));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('checkGeneratedSecretsAtStartup', () => {
  it('warns when users are older than a freshly generated secret (the volume was lost)', async () => {
    vi.stubEnv('HELPRR_JWT_SECRET_SOURCE', 'generated');
    vi.stubEnv('HELPRR_JWT_SECRET_CREATED_AT', createdAt(60_000));
    mocks.count.mockResolvedValue(3);
    await checkGeneratedSecretsAtStartup(NOW);
    expect(secretsStatus().lostSecret).toBe(true);
    expect(mocks.count).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(Number(createdAt(60_000)) * 1000) } } });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Restore the volume from a backup'));
  });

  it('stays quiet on a fresh install, whose users come after the secret', async () => {
    vi.stubEnv('HELPRR_JWT_SECRET_SOURCE', 'generated');
    vi.stubEnv('HELPRR_JWT_SECRET_CREATED_AT', createdAt(60_000));
    mocks.count.mockResolvedValue(0);
    await checkGeneratedSecretsAtStartup(NOW);
    expect(secretsStatus().lostSecret).toBe(false);
  });

  it('stops saying it two weeks after the secret was made', async () => {
    vi.stubEnv('HELPRR_JWT_SECRET_SOURCE', 'generated');
    vi.stubEnv('HELPRR_JWT_SECRET_CREATED_AT', createdAt(15 * 24 * 3600 * 1000));
    await checkGeneratedSecretsAtStartup(NOW);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(secretsStatus().lostSecret).toBe(false);
  });

  it('has nothing to say for a secret from .env', async () => {
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
    await checkGeneratedSecretsAtStartup(NOW);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});

describe('secretsStatus', () => {
  it('names the source of each, never the value', () => {
    vi.stubEnv('JWT_SECRET', 'secret-value-that-must-not-appear');
    vi.stubEnv('HELPRR_JWT_SECRET_SOURCE', 'generated');
    vi.stubEnv('HELPRR_VAPID_SOURCE', '');
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
    const status = secretsStatus();
    expect(status).toMatchObject({ sessionSecret: 'generated', pushKeys: 'env' });
    expect(JSON.stringify(status)).not.toContain('secret-value');
  });

  it('says when push keys are missing', () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('HELPRR_VAPID_SOURCE', '');
    expect(secretsStatus().pushKeys).toBe('missing');
  });
});
