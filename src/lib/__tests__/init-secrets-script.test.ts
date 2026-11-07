import { spawnSync } from 'child_process';
import { spawn } from 'child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

// docker/init-secrets.sh against a temporary folder standing in for the
// helprr-secrets volume. Not root here, so ownership is left alone; the modes and
// what is written, kept or removed are what is checked.

const repoRoot = process.cwd();
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function volume(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'helprr-secrets-'));
  temporary.push(dir);
  return dir;
}

// Postgres's and Redis's own volumes, beside the secrets volume.
function serviceVolumes(dir: string) {
  const db = `${dir}-db`;
  const redis = `${dir}-redis`;
  if (existsSync(dir)) {
    for (const folder of [db, redis]) if (!existsSync(folder)) { mkdirSync(folder); temporary.push(folder); }
  }
  return { HELPRR_DB_AUTH_DIR: db, HELPRR_REDIS_AUTH_DIR: redis };
}

function init(dir: string, env: Record<string, string> = {}) {
  return spawnSync('/bin/sh', [path.join(repoRoot, 'docker/init-secrets.sh')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HELPRR_SECRETS_DIR: dir, HELPRR_APP_DIR: repoRoot, ...serviceVolumes(dir), ...env } as unknown as NodeJS.ProcessEnv,
  });
}

const read = (dir: string, name: string) => readFileSync(path.join(dir, name), 'utf8');
const mode = (file: string) => lstatSync(file).mode & 0o777;

