import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jwtVerify } = vi.hoisted(() => ({ jwtVerify: vi.fn() }));
vi.mock('jose', () => ({ jwtVerify }));
vi.mock('@/lib/jwt-secret', () => ({ getJwtSecret: () => new Uint8Array(32) }));

import { proxy } from './proxy';

describe('offline document authentication boundary', () => {
  beforeEach(() => {
    jwtVerify.mockReset();
    jwtVerify.mockRejectedValue(new Error('Expired session'));
  });

  it.each([undefined, 'expired-session'])('allows precaching without a valid session (%s)', async (token) => {
    const request = new NextRequest('https://helprr.test/offline.html?__WB_REVISION__=new');
    if (token) request.cookies.set('helprr-session', token);
    const response = await proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it.each(['/offline.html/private', '/offline.html-other', '/watch'])('still protects %s', async (path) => {
    const response = await proxy(new NextRequest(`https://helprr.test${path}`));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe(path);
  });

  it('still rejects an invalid session on protected APIs', async () => {
    const request = new NextRequest('https://helprr.test/api/jellyfin/items');
    request.cookies.set('helprr-session', 'expired-session');
    expect((await proxy(request)).status).toBe(401);
    expect(jwtVerify).toHaveBeenCalledOnce();
  });
});

describe('proxy pass-through', () => {
  beforeEach(() => {
    jwtVerify.mockReset();
    jwtVerify.mockRejectedValue(new Error('No session'));
  });

  it('passes the nonce and policy on to Next.js on the request, matching the response policy', async () => {
    const response = await proxy(new NextRequest('https://helprr.test/login'));
    const nonce = response.headers.get('x-middleware-request-x-nonce');
    const policy = response.headers.get('content-security-policy');

    expect(nonce).toBeTruthy();
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    // A fresh nonce for every request.
    const next = await proxy(new NextRequest('https://helprr.test/login'));
    expect(next.headers.get('x-middleware-request-x-nonce')).not.toBe(nonce);
  });

  it('lets a valid session through to pages and APIs', async () => {
    jwtVerify.mockResolvedValue({ payload: { sid: 'session-1' } });
    for (const path of ['/watch', '/api/jellyfin/items']) {
      const request = new NextRequest(`https://helprr.test${path}`);
      request.cookies.set('helprr-session', 'valid-token');
      const response = await proxy(request);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('x-middleware-next'), path).toBe('1');
      expect(response.headers.has('location'), path).toBe(false);
      expect(response.headers.get('x-middleware-request-x-nonce'), path).toBeTruthy();
    }
    expect(jwtVerify).toHaveBeenCalledWith('valid-token', expect.anything(), { algorithms: ['HS256'] });
  });

  it('refuses a verified token without a session id', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: 'user-1' } });
    const api = new NextRequest('https://helprr.test/api/jellyfin/items');
    api.cookies.set('helprr-session', 'token-without-sid');
    expect((await proxy(api)).status).toBe(401);
    const page = new NextRequest('https://helprr.test/watch');
    page.cookies.set('helprr-session', 'token-without-sid');
    expect((await proxy(page)).status).toBe(307);
  });

  it('exposes /api/health exactly, without a session', async () => {
    const response = await proxy(new NextRequest('https://helprr.test/api/health'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(jwtVerify).not.toHaveBeenCalled();

    for (const path of ['/api/health/details', '/api/healthz']) {
      expect((await proxy(new NextRequest(`https://helprr.test${path}`))).status, path).toBe(401);
    }
  });

  it.each(['/sw.js', '/sw-push.js', '/manifest.json', '/icons/icon-192.png', '/_next/webpack-hmr'])(
    'serves %s without a session, as the PWA needs before sign-in',
    async (path) => {
      const response = await proxy(new NextRequest(`https://helprr.test${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(jwtVerify).not.toHaveBeenCalled();
    },
  );

  it.each(['/sw.js.map', '/manifest.json/extra'])('does not stretch those exact paths to %s', async (path) => {
    expect((await proxy(new NextRequest(`https://helprr.test${path}`))).status).toBe(307);
  });
});
