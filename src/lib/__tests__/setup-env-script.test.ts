import { spawnSync } from 'child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from '@/lib/runtime-config';

const repoRoot = process.cwd();
const fixtureRoots: string[] = [];

function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'helprr-setup-env-'));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(path.join(repoRoot, 'scripts/setup-env.sh'), path.join(root, 'scripts/setup-env.sh'));
  copyFileSync(path.join(repoRoot, '.env.example'), path.join(root, '.env.example'));
  copyFileSync(path.join(repoRoot, '.env.dev.example'), path.join(root, '.env.dev.example'));
  chmodSync(path.join(root, 'scripts/setup-env.sh'), 0o755);
  return root;
}

function runSetup(root: string, args: string[] = [], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync('/bin/sh', [path.join(root, 'scripts/setup-env.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

function parseEnv(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    parsed[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return parsed;
}

function expectNoTemporaryFiles(root: string): void {
  expect(readdirSync(root).filter((name) => name.startsWith('.helprr-env.'))).toEqual([]);
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('setup-env.sh', () => {
  it('creates a private stable env with independent valid secrets without printing them', () => {
    const root = createFixture();
    const result = runSetup(root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const target = path.join(root, '.env');
    const content = readFileSync(target, 'utf8');
    const env = parseEnv(content);
    const secrets = [
      env.POSTGRES_PASSWORD,
      env.REDIS_PASSWORD,
      env.APP_PASSWORD,
      env.JWT_SECRET,
    ];

    expect(lstatSync(target).mode & 0o777).toBe(0o600);
    expect(secrets).toHaveLength(4);
    expect(new Set(secrets).size).toBe(4);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(result.stdout).not.toContain(secret);
      expect(result.stderr).not.toContain(secret);
    }

    expect(() =>
      validateRuntimeConfig({
        DATABASE_URL: `postgresql://postgres:${env.POSTGRES_PASSWORD}@helprr-db:5432/helprr`,
        REDIS_URL: 'redis://helprr-redis:6379',
        REDIS_PASSWORD: env.REDIS_PASSWORD,
        APP_PASSWORD: env.APP_PASSWORD,
        JWT_SECRET: env.JWT_SECRET,
      }),
    ).not.toThrow();
    expectNoTemporaryFiles(root);
  });

  it('creates an isolated private development env with valid development-only secrets', () => {
    const root = createFixture();
    const result = runSetup(root, ['--dev']);

    expect(result.status).toBe(0);
    const target = path.join(root, '.env.dev');
    const env = parseEnv(readFileSync(target, 'utf8'));
    const secrets = [
      env.HELPRR_DEV_POSTGRES_PASSWORD,
      env.HELPRR_DEV_REDIS_PASSWORD,
      env.HELPRR_DEV_APP_PASSWORD,
      env.HELPRR_DEV_JWT_SECRET,
    ];

    expect(lstatSync(target).mode & 0o777).toBe(0o600);
    expect(existsSync(path.join(root, '.env'))).toBe(false);
    expect(new Set(secrets).size).toBe(4);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(result.stdout).not.toContain(secret);
      expect(result.stderr).not.toContain(secret);
    }

    expect(() =>
      validateRuntimeConfig({
        DATABASE_URL: `postgresql://postgres:${env.HELPRR_DEV_POSTGRES_PASSWORD}@helprr-dev-db:5432/helprr_dev`,
        REDIS_URL: 'redis://helprr-dev-redis:6379',
        REDIS_PASSWORD: env.HELPRR_DEV_REDIS_PASSWORD,
        APP_PASSWORD: env.HELPRR_DEV_APP_PASSWORD,
        JWT_SECRET: env.HELPRR_DEV_JWT_SECRET,
      }),
    ).not.toThrow();
    expectNoTemporaryFiles(root);
  });

  it('refuses to overwrite an existing target', () => {
    const root = createFixture();
    const target = path.join(root, '.env');
    writeFileSync(target, 'OWNER_CONTENT\n', { mode: 0o640 });

    const result = runSetup(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.env already exists; it was not changed.');
    expect(readFileSync(target, 'utf8')).toBe('OWNER_CONTENT\n');
    expect(lstatSync(target).mode & 0o777).toBe(0o640);
    expectNoTemporaryFiles(root);
  });

  it('refuses a dangling symlink target without changing its destination', () => {
    const root = createFixture();
    const destination = path.join(root, 'outside-env');
    symlinkSync(destination, path.join(root, '.env'));

    const result = runSetup(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.env already exists; it was not changed.');
    expect(lstatSync(path.join(root, '.env')).isSymbolicLink()).toBe(true);
    expectNoTemporaryFiles(root);
  });

  it('leaves no target or temporary file when secret generation fails', () => {
    const root = createFixture();
    const fakeBin = path.join(root, 'fake-bin');
    mkdirSync(fakeBin);
    const fakeOpenSsl = path.join(fakeBin, 'openssl');
    writeFileSync(fakeOpenSsl, '#!/bin/sh\nexit 1\n');
    chmodSync(fakeOpenSsl, 0o755);

    const result = runSetup(root, [], {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('openssl could not generate a secret.');
    expect(() => lstatSync(path.join(root, '.env'))).toThrow();
    expectNoTemporaryFiles(root);
  });

  it('shows help without creating an environment file', () => {
    const root = createFixture();
    const result = runSetup(root, ['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: setup-env.sh');
    expect(() => lstatSync(path.join(root, '.env'))).toThrow();
    expect(() => lstatSync(path.join(root, '.env.dev'))).toThrow();
  });
});
