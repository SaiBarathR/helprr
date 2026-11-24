import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  keepSharedTorrents: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/share/shared-torrents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/shared-torrents')>()),
  keepSharedTorrents: mocks.keepSharedTorrents,
}));
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

// May not add torrents, so a share is read with the text limits.
const MEMBER = { id: 'u2', role: 'member', template: 'member', permissions: { 'torrents.add': false } };
const SIGNED_OUT = { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
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
    mocks.requireUser.mockResolvedValue(SIGNED_OUT);

    const response = await POST(formRequest('title=Hello&text=World'));

    expect(response.status).toBe(303);
    const location = response.headers.get('location')!;
    expect(location.startsWith('/login?')).toBe(true);
    const params = new URLSearchParams(location.slice('/login?'.length));
    expect(params.get('next')).toBe('/share?title=Hello&text=World');
  });

  it('rejects unsupported JSON', async () => {
    const response = await POST(new NextRequest('http://localhost/api/share', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(415);
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
    // Signed in, a share has room for one .torrent file.
    ['declared body', formRequest('title=x', { 'content-length': String(16 * 1024 + 4 * 1024 * 1024 + 1) })],
    ['actual body', formRequest(`text=${'x'.repeat(16 * 1024)}`, { 'content-length': '1' })],
    ['title field', formRequest(`title=${encodeURIComponent('🧪'.repeat(257))}`)],
    ['text field', formRequest(`text=${encodeURIComponent('🧪'.repeat(513))}`)],
    ['URL field', formRequest(`url=${encodeURIComponent(`https://example.com/${'x'.repeat(2049)}`)}`)],
  ])('returns 413 for an oversized %s', async (_label, input) => {
    const response = await POST(input);

    expect(response.status).toBe(413);
  });

  it('keeps the text limit for a signed-out share', async () => {
    mocks.requireUser.mockResolvedValue(SIGNED_OUT);
    const response = await POST(formRequest('title=x', { 'content-length': String(16 * 1024 + 1) }));

    expect(response.status).toBe(413);
  });

  it('caps URL-encoded redirect expansion even when each source field is valid', async () => {
    const body = new URLSearchParams({
      title: '🧪'.repeat(256),
      text: '🧪'.repeat(512),
      url: `https://example.com/${'é'.repeat(1000)}`,
    }).toString();

    const response = await POST(formRequest(body));

    expect(response.status).toBe(413);
  });

  it('caps the final login redirect after the share query is nested and encoded', async () => {
    mocks.requireUser.mockResolvedValue(SIGNED_OUT);
    const body = new URLSearchParams({
      text: 'é'.repeat(1000),
    }).toString();

    const response = await POST(formRequest(body));

    expect(response.status).toBe(413);
  });

  it('returns 400 for malformed multipart form data', async () => {
    const response = await POST(new NextRequest('http://localhost/api/share', {
      method: 'POST',
      body: 'not-a-multipart-body',
      headers: { 'content-type': 'multipart/form-data' },
    }));

    expect(response.status).toBe(400);
  });
});

describe('sharing .torrent files', () => {
  const ADDER = { id: 'u1', role: 'member', template: 'member', permissions: { 'torrents.add': true } };
  const TORRENT = new TextEncoder().encode('d4:infod4:name1:a12:piece lengthi16384eee');

  function shareFiles(files: Array<{ name: string; bytes: Uint8Array }>, fields: Record<string, string> = {}) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const file of files) form.append('torrent', new File([file.bytes as BlobPart], file.name));
    return POST(new NextRequest('http://localhost/api/share', { method: 'POST', body: form }));
  }

  it('keeps the torrents for the user and opens Add with them', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: ADDER, session: {} });
    const response = await shareFiles([
      { name: 'a.torrent', bytes: TORRENT },
      { name: 'notes.txt', bytes: new TextEncoder().encode('hello') },
    ]);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/torrents/add?shared=files');
    expect(mocks.keepSharedTorrents).toHaveBeenCalledWith('u1', [{ name: 'a.torrent', bytes: TORRENT }]);
  });

  it('reads a torrent larger than the text limit for that user', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: ADDER, session: {} });
    const big = new TextEncoder().encode(`d4:infod4:name1:a6:pieces60000:${'x'.repeat(60_000)}ee`);
    const response = await shareFiles([{ name: 'big.torrent', bytes: big }]);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/torrents/add?shared=files');
  });

  it('gives the usual share flow to a user who may not add torrents', async () => {
    // Larger than the text limit, as a real .torrent is.
    const big = new TextEncoder().encode(`d4:infod4:name1:a6:pieces60000:${'x'.repeat(60_000)}ee`);
    const response = await shareFiles([{ name: 'a.torrent', bytes: big }], { title: 'A file' });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/share?title=A+file');
    expect(mocks.keepSharedTorrents).not.toHaveBeenCalled();
  });

  it('keeps nothing for a signed-out share and sends it to sign in', async () => {
    mocks.requireUser.mockResolvedValue(SIGNED_OUT);
    const response = await shareFiles([{ name: 'a.torrent', bytes: TORRENT }]);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')!.startsWith('/login?')).toBe(true);
    expect(mocks.keepSharedTorrents).not.toHaveBeenCalled();
  });

  it('refuses a torrent past the 4 MB share limit', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: ADDER, session: {} });
    const response = await shareFiles([{ name: 'huge.torrent', bytes: new Uint8Array(4 * 1024 * 1024 + 20 * 1024) }]);

    expect(response.status).toBe(413);
    expect(mocks.keepSharedTorrents).not.toHaveBeenCalled();
  });
});
