import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

// The first-admin screen and its two routes are public by exact path only; the
// routes themselves decide whether setup is still open.
describe('first-admin route exposure', () => {
  it.each(['/setup', '/api/setup/state', '/api/setup/admin'])('lets %s through without a session', async (path) => {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/api/setup/admin/x', '/api/setup/adminx', '/api/setup', '/api/setup/state/'])('keeps %s behind sign-in', async (path) => {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it('sends /setup/anything to sign in', async () => {
    const response = await proxy(new NextRequest('http://localhost/setup/anything'));
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.status).toBeGreaterThanOrEqual(300);
  });
});
