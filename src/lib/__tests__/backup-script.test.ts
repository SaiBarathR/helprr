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

const repoRoot = process.cwd();
const fixtureRoots: string[] = [];
const fakeDump = 'PGDMP-test-archive-with-sensitive-data';

function createFixture(): { root: string; fakeBin: string; dockerLog: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'helprr-backup-'));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(path.join(repoRoot, 'scripts/backup.sh'), path.join(root, 'scripts/backup.sh'));
  chmodSync(path.join(root, 'scripts/backup.sh'), 0o755);
  writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(path.join(root, 'docker-compose.dev.yml'), 'services: {}\n');
  writeFileSync(path.join(root, '.env'), 'POSTGRES_PASSWORD=stable-secret\n');
  writeFileSync(path.join(root, '.env.dev'), 'HELPRR_DEV_POSTGRES_PASSWORD=dev-secret\n');

  const fakeBin = path.join(root, 'fake-bin');
  const dockerLog = path.join(root, 'docker.log');
  mkdirSync(fakeBin);
  const fakeDocker = path.join(fakeBin, 'docker');
  writeFileSync(
    fakeDocker,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case " $* " in
  *" pg_dump "*)
    [ "\${FAKE_DUMP_FAILURE:-}" != 1 ] || exit 41
    printf '%s' '${fakeDump}'
    ;;
  *" pg_restore --list "*)
    cat >/dev/null
    [ "\${FAKE_VERIFY_FAILURE:-}" != 1 ] || exit 42
    ;;
  *)
    exit 43
    ;;
esac
`,
  );
  chmodSync(fakeDocker, 0o755);
  const fakeDate = path.join(fakeBin, 'date');
  writeFileSync(fakeDate, '#!/bin/sh\nprintf "%s\\n" 20260714-120000\n');
  chmodSync(fakeDate, 0o755);
  return { root, fakeBin, dockerLog };
}

function runBackup(
  root: string,
  fakeBin: string,
  args: string[] = [],
  extraEnv: Partial<NodeJS.ProcessEnv> = {},
) {
  return spawnSync('/bin/sh', [path.join(root, 'scripts/backup.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      DOCKER_LOG: path.join(root, 'docker.log'),
    },
  });
}

function backupFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.dump'));
}

function expectNoTemporaryFiles(directory: string): void {
  if (!existsSync(directory)) return;
  expect(readdirSync(directory).filter((name) => name.startsWith('.helprr-backup.'))).toEqual([]);
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('backup.sh', () => {
  it('creates and verifies a private stable backup without exposing env secrets', () => {
    const { root, fakeBin, dockerLog } = createFixture();
    const result = runBackup(root, fakeBin);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const directory = path.join(root, 'backups/stable');
    const files = backupFiles(directory);
    expect(files).toHaveLength(1);
    const backup = path.join(directory, files[0]);
    expect(readFileSync(backup, 'utf8')).toBe(fakeDump);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    expect(lstatSync(backup).mode & 0o777).toBe(0o600);
    expect(result.stdout).not.toContain('stable-secret');
    expect(result.stderr).not.toContain('stable-secret');

    const commands = readFileSync(dockerLog, 'utf8');
    expect(commands).toContain('--env-file');
    expect(commands).toContain('.env -f');
    expect(commands).toContain('exec -T helprr-db');
    expect(commands).toContain('pg_dump');
    expect(commands).toContain('pg_restore --list');
    expect(commands).not.toContain('stable-secret');
    expectNoTemporaryFiles(directory);
  });

  it('targets only the isolated development Compose file and database service in dev mode', () => {
    const { root, fakeBin, dockerLog } = createFixture();
    const result = runBackup(root, fakeBin, ['--dev']);

    expect(result.status).toBe(0);
    const directory = path.join(root, 'backups/development');
    expect(backupFiles(directory)).toHaveLength(1);
    const commands = readFileSync(dockerLog, 'utf8');
    expect(commands).toContain('.env.dev -f');
    expect(commands).toContain('docker-compose.dev.yml');
    expect(commands).toContain('exec -T helprr-dev-db');
    expect(commands).not.toContain('docker-compose.yml ');
    expect(commands).not.toContain(' helprr-db ');
    expect(commands).not.toContain('dev-secret');
    expectNoTemporaryFiles(directory);
  });

  it('supports a caller-selected private output directory', () => {
    const { root, fakeBin } = createFixture();
    const directory = path.join(root, 'off-host-mount');
    const result = runBackup(root, fakeBin, ['--output-dir', directory]);

    expect(result.status).toBe(0);
    expect(backupFiles(directory)).toHaveLength(1);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
    expectNoTemporaryFiles(directory);
  });

  it('publishes no dump or temporary file when pg_dump fails', () => {
    const { root, fakeBin } = createFixture();
    const result = runBackup(root, fakeBin, [], { FAKE_DUMP_FAILURE: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PostgreSQL backup failed');
    const directory = path.join(root, 'backups/stable');
    expect(backupFiles(directory)).toEqual([]);
    expectNoTemporaryFiles(directory);
  });

  it('publishes no dump or temporary file when archive validation fails', () => {
    const { root, fakeBin } = createFixture();
    const result = runBackup(root, fakeBin, [], { FAKE_VERIFY_FAILURE: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not validate the backup archive');
    const directory = path.join(root, 'backups/stable');
    expect(backupFiles(directory)).toEqual([]);
    expectNoTemporaryFiles(directory);
  });

  it('refuses a symbolic-link output directory', () => {
    const { root, fakeBin } = createFixture();
    const destination = path.join(root, 'outside');
    mkdirSync(destination);
    const linkedDirectory = path.join(root, 'linked-backups');
    symlinkSync(destination, linkedDirectory);

    const result = runBackup(root, fakeBin, ['--output-dir', linkedDirectory]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not be a symbolic link');
    expect(backupFiles(destination)).toEqual([]);
  });

  it('never overwrites an existing timestamped backup', () => {
    const { root, fakeBin, dockerLog } = createFixture();
    const directory = path.join(root, 'backups/stable');
    mkdirSync(directory, { recursive: true });
    const existing = path.join(directory, 'helprr-pre-upgrade-20260714-120000.dump');
    writeFileSync(existing, 'OWNER_BACKUP', { mode: 0o640 });

    const result = runBackup(root, fakeBin);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Backup already exists');
    expect(readFileSync(existing, 'utf8')).toBe('OWNER_BACKUP');
    expect(existsSync(dockerLog)).toBe(false);
    expectNoTemporaryFiles(directory);
  });

  it('requires the selected environment file before invoking Docker', () => {
    const { root, fakeBin, dockerLog } = createFixture();
    rmSync(path.join(root, '.env.dev'));

    const result = runBackup(root, fakeBin, ['--dev']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing environment file: .env.dev');
    expect(existsSync(dockerLog)).toBe(false);
  });
});
