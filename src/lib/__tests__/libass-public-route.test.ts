import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * The subtitle renderer's assets have to be reachable without a session.
 *
 * The PWA registers its service worker while sitting on /login, so for as long
 * as these redirected to the login page they were cached as login HTML. libass
 * then failed on every later load with an opaque worker error, and no amount of
 * signing in fixed it — only clearing the service worker's caches by hand did.
 */
describe('libass asset exposure', () => {
  it.each([
    '/libass/subtitles-octopus-worker.js',
    '/libass/subtitles-octopus-worker-legacy.js',
    '/libass/subtitles-octopus-worker.wasm',
    '/libass/default.woff2',
  ])('serves %s without a session', async (path) => {
    const response = await middleware(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('still gates an authenticated page, so the allowance is scoped', async () => {
    const response = await middleware(new NextRequest('http://localhost/jellyfin/library'));
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.headers.get('location')).toContain('/login');
  });
});
