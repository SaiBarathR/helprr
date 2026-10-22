import { describe, expect, it, vi } from 'vitest';
import { cacheShellResponse, hasMatchingShellNonce, matchingShellResponse } from './shell-cache';

const shellNoncesMatch = (csp: string | null, html: string) => hasMatchingShellNonce(new Response(html, {
  headers: csp === null ? {} : { 'content-security-policy': csp },
}));

describe('HTML CSP nonce consistency', () => {
  it('accepts matching header and body nonces', async () => {
    expect(await shellNoncesMatch("script-src 'nonce-c2hlbGw=' 'strict-dynamic'", '<script nonce="c2hlbGw=">')).toBe(true);
  });

  it('rejects mismatched header and body nonces', async () => {
    expect(await shellNoncesMatch("script-src 'nonce-header'", '<script nonce="body">')).toBe(false);
  });

  it('compares the first body nonce, including single-quoted attributes', async () => {
    expect(await shellNoncesMatch("script-src 'nonce-header'", "<script nonce='body'></script><script nonce='header'>")).toBe(false);
  });

  it('compares nonce values case-sensitively', async () => {
    expect(await shellNoncesMatch("script-src 'nonce-Shell'", '<script nonce="shell">')).toBe(false);
  });

  it('accepts HTML without CSP or without a CSP nonce', async () => {
    expect(await shellNoncesMatch(null, '<script nonce="body">')).toBe(true);
    expect(await shellNoncesMatch("script-src 'self'", '<script nonce="body">')).toBe(true);
  });

  it('accepts HTML without a body nonce', async () => {
    expect(await shellNoncesMatch("script-src 'nonce-header'", '<script src="/app.js">')).toBe(true);
  });

  it.each([null, "script-src 'self'"])('does not clone or read a body when CSP is %s', async (csp) => {
    const response = new Response('<script nonce="body">', {
      headers: csp === null ? {} : { 'content-security-policy': csp },
    });
    const clone = vi.spyOn(response, 'clone');
    expect(await hasMatchingShellNonce(response)).toBe(true);
    expect(clone).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(false);
  });
});

describe('HTML build compatibility', () => {
  it('keeps same-build offline pages and rejects obsolete or unstamped pages', async () => {
    const html = new Response('<html>shell</html>', { headers: { 'content-type': 'text/html' } });
    const cached = cacheShellResponse(html, 'build-a')!;
    expect(await matchingShellResponse(cached, 'build-a')!.text()).toBe('<html>shell</html>');
    expect(matchingShellResponse(cached, 'build-b')).toBeNull();
    expect(matchingShellResponse(html, 'build-a')).toBeNull();
    expect(matchingShellResponse(undefined, 'build-a')).toBeNull();
  });
  it('does not save authentication failures or non-HTML responses', () => {
    expect(cacheShellResponse(new Response('', { status: 401 }), 'a')).toBeNull();
    expect(cacheShellResponse(Response.json({}), 'a')).toBeNull();
  });
});
