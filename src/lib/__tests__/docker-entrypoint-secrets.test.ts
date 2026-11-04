import { spawnSync } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

// docker-entrypoint.sh with stub prisma and node, reporting the environment that
// `node server.js` would start with.

const repoRoot = process.cwd();
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function app(secrets: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'helprr-entrypoint-'));
  temporary.push(root);
  copyFileSync(path.join(repoRoot, 'docker-entrypoint.sh'), path.join(root, 'docker-entrypoint.sh'));
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/.bin/prisma'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const names = ['DATABASE_URL', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'HELPRR_JWT_SECRET_SOURCE', 'HELPRR_JWT_SECRET_CREATED_AT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'HELPRR_VAPID_SOURCE'];
  writeFileSync(path.join(bin, 'node'), `#!/bin/sh\n${names.map((n) => `printf '${n}=%s\\n' "\${${n}:-}"`).join('\n')}\n`, { mode: 0o755 });
  const dir = path.join(root, 'secrets', 'app');
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(secrets)) writeFileSync(path.join(dir, name), value);
  return { root, bin, secretsDir: path.join(root, 'secrets') };
}

function run(setup: ReturnType<typeof app>, env: Record<string, string> = {}) {
  return spawnSync('/bin/sh', ['docker-entrypoint.sh'], {
    cwd: setup.root,
    encoding: 'utf8',
    env: { PATH: `${setup.bin}:${process.env.PATH ?? ''}`, HELPRR_SECRETS_DIR: setup.secretsDir, ...env } as unknown as NodeJS.ProcessEnv,
  });
}

function start(setup: ReturnType<typeof app>, env: Record<string, string> = {}) {
  const result = run(setup, env);
  expect(result.status).toBe(0);
  return Object.fromEntries(result.stdout.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

// Fixture values only; the URL is built from parts.
const FROM_ENV = ['from', 'env'].join('-');
const dbUrl = (value: string, host = 'helprr-db') => `postgresql://postgres:${value}@${host}:5432/helprr`;

const generated = {
  jwt_secret: 'g'.repeat(96), 'jwt_secret.created_at': '1793769528', vapid_public: 'PUBLICKEY', vapid_private: 'PRIVATEKEY',
  postgres_password: 'a'.repeat(64), redis_password: 'b'.repeat(64),
};

describe('docker-entrypoint.sh and generated secrets', () => {
  it('uses the generated secrets when .env sets none', () => {
    const env = start(app(generated));
    expect(env).toMatchObject({
      JWT_SECRET: 'g'.repeat(96),
      HELPRR_JWT_SECRET_SOURCE: 'generated',
      HELPRR_JWT_SECRET_CREATED_AT: '1793769528',
      VAPID_PUBLIC_KEY: 'PUBLICKEY',
      VAPID_PRIVATE_KEY: 'PRIVATEKEY',
      HELPRR_VAPID_SOURCE: 'generated',
      VAPID_SUBJECT: 'https://github.com/SaiBarathR/helprr',
    });
  });

  it('lets every value in .env win', () => {
    const env = start(app(generated), {
      JWT_SECRET: 'from-env-secret',
      VAPID_PUBLIC_KEY: 'envpub',
      VAPID_PRIVATE_KEY: 'envpriv',
      VAPID_SUBJECT: 'mailto:me@example.com',
    });
    expect(env).toMatchObject({ JWT_SECRET: 'from-env-secret', HELPRR_JWT_SECRET_SOURCE: '', VAPID_PUBLIC_KEY: 'envpub', VAPID_PRIVATE_KEY: 'envpriv', HELPRR_VAPID_SOURCE: '', VAPID_SUBJECT: 'mailto:me@example.com' });
  });

  it('never pairs a key from .env with a generated one', () => {
    const env = start(app(generated), { VAPID_PUBLIC_KEY: 'envpub' });
    expect(env.VAPID_PRIVATE_KEY).toBe('');
    expect(env.HELPRR_VAPID_SOURCE).toBe('');
  });

  it.each([
    ['https://helprr.example.com', 'https://helprr.example.com'],
    ['http://helprr.lan:3050', 'https://github.com/SaiBarathR/helprr'],
    ['https://localhost:3050', 'https://github.com/SaiBarathR/helprr'],
    ['https://127.0.0.1', 'https://github.com/SaiBarathR/helprr'],
  ])('with APP_ORIGIN %s the push contact is %s', (origin, subject) => {
    expect(start(app(generated), { APP_ORIGIN: origin }).VAPID_SUBJECT).toBe(subject);
  });

  it('changes nothing without the volume (an older Compose file)', () => {
    const url = dbUrl('explicit');
    const env = start(app(), { JWT_SECRET: 'from-env-secret', DATABASE_URL: url, REDIS_PASSWORD: 'from-env-redis' });
    expect(env).toMatchObject({ JWT_SECRET: 'from-env-secret', VAPID_PUBLIC_KEY: '', VAPID_SUBJECT: '', DATABASE_URL: url, REDIS_PASSWORD: 'from-env-redis' });
  });

  it('builds the database URL from the generated password, and uses the generated Redis password', () => {
    expect(start(app(generated))).toMatchObject({
      DATABASE_URL: dbUrl('a'.repeat(64)),
      REDIS_PASSWORD: 'b'.repeat(64),
    });
  });

  it('prefers an explicit DATABASE_URL, then POSTGRES_PASSWORD, and never passes the password on', () => {
    const explicit = dbUrl('explicit', 'db.example');
    expect(start(app(generated), { DATABASE_URL: explicit, POSTGRES_PASSWORD: FROM_ENV })).toMatchObject({ DATABASE_URL: explicit, POSTGRES_PASSWORD: '' });
    expect(start(app(generated), { POSTGRES_PASSWORD: FROM_ENV, REDIS_PASSWORD: `${FROM_ENV}-redis` })).toMatchObject({
      DATABASE_URL: dbUrl(FROM_ENV),
      POSTGRES_PASSWORD: '',
      REDIS_PASSWORD: `${FROM_ENV}-redis`,
    });
  });

  it('refuses to start with no database password at all', () => {
    const result = run(app());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no database password');
    expect(result.stdout).toBe('');
  });
});
