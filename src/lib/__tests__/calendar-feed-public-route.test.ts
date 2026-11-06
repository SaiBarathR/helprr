import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

// Calendar apps send no session, so the feed is public by exact path only; the
// route checks its own per-user feed token. Nothing next to it opens up.
describe('calendar feed route exposure', () => {
  it.each(['/api/calendar/feed.ics', '/api/calendar/feed.ics?token=x&type=episode'])('lets %s through without a session', async (path) => {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    '/api/calendar',
    '/api/calendar/feed-token',
    '/api/calendar/feed.ics/',
    '/api/calendar/feed.ics/x',
    '/api/calendar/feed.icsx',
    '/api/calendar/feed',
    '/api/calendar/FEED.ics',
  ])('keeps %s behind sign-in', async (path) => {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.status).toBe(401);
  });
});
