import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PASSWORD, DEMO_USERNAME, isDemo } from '@/lib/demo';
import LoginLayout from '@/app/login/layout';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
const compose = read('docker-compose.demo.yml');

describe('docker-compose.demo.yml', () => {
  it('is its own project, with only helprr-demo names', () => {
    expect(compose).toMatch(/^name: helprr-demo$/m);
    const names = [...compose.matchAll(/container_name: (\S+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) expect(name).toMatch(/^helprr-demo(-|$)/);
    const top = compose.indexOf('\nvolumes:\n');
    expect(top).toBeGreaterThan(0);
    // Every line of the block, so a volume in any form is seen.
    const volumes = compose.slice(top + '\nvolumes:\n'.length, compose.indexOf('\nnetworks:\n', top)).split('\n').filter((line) => line.trim());
    expect(volumes).toEqual(['  helprr-demo-secrets:', '  helprr-demo-db-auth:', '  helprr-demo-redis-auth:']);
    // Nothing named outside the project (so down -v reaches only the demo), nothing
    // external, no host network; the database alias lives on the demo network alone.
    expect(compose.match(/^\s*name:/gm)).toEqual(['name:']);
    expect(compose).not.toMatch(/external:|network_mode: host|helprr-net\b/);
  });

  it('answers on this computer only, and never restarts on its own', () => {
    // One published port, in short form, on 127.0.0.1.
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1);
    // ...and nothing after it: a second entry would answer on every interface.
    expect(compose).toMatch(/ports:\n\s+- "127\.0\.0\.1:\$\{HELPRR_DEMO_PORT:-3060\}:3050"\n(?!\s+-)/);
    expect(compose).not.toMatch(/published:|host_ip:|expose:/);
    expect(compose).not.toMatch(/restart: (unless-stopped|always)/);
  });

  it('keeps the database and Redis in memory, so removing the demo wipes them', () => {
    expect(compose).toMatch(/tmpfs:\n\s+- \/var\/lib\/postgresql\/data/);
    expect(compose).toMatch(/tmpfs:\n\s+- \/data/);
    expect(compose).not.toMatch(/helprr-demo-(db|redis)-data/);
  });

  it('turns the demo on, with the account the banner and the seed use', () => {
    expect(compose).toContain('- HELPRR_DEMO=true');
    expect(compose).toContain(`- HELPRR_ADMIN_USERNAME=${DEMO_USERNAME}`);
    expect(compose).toContain(`- APP_PASSWORD=${DEMO_PASSWORD}`);
    const seed = read('demo/seed.mjs');
    expect(seed).toContain(`const USERNAME = '${DEMO_USERNAME}';`);
    expect(seed).toContain(`const PASSWORD = '${DEMO_PASSWORD}';`);
  });

  it('fails to start, rather than start empty, on an image without the demo', () => {
    expect(compose).toMatch(/helprr-demo-upstreams:\n\s+condition: service_healthy/);
    expect(compose).toContain('${HELPRR_DEMO_VERSION:-stable}');
    expect(compose).not.toContain('${HELPRR_VERSION');
  });

  it('lets posters through from the fake apps, by the name they are served under', () => {
    expect(compose).toContain('container_name: helprr-demo-upstreams');
    expect(compose).toContain('- EXTRA_ALLOWED_IMAGE_HOSTS=helprr-demo-upstreams');
    expect(read('demo/apps/servarr.mjs')).toContain("'http://helprr-demo-upstreams:9000'");
  });
});

describe('demo banner', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off unless HELPRR_DEMO is exactly "true"', () => {
    expect(isDemo({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isDemo({ HELPRR_DEMO: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isDemo({ HELPRR_DEMO: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('gives the demo account on the sign-in page, and nothing in a real install', () => {
    vi.stubEnv('HELPRR_DEMO', 'true');
    // A real install's APP_PASSWORD is never what the banner shows.
    vi.stubEnv('APP_PASSWORD', 'a-real-install-password-123');
    const demo = renderToStaticMarkup(LoginLayout({ children: 'form' }) as React.ReactElement);
    expect(demo).toContain('Demo: fake data. It resets when removed.');
    expect(demo).toContain(DEMO_PASSWORD);
    expect(demo).not.toContain('a-real-install-password-123');
    vi.stubEnv('HELPRR_DEMO', '');
    expect(renderToStaticMarkup(LoginLayout({ children: 'form' }) as React.ReactElement)).toBe('form');
  });
});
