import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

// Trusted-header sign-in carries no session: public by exact path only; the
// route checks the proxy's secret itself. Nothing next to it opens up.
describe('trusted-header sign-in route exposure', () => {
  it('lets /api/auth/trusted through without a session', async () => {
    const response = await proxy(new NextRequest('http://localhost/api/auth/trusted', { method: 'POST' }));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/api/auth/trusted/', '/api/auth/trusted/x', '/api/auth/trustedx', '/api/auth'])('keeps %s behind sign-in', async (path) => {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.status).toBe(401);
  });
});
