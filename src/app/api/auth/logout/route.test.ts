import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentSid: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'helprr-session',
  getCurrentSid: mocks.getCurrentSid,
  revokeSession: mocks.revokeSession,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST } from './route';

const logout = () => POST(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentSid.mockResolvedValue('sid-1');
  mocks.revokeSession.mockResolvedValue(undefined);
});

describe('POST /api/auth/logout', () => {
  it('ends the session and leaves the signed-out marker, so proxy sign-in waits for a tap', async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    expect(mocks.revokeSession).toHaveBeenCalledWith('sid-1');
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('helprr-session=;') && c.includes('Max-Age=0'))).toBe(true);
    const marker = cookies.find((c) => c.startsWith('helprr-signed-out=1'));
    expect(marker).toBeDefined();
    expect(marker).toContain('HttpOnly');
    expect(marker).toContain('Max-Age=86400');
  });

  it('leaves no marker when the session could not be ended', async () => {
    mocks.revokeSession.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await logout();
    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
