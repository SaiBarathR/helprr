import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

// scripts/install.sh against a local copy of a release (served as file://, which curl
// reads) and a stub `docker`, so nothing is pulled or started.

const repoRoot = process.cwd();
const temporary: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ASSETS: Array<[string, string]> = [
  ['docker-compose.yml', 'docker-compose.yml'],
  ['env.example', '.env.example'],
  ['setup-env.sh', 'scripts/setup-env.sh'],
  ['backup.sh', 'scripts/backup.sh'],
  ['update.sh', 'scripts/update.sh'],
];

/** A release folder with every asset and a SHA256SUMS that lists them. */
function release(tamper?: string): string {
  const dir = tempDir('helprr-release-');
  const sums: string[] = [];
  for (const [name, source] of ASSETS) {
    copyFileSync(path.join(repoRoot, source), path.join(dir, name));
    const hash = createHash('sha256').update(readFileSync(path.join(dir, name))).digest('hex');
    sums.push(`${hash}  ${name}`);
  }
  writeFileSync(path.join(dir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  if (tamper) writeFileSync(path.join(dir, tamper), '# changed after the release\n', { flag: 'a' });
  return dir;
}

/** Stub programs first on PATH. */
function stubs(programs: Record<string, string>): string {
  const bin = tempDir('helprr-install-bin-');
  // A quiet ss: this host may really be using port 3050.
  for (const [name, body] of Object.entries({ ss: 'exit 0', ...programs })) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  return bin;
}

const goodDocker = [
  'case "$*" in',
  '  info) echo ok ;;',
  '  "compose version --short") echo 2.29.1 ;;',
  '  *) echo "unexpected docker $*" >&2; exit 9 ;;',
  'esac',
].join('\n');

function install(args: string[], options: { docker?: string; extraStubs?: Record<string, string>; releaseDir?: string } = {}) {
  const work = tempDir('helprr-install-');
  const bin = stubs({ docker: options.docker ?? goodDocker, ...(options.extraStubs ?? {}) });
  const base = `file://${options.releaseDir ?? release()}`;
  const result = spawnSync('/bin/sh', [path.join(repoRoot, 'scripts/install.sh'), '--yes', '--asset-base', base, ...args], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  return { ...result, work };
}

describe('install.sh', () => {
  it('sets Helprr up in a folder of its own, without starting it', () => {
    const { status, stdout, stderr, work } = install(['--dir', 'helprr', '--port', '3061', '--tz', 'Europe/Berlin', '--no-start']);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    const dir = path.join(work, 'helprr');
    for (const file of ['docker-compose.yml', '.env.example', 'scripts/setup-env.sh', 'scripts/backup.sh', 'scripts/update.sh']) {
      expect(existsSync(path.join(dir, file)), file).toBe(true);
    }
    expect(lstatSync(path.join(dir, 'scripts/update.sh')).mode & 0o777).toBe(0o700);
    const env = readFileSync(path.join(dir, '.env'), 'utf8');
    expect(lstatSync(path.join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(env).toMatch(/^TZ=Europe\/Berlin$/m);
    expect(env).toMatch(/^HELPRR_PORT=3061$/m);
    expect(existsSync(path.join(dir, 'twitch-library'))).toBe(true);
    expect(stdout).toContain('Timezone: Europe/Berlin, as you chose.');
    expect(stdout).toContain(`cd "${dir}" && docker compose up -d`);
    expect(stdout).toContain(':3061 and sign in as "admin"');
    const password = /^APP_PASSWORD=(.+)$/m.exec(env)?.[1];
    expect(password).toMatch(/^[0-9a-f]{64}$/);
    expect(stdout).not.toContain(password);
  });

  it('pins an exact release when asked', () => {
    const { status, work } = install(['--version', 'v1.12.1', '--no-start']);
    expect(status).toBe(0);
    expect(readFileSync(path.join(work, 'helprr/.env'), 'utf8')).toMatch(/^HELPRR_VERSION=1\.12\.1$/m);
  });

  it('installs nothing when a file does not match the release checksum', () => {
    const { status, stderr, work } = install(['--no-start'], { releaseDir: release('update.sh') });
    expect(status).toBe(1);
    expect(stderr).toContain('update.sh does not match the release checksum; nothing was installed.');
    expect(existsSync(path.join(work, 'helprr'))).toBe(false);
  });

  it('never overwrites an existing install', () => {
    const work = tempDir('helprr-install-');
    mkdirSync(path.join(work, 'helprr'));
    writeFileSync(path.join(work, 'helprr', '.env'), 'OWNER\n');
    const result = spawnSync('/bin/sh', [path.join(repoRoot, 'scripts/install.sh'), '--yes', '--no-start', '--asset-base', `file://${release()}`], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${stubs({ docker: goodDocker })}:${process.env.PATH ?? ''}` },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Helprr is already installed in ./helprr. To update it: cd "./helprr" && ./scripts/update.sh.');
    expect(readFileSync(path.join(work, 'helprr', '.env'), 'utf8')).toBe('OWNER\n');
  });

  it.each([
    ['this user cannot use Docker', 'case "$*" in info) echo "permission denied while trying to connect to the Docker daemon socket" ; exit 1 ;; esac', 'this user cannot use it. Run this with sudo'],
    ['Docker is not running', 'case "$*" in info) echo "Cannot connect to the Docker daemon"; exit 1 ;; esac', 'Docker is installed but not running'],
    ['Compose is missing', 'case "$*" in info) echo ok ;; *) exit 1 ;; esac', 'The Docker Compose plugin was not found'],
    ['Compose is too old', 'case "$*" in info) echo ok ;; "compose version --short") echo 2.17.3 ;; esac', 'Docker Compose 2.17.3 is too old'],
  ])('stops with a plain reason when %s', (_label, docker, message) => {
    const { status, stderr, work } = install(['--no-start'], { docker });
    expect(status).toBe(1);
    expect(stderr).toContain(message);
    expect(existsSync(path.join(work, 'helprr'))).toBe(false);
  });

  it('says Docker is missing when there is no docker at all', () => {
    const work = tempDir('helprr-install-');
    // Only the tools the script needs before the Docker check: sh, curl, and coreutils.
    const bin = tempDir('helprr-install-path-');
    for (const tool of ['curl', 'cat', 'mkdir', 'rm', 'mktemp']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      if (found) writeFileSync(path.join(bin, tool), `#!/bin/sh\nexec ${found} "$@"\n`, { mode: 0o755 });
    }
    const result = spawnSync('/bin/sh', [path.join(repoRoot, 'scripts/install.sh'), '--yes', '--no-start'], {
      cwd: work,
      encoding: 'utf8',
      env: { PATH: bin } as unknown as NodeJS.ProcessEnv,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Docker was not found. Install Docker Engine with the Compose plugin');
  });

  it.each([['abc'], ['0'], ['70000']])('refuses port %s', (port) => {
    const { status, stderr } = install(['--port', port, '--no-start']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/The port must be/);
  });

  it('refuses a timezone that is not a zone name', () => {
    const { status, stderr } = install(['--tz', '../etc', '--no-start']);
    expect(status).toBe(1);
    expect(stderr).toContain('is not a timezone name');
  });

  it('shows its options', () => {
    const result = spawnSync('/bin/sh', [path.join(repoRoot, 'scripts/install.sh'), '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--asset-base URL');
    expect(result.stdout).toContain('--no-start');
  });
});

describe('install.sh, the paths a terminal or a real start would take', () => {
  const run = (args: string[], env: NodeJS.ProcessEnv, cwd: string, prefix: string[] = []) =>
    spawnSync(prefix[0] ?? '/bin/sh', [...prefix.slice(1), ...(prefix.length ? ['/bin/sh'] : []), path.join(repoRoot, 'scripts/install.sh'), ...args], {
      cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
    });
  const pathWith = (bin: string) => ({ ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` });
  const setsid = spawnSync('/bin/sh', ['-c', 'command -v setsid'], { encoding: 'utf8' }).stdout.trim();

  it.skipIf(!setsid)('uses the defaults when there is no terminal and no --yes', () => {
    const work = tempDir('helprr-install-');
    const result = run(['--no-start', '--asset-base', `file://${release()}`], pathWith(stubs({ docker: goodDocker })), work, [setsid, '-w']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(path.join(work, 'helprr', '.env'))).toBe(true);
  });

  const startingDocker = (ready: boolean) => [
    'case "$*" in',
    '  info) echo ok ;;',
    '  "compose version --short") echo 2.29.1 ;;',
    '  "compose pull --quiet"|"compose up -d") echo "$*" >> "$HOME/docker.log" ;;',
    `  "compose exec -T helprr wget -qO /dev/null http://127.0.0.1:3050/api/ready") exit ${ready ? 0 : 1} ;;`,
    '  *) echo "unexpected docker $*" >&2; exit 9 ;;',
    'esac',
  ].join('\n');

  it('starts Helprr, waits until it is ready, and says how to sign in', () => {
    const work = tempDir('helprr-install-');
    const env = { ...pathWith(stubs({ docker: startingDocker(true) })), HOME: work };
    const result = run(['--yes', '--asset-base', `file://${release()}`], env, work);
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(work, 'docker.log'), 'utf8')).toBe('compose pull --quiet\ncompose up -d\n');
    expect(result.stdout).toContain('Helprr is running.');
    expect(result.stdout).toContain(':3050 and sign in as "admin"');
  });

  it('gives up after about three minutes when Helprr never becomes ready', () => {
    const work = tempDir('helprr-install-');
    const env = { ...pathWith(stubs({ docker: startingDocker(false), sleep: 'exit 0' })), HOME: work };
    const result = run(['--yes', '--asset-base', `file://${release()}`], env, work);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('did not become ready within three minutes');
  });

  it('refuses a port that is taken before writing anything, and explains a rerun after a failed start', () => {
    const work = tempDir('helprr-install-');
    const busy = run(['--yes', '--no-start', '--asset-base', `file://${release()}`],
      pathWith(stubs({ docker: goodDocker, ss: 'echo "LISTEN 0 4096 0.0.0.0:3050 0.0.0.0:*"' })), work);
    expect(busy.status).toBe(1);
    expect(busy.stderr).toContain('Port 3050 is already in use. Choose another with --port.');
    expect(existsSync(path.join(work, 'helprr'))).toBe(false);

    mkdirSync(path.join(work, 'helprr'));
    writeFileSync(path.join(work, 'helprr', '.env'), 'X=1\n');
    const rerun = run(['--yes', '--no-start', '--asset-base', `file://${release()}`], pathWith(stubs({ docker: goodDocker })), work);
    expect(rerun.stderr).toContain('If an earlier run stopped before Helprr started, fix .env there and run: cd "./helprr" && docker compose up -d');
  });

  it('downloads with wget when curl is missing', () => {
    const work = tempDir('helprr-install-');
    // Every tool on PATH except curl, and a wget that reads file:// URLs.
    const bin = tempDir('helprr-install-nocurl-');
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (!dir || !existsSync(dir)) continue;
      for (const name of spawnSync('/bin/ls', [dir], { encoding: 'utf8' }).stdout.split('\n')) {
        if (!name || ['curl', 'wget', 'docker', 'ss', 'netstat'].includes(name) || existsSync(path.join(bin, name))) continue;
        try { symlinkSync(path.join(dir, name), path.join(bin, name)); } catch { /* skip */ }
      }
    }
    writeFileSync(path.join(bin, 'wget'), '#!/bin/sh\n# wget -q -O FILE URL\ncp "${4#file://}" "$3"\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\n${goodDocker}\n`, { mode: 0o755 });
    const result = run(['--yes', '--no-start', '--asset-base', `file://${release()}`], { ...process.env, PATH: bin }, work);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(path.join(work, 'helprr', 'docker-compose.yml'))).toBe(true);
  });

  it('reads SHA256SUMS written with the binary marker, and refuses a file it does not list', () => {
    const marked = release();
    const sums = readFileSync(path.join(marked, 'SHA256SUMS'), 'utf8').replace(/ {2}/g, ' *');
    writeFileSync(path.join(marked, 'SHA256SUMS'), sums);
    expect(install(['--no-start'], { releaseDir: marked }).status).toBe(0);

    const missing = release();
    const lines = readFileSync(path.join(missing, 'SHA256SUMS'), 'utf8').split('\n').filter((l) => !l.endsWith('backup.sh'));
    writeFileSync(path.join(missing, 'SHA256SUMS'), lines.join('\n'));
    const result = install(['--no-start'], { releaseDir: missing });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('backup.sh is not listed in the release checksums.');
  });

  it('expands ~ in the folder and handles a folder that starts with a dash', () => {
    const home = tempDir('helprr-install-home-');
    const tilde = run(['--yes', '--no-start', '--dir', '~/helprr-here', '--asset-base', `file://${release()}`],
      { ...pathWith(stubs({ docker: goodDocker })), HOME: home }, home);
    expect(tilde.status).toBe(0);
    expect(existsSync(path.join(home, 'helprr-here', '.env'))).toBe(true);
    expect(existsSync(path.join(home, '~'))).toBe(false);

    const work = tempDir('helprr-install-');
    const dash = run(['--yes', '--no-start', '--dir', '-dashed', '--asset-base', `file://${release()}`], pathWith(stubs({ docker: goodDocker })), work);
    expect(dash.status).toBe(0);
    expect(existsSync(path.join(work, '-dashed', '.env'))).toBe(true);
  });

  it.each([['03050'], ['0']])('refuses port %s', (port) => {
    const { status, stderr } = install(['--port', port, '--no-start']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/leading zero|between 1 and 65535/);
  });

  it('refuses a version that is not a version', () => {
    const { status, stderr } = install(['--version', '1.0;rm -rf /', '--no-start']);
    expect(status).toBe(1);
    expect(stderr).toContain('is not a Helprr version');
  });
});
