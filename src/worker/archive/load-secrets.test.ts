import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkerSecrets } from './load-secrets';

// Fixture values only; the URL is built from parts.
const FROM_ENV = ['from', 'env'].join('-');
const dbUrl = (value: string, host = 'helprr-db') => `postgresql://postgres:${value}@${host}:5432/helprr`;

const dirs: string[] = [];
const secretsDir = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'helprr-worker-secrets-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return dir;
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadWorkerSecrets', () => {
  it('uses the generated secret when the environment has none', () => {
    vi.stubEnv('JWT_SECRET', '');
    loadWorkerSecrets(secretsDir({ jwt_secret: 'generated-secret-value\n' }));
    expect(process.env.JWT_SECRET).toBe('generated-secret-value');
  });

  it('never replaces a secret set in the environment', () => {
    vi.stubEnv('JWT_SECRET', 'from-env');
    loadWorkerSecrets(secretsDir({ jwt_secret: 'generated-secret-value' }));
    expect(process.env.JWT_SECRET).toBe('from-env');
  });

  it('changes nothing without the volume', () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('POSTGRES_PASSWORD', '');
    loadWorkerSecrets('/nonexistent/helprr/worker');
    expect(process.env.JWT_SECRET).toBe('');
    expect(process.env.DATABASE_URL).toBe('');
  });

  it('keeps an explicit DATABASE_URL', () => {
    vi.stubEnv('DATABASE_URL', dbUrl('explicit', 'db.example'));
    vi.stubEnv('POSTGRES_PASSWORD', FROM_ENV);
    loadWorkerSecrets(secretsDir({ postgres_password: 'generated' }));
    expect(process.env.DATABASE_URL).toBe(dbUrl('explicit', 'db.example'));
    expect(process.env.POSTGRES_PASSWORD).toBeUndefined();
  });

  it('builds the URL from POSTGRES_PASSWORD before the generated one', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('POSTGRES_PASSWORD', FROM_ENV);
    loadWorkerSecrets(secretsDir({ postgres_password: 'generated' }));
    expect(process.env.DATABASE_URL).toBe(dbUrl(FROM_ENV));
  });

  it('builds the URL from the generated password when there is no other', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('POSTGRES_PASSWORD', '');
    loadWorkerSecrets(secretsDir({ postgres_password: 'generated\n' }));
    expect(process.env.DATABASE_URL).toBe(dbUrl('generated'));
  });
});
