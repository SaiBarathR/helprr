import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('no-clone release packaging', () => {
  const assets = [
    { releaseName: 'docker-compose.yml', source: 'docker-compose.yml', executable: false },
    { releaseName: 'env.example', source: '.env.example', executable: false },
    { releaseName: 'setup-env.sh', source: 'scripts/setup-env.sh', executable: true },
    { releaseName: 'backup.sh', source: 'scripts/backup.sh', executable: true },
    { releaseName: 'update.sh', source: 'scripts/update.sh', executable: true },
    { releaseName: 'install.sh', source: 'scripts/install.sh', executable: true },
  ];

  it('keeps every required source file available and helper scripts executable', () => {
    for (const asset of assets) {
      const source = path.join(root, asset.source);
      expect(existsSync(source), asset.source).toBe(true);
      if (asset.executable) {
        expect(() => accessSync(source, constants.X_OK), asset.source).not.toThrow();
      }
    }
  });

  it('attaches the complete exact-version asset set to tagged draft releases', () => {
    const workflow = read('.github/workflows/docker-publish.yml');
    const releaseJob = workflow.slice(workflow.indexOf('\n  release:'));

    expect(releaseJob).toContain('cp .env.example env.example');
    expect(releaseJob).toContain('install -m 0755 scripts/setup-env.sh setup-env.sh');
    expect(releaseJob).toContain('install -m 0755 scripts/backup.sh backup.sh');
    expect(releaseJob).toContain('install -m 0755 scripts/update.sh update.sh');
    expect(releaseJob).toContain('install -m 0755 scripts/install.sh install.sh');
    expect(releaseJob).toContain('sha256sum docker-compose.yml env.example setup-env.sh backup.sh update.sh install.sh > SHA256SUMS');
    expect(releaseJob).toContain('docker-compose.yml env.example setup-env.sh backup.sh update.sh install.sh SHA256SUMS');
    for (const asset of assets) {
      expect(releaseJob, asset.releaseName).toContain(asset.releaseName);
    }
  });

  it('documents a complete clean-directory layout and isolated source command', () => {
    const readme = read('README.md');
    const compose = read('docker-compose.yml');

    expect(readme).toContain('mkdir -p helprr/scripts && cd helprr');
    expect(readme).toContain('releases/latest/download');
    expect(readme).toContain('-o docker-compose.yml "$HELPRR_ASSET_BASE/docker-compose.yml"');
    expect(readme).toContain('-o .env.example "$HELPRR_ASSET_BASE/env.example"');
    expect(readme).toContain('-o scripts/setup-env.sh "$HELPRR_ASSET_BASE/setup-env.sh"');
    expect(readme).toContain('-o scripts/backup.sh "$HELPRR_ASSET_BASE/backup.sh"');
    expect(readme).toContain('-o scripts/update.sh "$HELPRR_ASSET_BASE/update.sh"');
    expect(readme).toContain('chmod 700 scripts/setup-env.sh scripts/backup.sh scripts/update.sh');
    expect(readme).toContain('./scripts/setup-env.sh');
    expect(readme).toContain('./scripts/backup.sh');
    expect(readme).toContain('./scripts/update.sh');

    expect(compose).toContain(
      'docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build',
    );
    expect(compose).not.toContain(
      'docker compose -f docker-compose.yml -f docker-compose.dev.yml',
    );
  });

  it('keeps the worker behind a profile, off by default, in both stacks', () => {
    const stable = read('docker-compose.yml');
    const dev = read('docker-compose.dev.yml');
    expect(stable).toMatch(/helprr-twitch-worker:\n[\s\S]*?profiles: \["twitch", "youtube"\]/);
    expect(dev).toMatch(/helprr-dev-twitch-worker:\n[\s\S]*?profiles: \["twitch", "youtube"\]/);
    expect(dev).toContain('HELPRR_DEV_TWITCH_LIBRARY_HOST_PATH');
    expect(read('.env.example')).toContain('# COMPOSE_PROFILES=twitch');
  });

  it('creates no YouTube folder until one is chosen, and keeps stable and dev apart', () => {
    expect(read('docker-compose.yml')).toContain('${YOUTUBE_LIBRARY_HOST_PATH:-/dev/null}:/media/youtube');
    expect(read('docker-compose.dev.yml')).toContain('${HELPRR_DEV_YOUTUBE_LIBRARY_HOST_PATH:-/dev/null}:/media/youtube');
    expect(read('docker-compose.dev.yml')).not.toMatch(/\$\{YOUTUBE_LIBRARY_HOST_PATH/);
  });

  it('publishes and promotes the Twitch worker with the app', () => {
    const publish = read('.github/workflows/docker-publish.yml');
    const promote = read('.github/workflows/docker-promote.yml');
    expect(publish).toContain('ghcr.io/saibarathr/helprr-twitch-worker');
    expect(publish).toContain('docker/twitch-worker.Dockerfile');
    expect(promote).toContain('worker_digest');
  });
});

describe('Compose defaults that fit more machines', () => {
  const stable = read('docker-compose.yml');
  const dev = read('docker-compose.dev.yml');
  const service = (file: string, name: string) => {
    const start = file.indexOf(`\n  ${name}:\n`);
    const next = file.slice(start + 1).search(/\n  [a-z][\w-]*:\n/);
    return file.slice(start, next < 0 ? undefined : start + 1 + next);
  };

  it('lets the stable host port change, and keeps dev on its own variable', () => {
    expect(stable).toContain('"${HELPRR_PORT:-3050}:3050"');
    expect(stable).not.toContain('"3050:3050"');
    expect(dev).toContain('${HELPRR_DEV_APP_PORT:-3051}:3050');
    expect(dev).not.toContain('HELPRR_PORT');
  });

  it('maps host.docker.internal for the app, which reaches the services', () => {
    expect(service(stable, 'helprr')).toContain('"host.docker.internal:host-gateway"');
    expect(service(dev, 'helprr-dev')).toContain('"host.docker.internal:host-gateway"');
  });

  it.each([
    ['stable', stable, 'helprr-twitch-worker'],
    ['dev', dev, 'helprr-dev-twitch-worker'],
  ])('starts the %s worker without a GPU, and gives it the GPU when there is one', (_label, file, name) => {
    const worker = service(file, name);
    expect(worker).not.toMatch(/\n    devices:/);
    expect(worker).toContain('- /dev/dri:/dev/dri:ro');
    expect(worker).toContain('"c 226:* rw"');
    expect(worker).not.toMatch(/\/dev\/dri:\/dev\/dri:[^\n]*[zZ]/);
  });

  it('keeps the fresh-install drill working with the port variable', () => {
    const drill = read('docs/server-drills.md');
    expect(drill).not.toContain('"3050:3050"');
    expect(drill).toContain('HELPRR_PORT=3059');
  });
});
