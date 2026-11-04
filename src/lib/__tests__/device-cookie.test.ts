// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeDeviceCookie } from '@/lib/client-sign-in';

// A Secure cookie set from an http:// page is rejected, so the dashboard rendered the
// other layout on every refresh and refreshed forever (a phone on a LAN address).
function written(protocol: string): string {
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, protocol } as Location);
  const set = vi.fn();
  vi.spyOn(document, 'cookie', 'set').mockImplementation(set);
  writeDeviceCookie('mobile');
  return set.mock.calls[0][0] as string;
}
afterEach(() => vi.restoreAllMocks());

describe('writeDeviceCookie', () => {
  it('leaves out Secure on plain http', () => {
    const cookie = written('http:');
    expect(cookie).toMatch(/^helprr-device=mobile; Path=\/; SameSite=Lax; Max-Age=\d+$/);
  });

  it('keeps Secure on https', () => {
    expect(written('https:')).toContain('; Secure;');
  });
});
