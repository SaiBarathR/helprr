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
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from '@/lib/runtime-config';

const repoRoot = process.cwd();
const fixtureRoots: string[] = [];

// A quiet docker for every run, so no test calls the host's real Docker (slow on CI,
// and its volumes would change the output). Tests that need another one stub it.
const quietDockerBin = mkdtempSync(path.join(tmpdir(), 'helprr-setup-docker-'));
writeFileSync(
  path.join(quietDockerBin, 'docker'),
  '#!/bin/sh\ncase "$*" in "compose version --short") echo 2.29.1 ;; "volume inspect"*) exit 1 ;; esac\n',
  { mode: 0o755 },
);
afterAll(() => rmSync(quietDockerBin, { recursive: true, force: true }));

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
  // A caller that sets its own PATH brings its own docker stub (see withStubs).
  const withQuietDocker = env.PATH === process.env.PATH ? { ...env, PATH: `${quietDockerBin}:${env.PATH ?? ''}` } : env;
  return spawnSync('/bin/sh', [path.join(root, 'scripts/setup-env.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: withQuietDocker,
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
    const result = runSetup(root, ['--admin-password']);

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

  it('leaves APP_PASSWORD empty by default, so the first admin is created in the browser', () => {
    const root = createFixture();
    const result = runSetup(root);
    expect(result.status).toBe(0);
    const env = parseEnv(readFileSync(path.join(root, '.env'), 'utf8'));
    expect(env.APP_PASSWORD).toBe('');
    for (const secret of [env.POSTGRES_PASSWORD, env.REDIS_PASSWORD, env.JWT_SECRET]) {
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(result.stdout).toContain('and create your admin account.');
    expect(result.stdout).not.toContain("grep '^APP_PASSWORD='");
    expect(() =>
      validateRuntimeConfig({
        DATABASE_URL: `postgresql://postgres:${env.POSTGRES_PASSWORD}@helprr-db:5432/helprr`,
        REDIS_URL: 'redis://helprr-redis:6379',
        REDIS_PASSWORD: env.REDIS_PASSWORD,
        APP_PASSWORD: env.APP_PASSWORD,
        JWT_SECRET: env.JWT_SECRET,
      }),
    ).not.toThrow();
  });

  it('accepts its flags in either order', () => {
    const root = createFixture();
    expect(runSetup(root, ['--admin-password', '--stable']).status).toBe(0);
    expect(parseEnv(readFileSync(path.join(root, '.env'), 'utf8')).APP_PASSWORD).toMatch(/^[0-9a-f]{64}$/);
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

describe('setup-env.sh friendlier defaults', () => {
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...process.env, HELPRR_SETUP_TZ: 'Europe/Berlin', ...extra });

  it('fills in the timezone, the worker user, and says what to do next', () => {
    const root = createFixture();
    const result = runSetup(root, ['--admin-password'], env());
    expect(result.status).toBe(0);
    const values = parseEnv(readFileSync(path.join(root, '.env'), 'utf8'));
    expect(values.TZ).toBe('Europe/Berlin');
    expect(values.TWITCH_PUID).toBe(String(process.getuid?.() === 0 ? 1000 : process.getuid?.()));
    expect(values.TWITCH_PGID).toMatch(/^\d+$/);
    expect(values.TWITCH_RENDER_GID ?? '').toMatch(/^\d*$/);
    expect(result.stdout).toContain('Timezone: Europe/Berlin, from HELPRR_SETUP_TZ. If that is wrong, change TZ in .env.');
    expect(result.stdout).toContain(`  cd ${root}\n`);
    expect(result.stdout).toContain('1. Start Helprr:  docker compose up -d');
    expect(result.stdout).toContain('sign in as "admin"');
    expect(result.stdout).toContain("To show it on screen:  grep '^APP_PASSWORD=' .env");
    expect(result.stdout).not.toContain(values.APP_PASSWORD);
  });

  it.each(['../../etc/passwd', 'Europe/Berlin\nAPP_PASSWORD=x', 'Europe/Ber lin'])('falls back to Etc/UTC for %j', (zone) => {
    const root = createFixture();
    const result = runSetup(root, [], env({ HELPRR_SETUP_TZ: zone }));
    expect(result.status).toBe(0);
    const content = readFileSync(path.join(root, '.env'), 'utf8');
    expect(parseEnv(content).TZ).toBe('Etc/UTC');
    expect(content.match(/^APP_PASSWORD=/gm)).toHaveLength(1);
    expect(result.stdout).toContain('Timezone: Etc/UTC, from the default; this computer did not say.');
  });

  it('makes the library folder the worker can write to, readable by Jellyfin', () => {
    const root = createFixture();
    runSetup(root, [], env());
    const folder = lstatSync(path.join(root, 'twitch-library'));
    expect(folder.isDirectory()).toBe(true);
    expect(folder.mode & 0o777).toBe(0o775);
  });

  it('leaves an existing library folder alone', () => {
    const root = createFixture();
    mkdirSync(path.join(root, 'twitch-library'), { mode: 0o750 });
    writeFileSync(path.join(root, 'twitch-library', 'kept.mkv'), 'video');
    runSetup(root, [], env());
    expect(lstatSync(path.join(root, 'twitch-library')).mode & 0o777).toBe(0o750);
    expect(existsSync(path.join(root, 'twitch-library', 'kept.mkv'))).toBe(true);
  });

  it('does the same for the development stack, with its own names', () => {
    const root = createFixture();
    const result = runSetup(root, ['--dev'], env());
    expect(result.status).toBe(0);
    const values = parseEnv(readFileSync(path.join(root, '.env.dev'), 'utf8'));
    expect(values.HELPRR_DEV_TZ).toBe('Europe/Berlin');
    expect(lstatSync(path.join(root, 'twitch-library-dev')).isDirectory()).toBe(true);
    expect(existsSync(path.join(root, 'twitch-library'))).toBe(false);
    expect(result.stdout).toContain('docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build');
    expect(result.stdout).toContain('sign in as "dev-admin"');
  });
});

// Small programs placed first on PATH, so the script's checks can be driven.
describe('setup-env.sh checks against stub programs', () => {
  function withStubs(stubs: Record<string, string>): NodeJS.ProcessEnv {
    const bin = mkdtempSync(path.join(tmpdir(), 'helprr-setup-bin-'));
    fixtureRoots.push(bin);
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${quietDockerBin}:${process.env.PATH ?? ''}` };
    delete env.HELPRR_SETUP_TZ;
    return env;
  }
  const quietDocker = 'case "$*" in "compose version --short") echo 2.29.1 ;; "volume inspect"*) exit 1 ;; esac';

  it('reads the timezone from timedatectl', () => {
    const root = createFixture();
    const result = runSetup(root, [], withStubs({ timedatectl: 'echo America/New_York', docker: quietDocker }));
    expect(parseEnv(readFileSync(path.join(root, '.env'), 'utf8')).TZ).toBe('America/New_York');
    expect(result.stdout).toContain('from this computer (timedatectl)');
  });

  it('writes the render group only when the host has one', () => {
    const withGroup = createFixture();
    runSetup(withGroup, [], withStubs({ getent: 'echo render:x:989:', timedatectl: 'echo Etc/UTC', docker: quietDocker }));
    expect(parseEnv(readFileSync(path.join(withGroup, '.env'), 'utf8')).TWITCH_RENDER_GID).toBe('989');

    const without = createFixture();
    runSetup(without, [], withStubs({ getent: 'exit 2', timedatectl: 'echo Etc/UTC', docker: quietDocker }));
    const content = readFileSync(path.join(without, '.env'), 'utf8');
    expect(parseEnv(content).TWITCH_RENDER_GID).toBeUndefined();
    expect(content).toContain('# TWITCH_RENDER_GID=992');
  });

  it.each([
    ['2.17.0', true],
    ['v2.29.1', false],
    ['2.29.1-desktop.1', false],
    ['5.7.0', false],
  ])('warns about Docker Compose %s: %s', (version, warns) => {
    const root = createFixture();
    const result = runSetup(root, [], withStubs({
      timedatectl: 'echo Etc/UTC',
      docker: `case "$*" in "compose version --short") echo ${version} ;; esac`,
    }));
    expect(result.status).toBe(0);
    expect(result.stdout.includes('is too old; Helprr needs 2.18 or newer')).toBe(warns);
  });

  it.each([
    ['exists', 'exit 0', true],
    ['does not exist', 'exit 1', false],
  ])('when the helprr-secrets volume %s, says whether to drop the passwords', (_, inspect, warns) => {
    const root = createFixture();
    const result = runSetup(root, [], withStubs({
      timedatectl: 'echo Etc/UTC',
      docker: `case "$*" in "compose version --short") echo 2.29.1 ;; "volume inspect helprr-secrets") ${inspect} ;; esac`,
    }));
    expect(result.status).toBe(0);
    expect(result.stdout.includes('the helprr-secrets volume exists')).toBe(warns);
  });

  it('says when Docker Compose does not run', () => {
    const root = createFixture();
    const result = runSetup(root, [], withStubs({ timedatectl: 'echo Etc/UTC', docker: 'exit 1' }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"docker compose" did not run');
  });

  it('warns when the port is taken, naming the variable to change', () => {
    const root = createFixture();
    const result = runSetup(root, [], withStubs({
      timedatectl: 'echo Etc/UTC',
      docker: quietDocker,
      ss: 'echo "LISTEN 0 4096 0.0.0.0:3050 0.0.0.0:*"',
    }));
    expect(result.stdout).toContain('Note: port 3050 is already in use. Set HELPRR_PORT in .env before starting.');
  });

  // macOS: netstat -l does not list listeners there, and there is no ss.
  const macNetstat = (state: string) =>
    `printf 'Active Internet connections (including servers)\\ntcp4  0  0  *.3050  *.*  ${state}\\n'`;

  it.each([['LISTEN', true], ['ESTABLISHED', false]])('on a Mac, reads a %s socket on the port with netstat -an', (state, warns) => {
    const root = createFixture();
    const result = runSetup(root, [], withStubs({
      timedatectl: 'echo Etc/UTC',
      docker: quietDocker,
      uname: 'echo Darwin',
      netstat: `[ "$*" = "-an -p tcp" ] || exit 2; ${macNetstat(state)}`,
    }));
    expect(result.stdout.includes('Note: port 3050 is already in use.')).toBe(warns);
  });

  it('says how to fix a library folder the worker cannot write to', () => {
    const root = createFixture();
    mkdirSync(path.join(root, 'twitch-library'));
    // The ls -nd the script reads ownership from, reporting root as the owner.
    const result = runSetup(root, [], withStubs({
      timedatectl: 'echo Etc/UTC',
      docker: quietDocker,
      ls: 'echo "drwxr-xr-x 2 0 0 4096 Nov  4 12:00 twitch-library"',
    }));
    expect(result.stdout).toContain('is not owned by');
    expect(result.stdout).toContain('sudo chown');
  });

  // The root path (SUDO_UID handling and chown) needs the tests to run as root, so it is
  // covered by the real runs on Alpine in Docker instead.
});
