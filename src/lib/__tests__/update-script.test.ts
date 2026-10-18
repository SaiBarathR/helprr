import { spawnSync } from 'child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const fixtureRoots: string[] = [];

function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'helprr-update-'));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, 'scripts'));
  for (const script of ['backup.sh', 'update.sh']) {
    copyFileSync(path.join(repoRoot, 'scripts', script), path.join(root, 'scripts', script));
    chmodSync(path.join(root, 'scripts', script), 0o755);
  }
  writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(path.join(root, '.env'), 'HELPRR_VERSION=1.6.3\n');

  const fakeBin = path.join(root, 'fake-bin');
  mkdirSync(fakeBin);
  // Health answers come from FAKE_HEALTH, one word per poll ("status" or
  // "restarts:status"); the last repeats.
  writeFileSync(
    path.join(fakeBin, 'docker'),
    `#!/bin/sh
{ printf '%s' "$*" | tr '\\n' ' '; printf '\\n'; } >> "$DOCKER_LOG"
case " $* " in
  *" pg_dump "*)
    [ "\${FAKE_DUMP_FAILURE:-}" != 1 ] || exit 41
    printf 'PGDMP'
    ;;
  *" pg_restore --list "*) cat >/dev/null ;;
  *" pull helprr "*)
    realpath . > "$DOCKER_LOG.cwd"
    [ "\${FAKE_PULL_FAILURE:-}" != 1 ] || exit 44
    ;;
  *" up -d --no-build --no-deps helprr "*) ;;
  *" ps -q helprr "*) printf 'cid123\\n' ;;
  " inspect -f {{.RestartCount}} cid123 ") printf '0\\n' ;;
  " inspect -f "*)
    polls=$(cat "$POLLS" 2>/dev/null || echo 0)
    polls=$((polls + 1))
    printf '%s' "$polls" > "$POLLS"
    printf '%s\\n' "\${FAKE_HEALTH:-healthy}" | awk -v n="$polls" '{ t = (n <= NF ? $n : $NF); if (t !~ /:/) t = "0:" t; sub(":", " ", t); print t }'
    ;;
  *" exec -T helprr wget -qO- http://127.0.0.1:3050/api/ready "*)
    [ "\${FAKE_READY_FAILURE:-}" != 1 ] || exit 8
    printf '{"status":"ready"}'
    ;;
  *) exit 43 ;;
esac
`,
  );
  writeFileSync(path.join(fakeBin, 'date'), '#!/bin/sh\nprintf "%s\\n" 20260714-120000\n');
  writeFileSync(path.join(fakeBin, 'sleep'), '#!/bin/sh\nprintf "sleep %s\\n" "$1" >> "$DOCKER_LOG"\n');
  for (const name of ['docker', 'date', 'sleep']) chmodSync(path.join(fakeBin, name), 0o755);
  return root;
}

function runUpdate(root: string, args: string[] = [], extraEnv: Partial<NodeJS.ProcessEnv> = {}) {
  const result = spawnSync('/bin/sh', [path.join(root, 'scripts/update.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${path.join(root, 'fake-bin')}:${process.env.PATH ?? ''}`,
      DOCKER_LOG: path.join(root, 'docker.log'),
      POLLS: path.join(root, 'polls'),
    },
  });
  const log = existsSync(path.join(root, 'docker.log')) ? readFileSync(path.join(root, 'docker.log'), 'utf8') : '';
  return { ...result, log };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('update.sh', () => {
  it('backs up, then pulls and restarts only the app container and waits until ready', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_HEALTH: 'starting starting healthy' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Created and validated PostgreSQL backup: ${path.join(root, 'backups/stable/helprr-pre-upgrade-20260714-120000.dump')}`);
    expect(result.stdout).toContain('Helprr is healthy and ready: {"status":"ready"}');
    const steps = result.log.split('\n').filter(Boolean).map((line) => {
      if (line.includes('pg_dump')) return 'dump';
      if (line.includes('pg_restore --list')) return 'validate';
      if (line.includes(' pull helprr')) return 'pull';
      if (line.includes(' up -d --no-build --no-deps helprr')) return 'up';
      if (line.includes(' ps -q helprr')) return 'ps';
      if (line.startsWith('inspect ')) return 'inspect';
      if (line.startsWith('sleep ')) return 'sleep';
      if (line.includes('/api/ready')) return 'ready';
      return line;
    });
    expect(steps).toEqual(['dump', 'validate', 'pull', 'up', 'ps', 'inspect', 'inspect', 'sleep', 'inspect', 'sleep', 'inspect', 'ready']);
    // Plain `docker compose` in the install directory, so overrides apply as they do by hand.
    expect(result.log).toMatch(/^compose pull helprr$/m);
    expect(result.log).toMatch(/^compose up -d --no-build --no-deps helprr$/m);
    expect(readFileSync(path.join(root, 'docker.log.cwd'), 'utf8').trim()).toBe(realpathSync(root));
  });

  it('pulls and restarts nothing when the backup fails', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_DUMP_FAILURE: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('The backup failed; nothing was pulled or restarted.');
    expect(result.log).not.toContain('pull helprr');
    expect(result.log).not.toContain('up -d');
  });

  it('leaves the running container alone when the pull fails', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_PULL_FAILURE: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Pulling the Helprr image failed');
    expect(result.log).not.toContain('up -d');
  });

  it('keeps waiting through "unhealthy", which a long migration can show', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_HEALTH: 'starting unhealthy unhealthy healthy' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Helprr is healthy and ready');
  });

  it('names the last health when it gives up', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_HEALTH: 'starting unhealthy' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('did not become healthy within 5 minutes (last health: unhealthy)');
    expect(result.log).not.toContain('/api/ready');
  });

  it('fails as soon as the new container restarts', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_HEALTH: 'starting 1:starting' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Helprr restarted after the update.');
    expect(result.log.match(/^sleep 5$/gm)).toHaveLength(1);
  });

  it('gives up after five minutes without a healthy container', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_HEALTH: 'starting' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('did not become healthy within 5 minutes');
    expect(result.log.match(/^sleep 5$/gm)).toHaveLength(60);
  });

  it('fails when the healthy container does not report ready', () => {
    const root = createFixture();
    const result = runUpdate(root, [], { FAKE_READY_FAILURE: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/api/ready did not report ready');
  });

  it('passes --keep to the backup and stops on an invalid value', () => {
    const root = createFixture();
    const directory = path.join(root, 'backups/stable');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'helprr-pre-upgrade-20260701-000000.dump'), 'OLD');

    expect(runUpdate(root, ['--keep', '1']).status).toBe(0);
    expect(readdirSync(directory)).toEqual(['helprr-pre-upgrade-20260714-120000.dump']);

    const invalid = createFixture();
    const result = runUpdate(invalid, ['--keep', 'all']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--keep must be a whole number');
    expect(result.log).toBe('');
  });
});
