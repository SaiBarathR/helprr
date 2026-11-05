import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn() }));

import { getClientIp } from '@/lib/login-rate-limit';

function request(headers: Record<string, string>) {
  return new NextRequest('http://helprr.test/api/auth/login', { headers });
}

describe('getClientIp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('trusts no forwarded header unless TRUST_FORWARDED_PROTO is on', () => {
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.7' }))).toBeUndefined();
  });

  it("takes the address the nearest proxy added, not one a visitor sent", () => {
    vi.stubEnv('TRUST_FORWARDED_PROTO', 'true');
    // Cloudflare Tunnel and Nginx Proxy Manager keep what the visitor sent and append.
    expect(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7');
    expect(getClientIp(request({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.7' }))).toBe('203.0.113.7');
    // Caddy and Tailscale Serve replace it.
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('counts TRUSTED_PROXY_HOPS proxies from the end for a chain', () => {
    vi.stubEnv('TRUST_FORWARDED_PROTO', 'true');
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
    // Visitor → Cloudflare → Nginx Proxy Manager (172.18.0.5) → Helprr.
    expect(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 172.18.0.5' }))).toBe('203.0.113.7');
    // Fewer entries than hops: all of them came from trusted proxies.
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('falls back to 1 for a TRUSTED_PROXY_HOPS that is not a small whole number', () => {
    vi.stubEnv('TRUST_FORWARDED_PROTO', 'true');
    for (const hops of ['', '0', '-1', '1.5', 'two', '11']) {
      vi.stubEnv('TRUSTED_PROXY_HOPS', hops);
      expect(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' })), hops).toBe('203.0.113.7');
    }
  });

  it('gives no address when the chosen entry is not one, and never reads X-Real-IP', () => {
    vi.stubEnv('TRUST_FORWARDED_PROTO', 'true');
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.7, unknown', 'x-real-ip': '6.6.6.6' }))).toBeUndefined();
    expect(getClientIp(request({ 'x-real-ip': '203.0.113.7' }))).toBeUndefined();
  });
});