describe('init-secrets.sh', () => {
  it('makes the session secret and push keys once, with a private copy for each reader', () => {
    const dir = volume();
    const result = init(dir);
    expect(result.status).toBe(0);
    expect(read(dir, 'jwt_secret')).toMatch(/^[0-9a-f]{96}$/);
    expect(read(dir, 'vapid_keys')).toMatch(/^[A-Za-z0-9_-]{80,} [A-Za-z0-9_-]{40,}$/);
    expect(read(path.join(dir, 'app'), 'vapid_public')).toBe(read(dir, 'vapid_keys').split(' ')[0]);
    expect(read(dir, 'jwt_secret.created_at')).toMatch(/^\d{10}$/);
    expect(read(path.join(dir, 'app'), 'jwt_secret')).toBe(read(dir, 'jwt_secret'));
    expect(read(path.join(dir, 'worker'), 'jwt_secret')).toBe(read(dir, 'jwt_secret'));
    expect(read(path.join(dir, 'app'), 'vapid_private')).toBe(read(dir, 'vapid_keys').split(' ')[1]);
    expect(existsSync(path.join(dir, 'worker', 'vapid_private'))).toBe(false);
    expect(mode(dir)).toBe(0o711);
    for (const reader of ['app', 'worker']) expect(mode(path.join(dir, reader))).toBe(0o750);
    for (const file of ['jwt_secret', 'vapid_keys']) expect(mode(path.join(dir, file)), file).toBe(0o600);
    for (const file of ['app/jwt_secret', 'worker/jwt_secret', 'app/vapid_private']) expect(mode(path.join(dir, file)), file).toBe(0o640);
    expect(readdirSync(dir).filter((name) => name.startsWith('.staging'))).toEqual([]);
    for (const secret of [read(dir, 'jwt_secret'), read(dir, 'vapid_keys').split(' ')[1]]) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  });

  it('never regenerates what exists, and refreshes the copies', () => {
    const dir = volume();
    init(dir);
    const before = { jwt: read(dir, 'jwt_secret'), vapid: read(dir, 'vapid_keys'), at: read(dir, 'jwt_secret.created_at') };
    writeFileSync(path.join(dir, 'app', 'jwt_secret'), 'stale');
    const second = init(dir);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('created');
    expect(read(dir, 'jwt_secret')).toBe(before.jwt);
    expect(read(dir, 'vapid_keys')).toBe(before.vapid);
    expect(read(dir, 'jwt_secret.created_at')).toBe(before.at);
    expect(read(path.join(dir, 'app'), 'jwt_secret')).toBe(before.jwt);
  });

  it('leaves everything to .env when it sets the values, and removes stale copies', () => {
    const dir = volume();
    init(dir);
    const result = init(dir, { JWT_SECRET: 'x'.repeat(40), VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' });
    expect(result.status).toBe(0);
    for (const file of ['app/jwt_secret', 'worker/jwt_secret', 'app/jwt_secret.created_at', 'app/vapid_public', 'app/vapid_private']) {
      expect(existsSync(path.join(dir, file)), file).toBe(false);
    }
  });

  it('makes the database and Redis passwords once, each service seeing only its own', () => {
    const dir = volume();
    const result = init(dir);
    expect(result.status).toBe(0);
    const { HELPRR_DB_AUTH_DIR: db, HELPRR_REDIS_AUTH_DIR: redis } = serviceVolumes(dir);
    const postgres = read(dir, 'postgres_password');
    const redisPassword = read(dir, 'redis_password');
    expect(postgres).toMatch(/^[0-9a-f]{64}$/);
    expect(redisPassword).toMatch(/^[0-9a-f]{64}$/);
    expect(read(db, 'postgres_password')).toBe(postgres);
    expect(read(redis, 'redis_password')).toBe(redisPassword);
    expect(readdirSync(db)).toEqual(['postgres_password']);
    expect(readdirSync(redis)).toEqual(['redis_password']);
    for (const folder of [db, redis]) expect(mode(folder)).toBe(0o700);
    for (const file of [path.join(db, 'postgres_password'), path.join(redis, 'redis_password'), path.join(dir, 'postgres_password'), path.join(dir, 'redis_password')]) {
      expect(mode(file), file).toBe(0o600);
    }
    expect(read(path.join(dir, 'app'), 'postgres_password')).toBe(postgres);
    expect(read(path.join(dir, 'app'), 'redis_password')).toBe(redisPassword);
    expect(read(path.join(dir, 'worker'), 'postgres_password')).toBe(postgres);
    expect(existsSync(path.join(dir, 'worker', 'redis_password'))).toBe(false);
    for (const file of ['app/postgres_password', 'app/redis_password', 'worker/postgres_password']) expect(mode(path.join(dir, file)), file).toBe(0o640);
    expect(result.stdout + result.stderr).not.toContain(postgres);
    expect(result.stdout + result.stderr).not.toContain(redisPassword);

    writeFileSync(path.join(db, 'postgres_password'), 'stale');
    const second = init(dir);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('created');
    expect(read(dir, 'postgres_password')).toBe(postgres);
    expect(read(db, 'postgres_password')).toBe(postgres);
  });

  it('uses the passwords in .env as they are, and removes stale copies', () => {
    const dir = volume();
    init(dir);
    const { HELPRR_DB_AUTH_DIR: db, HELPRR_REDIS_AUTH_DIR: redis } = serviceVolumes(dir);
    expect(init(dir, { POSTGRES_PASSWORD: 'p'.repeat(32), REDIS_PASSWORD: 'r'.repeat(32) }).status).toBe(0);
    for (const file of [path.join(dir, 'app/postgres_password'), path.join(dir, 'worker/postgres_password'), path.join(dir, 'app/redis_password'), path.join(db, 'postgres_password'), path.join(redis, 'redis_password')]) {
      expect(existsSync(file), file).toBe(false);
    }
  });

  // The Compose file before this one passes no passwords and mounts no service volumes;
  // its .env provides them, so nothing may be made (and a failure would stop updates).
  it("makes no database or Redis password without their volumes (an older Compose file)", () => {
    const dir = volume();
    const result = init(dir, { HELPRR_DB_AUTH_DIR: '/nonexistent/db', HELPRR_REDIS_AUTH_DIR: '/nonexistent/redis' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('database password');
    for (const file of ['postgres_password', 'redis_password', 'app/postgres_password', 'app/redis_password', 'worker/postgres_password']) {
      expect(existsSync(path.join(dir, file)), file).toBe(false);
    }
    expect(read(dir, 'jwt_secret')).toMatch(/^[0-9a-f]{96}$/);
  });

  it('never pairs a key from .env with a generated one', () => {
    const dir = volume();
    expect(init(dir, { VAPID_PUBLIC_KEY: 'only-the-public-key' }).status).toBe(0);
    expect(existsSync(path.join(dir, 'vapid_keys'))).toBe(false);
    expect(existsSync(path.join(dir, 'app', 'vapid_public'))).toBe(false);
  });

  it('refuses to run without the volume', () => {
    const result = init('/nonexistent/helprr-secrets');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not mounted');
  });

  it('keeps a folder it did not make readable only to its reader', () => {
    const dir = volume();
    mkdirSync(path.join(dir, 'app'), { mode: 0o755 });
    init(dir);
    expect(mode(path.join(dir, 'app'))).toBe(0o750);
  });

  // A reader with code execution could plant links in its folder under the first
  // layout, and init (root) followed them: the public push key landed on the master.
  it('replaces a planted link instead of writing through it', () => {
    const dir = volume();
    init(dir);
    const master = read(dir, 'jwt_secret');
    rmSync(path.join(dir, 'app', 'vapid_public'));
    symlinkSync(path.join(dir, 'jwt_secret'), path.join(dir, 'app', 'vapid_public'));
    symlinkSync(path.join(dir, 'jwt_secret'), path.join(dir, 'app', '.vapid_public.new'));
    expect(init(dir).status).toBe(0);
    expect(read(dir, 'jwt_secret')).toBe(master);
    expect(lstatSync(path.join(dir, 'app', 'vapid_public')).isSymbolicLink()).toBe(false);
    expect(read(path.join(dir, 'app'), 'vapid_public')).toBe(read(dir, 'vapid_keys').split(' ')[0]);
  });

  it('replaces a reader folder that is a link, without writing into its target', () => {
    const dir = volume();
    const elsewhere = volume();
    symlinkSync(elsewhere, path.join(dir, 'app'));
    expect(init(dir).status).toBe(0);
    expect(lstatSync(path.join(dir, 'app')).isSymbolicLink()).toBe(false);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('lets only one of several runs at once make the secret, and every copy agrees', async () => {
    const dir = volume();
    const runs = await Promise.all(Array.from({ length: 5 }, () => new Promise<number>((resolve) => {
      const child = spawn('/bin/sh', [path.join(repoRoot, 'docker/init-secrets.sh')], {
        env: { PATH: process.env.PATH ?? '', HELPRR_SECRETS_DIR: dir, HELPRR_APP_DIR: repoRoot, ...serviceVolumes(dir) } as unknown as NodeJS.ProcessEnv,
        stdio: 'ignore',
      });
      child.on('exit', (code) => resolve(code ?? 1));
    })));
    expect(runs).toEqual([0, 0, 0, 0, 0]);
    const master = read(dir, 'jwt_secret');
    expect(read(path.join(dir, 'app'), 'jwt_secret')).toBe(master);
    expect(read(path.join(dir, 'worker'), 'jwt_secret')).toBe(master);
    expect(read(path.join(dir, 'app'), 'vapid_public')).toBe(read(dir, 'vapid_keys').split(' ')[0]);
  });

  it('fails loudly, writing nothing, when it cannot generate a secret', () => {
    const dir = volume();
    const bin = volume();
    for (const tool of ['sh', 'mkdir', 'mktemp', 'chmod', 'rm', 'id', 'cat', 'mv', 'ln', 'date', 'stat']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      if (found) symlinkSync(found, path.join(bin, tool));
    }
    const result = spawnSync('/bin/sh', [path.join(repoRoot, 'docker/init-secrets.sh')], {
      encoding: 'utf8',
      env: { PATH: bin, HELPRR_SECRETS_DIR: dir } as unknown as NodeJS.ProcessEnv,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('could not generate a secret');
    expect(existsSync(path.join(dir, 'jwt_secret'))).toBe(false);
  });

  it('refuses a worker user given as a name', () => {
    const result = init(volume(), { TWITCH_PUID: 'abc' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be numbers');
  });

  it('replaces a folder or a link to a folder where a copy belongs, never writing into it', () => {
    const dir = volume();
    const elsewhere = volume();
    init(dir);
    rmSync(path.join(dir, 'app', 'jwt_secret'));
    mkdirSync(path.join(dir, 'app', 'jwt_secret'));
    rmSync(path.join(dir, 'app', 'vapid_public'));
    symlinkSync(elsewhere, path.join(dir, 'app', 'vapid_public'));
    expect(init(dir).status).toBe(0);
    expect(read(path.join(dir, 'app'), 'jwt_secret')).toBe(read(dir, 'jwt_secret'));
    expect(lstatSync(path.join(dir, 'app', 'vapid_public')).isFile()).toBe(true);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('puts the masters back to 0600 after a restore that lost their modes', () => {
    const dir = volume();
    init(dir);
    chmodSync(path.join(dir, 'vapid_keys'), 0o644);
    chmodSync(path.join(dir, 'jwt_secret'), 0o644);
    chmodSync(path.join(dir, 'postgres_password'), 0o644);
    init(dir);
    expect(mode(path.join(dir, 'vapid_keys'))).toBe(0o600);
    expect(mode(path.join(dir, 'jwt_secret'))).toBe(0o600);
    expect(mode(path.join(dir, 'postgres_password'))).toBe(0o600);
  });

  it("refuses a worker group that is the app's group", () => {
    const result = init(volume(), { HELPRR_APP_GID: '1000', TWITCH_PGID: '1000' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must differ from the app's group");
  });

  it('clears staging left by a run that was killed', () => {
    const dir = volume();
    const stale = path.join(dir, '.staging.killed');
    mkdirSync(stale);
    writeFileSync(path.join(stale, 'app-jwt_secret.x'), 'leftover');
    const old = new Date(Date.now() - 3600_000);
    utimesSync(stale, old, old);
    expect(init(dir).status).toBe(0);
    expect(existsSync(stale)).toBe(false);
  });

  it('never fails over the backup folder, mounted or not, and leaves it alone when not root', () => {
    const dir = volume();
    const backups = mkdtempSync(path.join(tmpdir(), 'helprr-backups-'));
    temporary.push(backups);
    chmodSync(backups, 0o755);
    for (const folder of [backups, path.join(backups, 'missing')]) {
      const result = init(dir, { HELPRR_BACKUP_DIR: folder });
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('backup folder');
    }
    expect(mode(backups)).toBe(0o755);
  });
});
