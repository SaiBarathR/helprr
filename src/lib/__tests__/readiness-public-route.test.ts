import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

describe('readiness route exposure', () => {
  it('allows exactly /api/ready without a session', async () => {
    const response = await middleware(new NextRequest('http://localhost/api/ready'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not expose readiness subpaths', async () => {
    const response = await middleware(new NextRequest('http://localhost/api/ready/details'));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});
