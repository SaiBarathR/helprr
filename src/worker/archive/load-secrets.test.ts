import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkerSecrets } from './load-secrets';

const dirs: string[] = [];
const secretFile = (content: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'helprr-worker-secrets-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'jwt_secret'), content);
  return path.join(dir, 'jwt_secret');
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadWorkerSecrets', () => {
  it('uses the generated secret when the environment has none', () => {
    vi.stubEnv('JWT_SECRET', '');
    loadWorkerSecrets(secretFile('generated-secret-value\n'));
    expect(process.env.JWT_SECRET).toBe('generated-secret-value');
  });

  it('never replaces a secret set in the environment', () => {
    vi.stubEnv('JWT_SECRET', 'from-env');
    loadWorkerSecrets(secretFile('generated-secret-value'));
    expect(process.env.JWT_SECRET).toBe('from-env');
  });

  it('changes nothing without the volume', () => {
    vi.stubEnv('JWT_SECRET', '');
    loadWorkerSecrets('/nonexistent/helprr/jwt_secret');
    expect(process.env.JWT_SECRET).toBe('');
  });
});
