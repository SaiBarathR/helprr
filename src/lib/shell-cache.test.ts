import { describe, expect, it } from 'vitest';
import { cacheShellResponse, matchingShellResponse, shellNoncesMatch } from './shell-cache';

describe('HTML CSP nonce consistency', () => {
  it('accepts matching header and body nonces', () => {
    expect(shellNoncesMatch("script-src 'nonce-c2hlbGw=' 'strict-dynamic'", '<script nonce="c2hlbGw=">')).toBe(true);
  });

  it('rejects mismatched header and body nonces', () => {
    expect(shellNoncesMatch("script-src 'nonce-header'", '<script nonce="body">')).toBe(false);
  });

  it('compares the first body nonce, including single-quoted attributes', () => {
    expect(shellNoncesMatch("script-src 'nonce-header'", "<script nonce='body'></script><script nonce='header'>")).toBe(false);
  });

  it('compares nonce values case-sensitively', () => {
    expect(shellNoncesMatch("script-src 'nonce-Shell'", '<script nonce="shell">')).toBe(false);
  });

  it('accepts HTML without CSP or without a CSP nonce', () => {
    expect(shellNoncesMatch(null, '<script nonce="body">')).toBe(true);
    expect(shellNoncesMatch("script-src 'self'", '<script nonce="body">')).toBe(true);
  });

  it('accepts HTML without a body nonce', () => {
    expect(shellNoncesMatch("script-src 'nonce-header'", '<script src="/app.js">')).toBe(true);
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
