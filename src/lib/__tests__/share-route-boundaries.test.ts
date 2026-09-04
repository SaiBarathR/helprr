import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { POST } from '@/app/api/share/route';

function formRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/share', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
});

describe('Web Share Target request boundaries', () => {
  it('redirects a valid authenticated form to the share resolution page', async () => {
    const response = await POST(formRequest(
      new URLSearchParams({
        title: 'A title',
        text: 'Shared text',
        url: 'https://www.themoviedb.org/movie/1',
      }).toString(),
    ));

    expect(response.status).toBe(303);
    const location = response.headers.get('location')!;
    expect(location.startsWith('/share?')).toBe(true);
    const params = new URLSearchParams(location.slice('/share?'.length));
    expect(params.get('title')).toBe('A title');
    expect(params.get('url')).toBe('https://www.themoviedb.org/movie/1');
  });

  it('preserves a bounded valid payload through unauthenticated login', async () => {
    mocks.requireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const response = await POST(formRequest('title=Hello&text=World'));

    expect(response.status).toBe(303);
    const location = response.headers.get('location')!;
    expect(location.startsWith('/login?')).toBe(true);
    const params = new URLSearchParams(location.slice('/login?'.length));
    expect(params.get('next')).toBe('/share?title=Hello&text=World');
  });

  it('rejects unsupported JSON without invoking authentication', async () => {
    const response = await POST(new NextRequest('http://localhost/api/share', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(415);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });

  it('names no host, whatever the server believes its own URL to be', async () => {
    // A standalone build reports its bind address in `request.url`, so the
    // Location built from it sent every share to http://0.0.0.0:3050 -- found
    // by sharing a link into the installed Android PWA, and invisible to the
    // cases above because they only ever asserted the path and the query.
    const response = await POST(new NextRequest('http://0.0.0.0:3050/api/share', {
      method: 'POST',
      body: 'title=Hello',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/share?title=Hello');
  });

  it.each([
    ['declared body', formRequest('title=x', { 'content-length': String(16 * 1024 + 1) })],
    ['actual body', formRequest(`text=${'x'.repeat(16 * 1024)}`, { 'content-length': '1' })],
    ['title field', formRequest(`title=${encodeURIComponent('🧪'.repeat(257))}`)],
    ['text field', formRequest(`text=${encodeURIComponent('🧪'.repeat(513))}`)],
    ['URL field', formRequest(`url=${encodeURIComponent(`https://example.com/${'x'.repeat(2049)}`)}`)],
  ])('returns 413 for an oversized %s before auth', async (_label, input) => {
    const response = await POST(input);

    expect(response.status).toBe(413);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });

  it('caps URL-encoded redirect expansion even when each source field is valid', async () => {
    const body = new URLSearchParams({
      title: '🧪'.repeat(256),
      text: '🧪'.repeat(512),
      url: `https://example.com/${'é'.repeat(1000)}`,
    }).toString();

    const response = await POST(formRequest(body));

    expect(response.status).toBe(413);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });

  it('caps the final login redirect after the share query is nested and encoded', async () => {
    mocks.requireAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const body = new URLSearchParams({
      text: 'é'.repeat(1000),
    }).toString();

    const response = await POST(formRequest(body));

    expect(response.status).toBe(413);
    expect(mocks.requireAuth).toHaveBeenCalledOnce();
  });

  it('returns 400 for malformed multipart form data', async () => {
    const response = await POST(new NextRequest('http://localhost/api/share', {
      method: 'POST',
      body: 'not-a-multipart-body',
      headers: { 'content-type': 'multipart/form-data' },
    }));

    expect(response.status).toBe(400);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });
});
