import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jwtVerify } = vi.hoisted(() => ({ jwtVerify: vi.fn() }));
vi.mock('jose', () => ({ jwtVerify }));
vi.mock('@/lib/jwt-secret', () => ({ getJwtSecret: () => new Uint8Array(32) }));

import { middleware } from './middleware';

describe('offline document authentication boundary', () => {
  beforeEach(() => {
    jwtVerify.mockReset();
    jwtVerify.mockRejectedValue(new Error('Expired session'));
  });

  it.each([undefined, 'expired-session'])('allows precaching without a valid session (%s)', async (token) => {
    const request = new NextRequest('https://helprr.test/offline.html?__WB_REVISION__=new');
    if (token) request.cookies.set('helprr-session', token);
    const response = await middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it.each(['/offline.html/private', '/offline.html-other', '/watch'])('still protects %s', async (path) => {
    const response = await middleware(new NextRequest(`https://helprr.test${path}`));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe(path);
  });

  it('still rejects an invalid session on protected APIs', async () => {
    const request = new NextRequest('https://helprr.test/api/jellyfin/items');
    request.cookies.set('helprr-session', 'expired-session');
    expect((await middleware(request)).status).toBe(401);
    expect(jwtVerify).toHaveBeenCalledOnce();
  });
});
