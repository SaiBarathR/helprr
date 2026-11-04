import { spawnSync } from 'child_process';
import { spawn } from 'child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
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

function init(dir: string, env: Record<string, string> = {}) {
  return spawnSync('/bin/sh', [path.join(repoRoot, 'docker/init-secrets.sh')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HELPRR_SECRETS_DIR: dir, HELPRR_APP_DIR: repoRoot, ...env } as unknown as NodeJS.ProcessEnv,
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
        env: { PATH: process.env.PATH ?? '', HELPRR_SECRETS_DIR: dir, HELPRR_APP_DIR: repoRoot } as unknown as NodeJS.ProcessEnv,
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
});
