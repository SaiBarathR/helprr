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
  realpathSync,
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
realpath . >> "$DOCKER_LOG.cwd"
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
    // Plain `docker compose` in the Helprr directory, as update.sh and the README use.
    expect(commands).not.toContain('--env-file');
    expect(commands).not.toContain(' -f ');
    expect(new Set(readFileSync(`${dockerLog}.cwd`, 'utf8').trim().split('\n'))).toEqual(new Set([realpathSync(root)]));
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

  describe('--keep', () => {
    const stamp = (day: number) => `202607${String(day).padStart(2, '0')}-000000`;
    const seed = (directory: string, prefix: string, days: number[]) => {
      mkdirSync(directory, { recursive: true });
      for (const day of days) writeFileSync(path.join(directory, `${prefix}-${stamp(day)}.dump`), `OLD-${day}`);
    };

    it('keeps the newest 10 of its own backups by default and leaves other files alone', () => {
      const { root, fakeBin } = createFixture();
      const directory = path.join(root, 'backups/stable');
      seed(directory, 'helprr-pre-upgrade', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      seed(directory, 'helprr-dev-pre-upgrade', [1]);
      writeFileSync(path.join(directory, 'helprr-pre-upgrade-manual.dump'), 'MANUAL');
      writeFileSync(path.join(directory, 'notes.txt'), 'NOTES');
      const outside = path.join(root, 'outside.dump');
      writeFileSync(outside, 'OUTSIDE');
      symlinkSync(outside, path.join(directory, `helprr-pre-upgrade-${stamp(0)}.dump`));

      const result = runBackup(root, fakeBin);

      expect(result.status).toBe(0);
      const remaining = backupFiles(directory).filter((name) => /^helprr-pre-upgrade-\d{8}-\d{6}\.dump$/.test(name)).sort();
      expect(remaining).toEqual([
        ...[3, 4, 5, 6, 7, 8, 9, 10, 11].map((day) => `helprr-pre-upgrade-${stamp(day)}.dump`),
        'helprr-pre-upgrade-20260714-120000.dump',
      ].concat(`helprr-pre-upgrade-${stamp(0)}.dump`).sort());
      expect(result.stdout).toContain(`Removed older backup: ${path.join(directory, `helprr-pre-upgrade-${stamp(1)}.dump`)}`);
      expect(result.stdout).toContain(`Removed older backup: ${path.join(directory, `helprr-pre-upgrade-${stamp(2)}.dump`)}`);
      expect(result.stdout).toContain('Kept the newest 10 backups in this directory.');
      expect(readFileSync(path.join(directory, `helprr-dev-pre-upgrade-${stamp(1)}.dump`), 'utf8')).toBe('OLD-1');
      expect(readFileSync(path.join(directory, 'helprr-pre-upgrade-manual.dump'), 'utf8')).toBe('MANUAL');
      expect(readFileSync(path.join(directory, 'notes.txt'), 'utf8')).toBe('NOTES');
      expect(readFileSync(outside, 'utf8')).toBe('OUTSIDE');
    });

    it('keeps every backup with --keep 0', () => {
      const { root, fakeBin } = createFixture();
      const directory = path.join(root, 'backups/stable');
      seed(directory, 'helprr-pre-upgrade', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

      const result = runBackup(root, fakeBin, ['--keep', '0']);

      expect(result.status).toBe(0);
      expect(backupFiles(directory)).toHaveLength(13);
      expect(result.stdout).not.toContain('Removed older backup');
    });

    it('removes only dumps older than the one it just wrote', () => {
      // A newer dump is what a second backup running at the same time leaves;
      // deleting it there could leave no backup at all.
      const { root, fakeBin } = createFixture();
      const directory = path.join(root, 'backups/stable');
      seed(directory, 'helprr-pre-upgrade', [1]);
      writeFileSync(path.join(directory, 'helprr-pre-upgrade-20990101-000000.dump'), 'NEWER');

      const result = runBackup(root, fakeBin, ['--keep', '1']);

      expect(result.status).toBe(0);
      expect(backupFiles(directory).sort()).toEqual([
        'helprr-pre-upgrade-20260714-120000.dump',
        'helprr-pre-upgrade-20990101-000000.dump',
      ]);
    });

    it('never removes a newer dump even when its own was already deleted by another run', () => {
      // Run B pruned run A's dump before A pruned; A must still not touch B's.
      // The fake ln publishes nothing, standing in for A's file being gone.
      const { root, fakeBin } = createFixture();
      writeFileSync(path.join(fakeBin, 'ln'), '#!/bin/sh\nexit 0\n');
      chmodSync(path.join(fakeBin, 'ln'), 0o755);
      const directory = path.join(root, 'backups/stable');
      mkdirSync(directory, { recursive: true });
      for (const name of ['helprr-pre-upgrade-20990101-000000.dump', 'helprr-pre-upgrade-20990102-000000.dump']) {
        writeFileSync(path.join(directory, name), 'NEWER');
      }

      const result = runBackup(root, fakeBin, ['--keep', '1']);

      expect(result.status).toBe(0);
      expect(backupFiles(directory).sort()).toEqual([
        'helprr-pre-upgrade-20990101-000000.dump',
        'helprr-pre-upgrade-20990102-000000.dump',
      ]);
    });

    it('counts a dump removed by another run between listing and pruning as already gone', () => {
      // The fake rm deletes the next-oldest dump as a second run would, while
      // this run removes the oldest; the retention count must still hold.
      const { root, fakeBin } = createFixture();
      const directory = path.join(root, 'backups/stable');
      seed(directory, 'helprr-pre-upgrade', [1, 2, 3]);
      writeFileSync(path.join(fakeBin, 'rm'), `#!/bin/sh
for a in "$@"; do case "$a" in *-${'20260701'}-000000.dump) /bin/rm -f "$a" "\${a%01-000000.dump}02-000000.dump" ;; -*) ;; *) /bin/rm -f "$a" ;; esac; done
`);
      chmodSync(path.join(fakeBin, 'rm'), 0o755);

      const result = runBackup(root, fakeBin, ['--keep', '2']);

      expect(result.status).toBe(0);
      expect(backupFiles(directory).sort()).toEqual([
        'helprr-pre-upgrade-20260703-000000.dump',
        'helprr-pre-upgrade-20260714-120000.dump',
      ]);
    });

    it('prunes only development backups in dev mode', () => {
      const { root, fakeBin } = createFixture();
      const directory = path.join(root, 'shared');
      seed(directory, 'helprr-pre-upgrade', [1, 2, 3]);
      seed(directory, 'helprr-dev-pre-upgrade', [1, 2, 3]);

      const result = runBackup(root, fakeBin, ['--dev', '--output-dir', directory, '--keep', '2']);

      expect(result.status).toBe(0);
      expect(backupFiles(directory).sort()).toEqual([
        `helprr-dev-pre-upgrade-${stamp(3)}.dump`,
        'helprr-dev-pre-upgrade-20260714-120000.dump',
        ...[1, 2, 3].map((day) => `helprr-pre-upgrade-${stamp(day)}.dump`),
      ].sort());
    });

    it('removes nothing when the new backup fails', () => {
      const { root, fakeBin } = createFixture();
      const directory = path.join(root, 'backups/stable');
      const days = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      seed(directory, 'helprr-pre-upgrade', days);

      for (const failure of [{ FAKE_DUMP_FAILURE: '1' }, { FAKE_VERIFY_FAILURE: '1' }]) {
        const result = runBackup(root, fakeBin, ['--keep', '1'], failure);
        expect(result.status).toBe(1);
        expect(backupFiles(directory)).toHaveLength(days.length);
      }
    });

    it('rejects a value that is not a whole number before invoking Docker', () => {
      for (const value of ['', 'ten', '-1', '01', '1.5']) {
        const { root, fakeBin, dockerLog } = createFixture();
        const result = runBackup(root, fakeBin, ['--keep', value]);
        expect(result.status, value).toBe(1);
        expect(result.stderr).toContain('--keep must be a whole number');
        expect(existsSync(dockerLog)).toBe(false);
      }
      const { root, fakeBin } = createFixture();
      expect(runBackup(root, fakeBin, ['--keep']).stderr).toContain('--keep requires a number.');
    });
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
