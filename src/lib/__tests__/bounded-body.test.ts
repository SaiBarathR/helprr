import { describe, expect, it, vi } from 'vitest';
import {
  BoundedBodyError,
  readBoundedBody,
  readBoundedFormData,
  readBoundedJson,
} from '@/lib/server/bounded-body';

function streamingRequest(
  chunks: string[],
  headers: Record<string, string> = {},
  cancel = vi.fn(),
): { request: Request; cancel: ReturnType<typeof vi.fn> } {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
    cancel,
  });
  const request = new Request('http://localhost/test', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return { request, cancel };
}

describe('bounded request body helpers', () => {
  it('accepts an actual body exactly at the byte limit', async () => {
    const { request } = streamingRequest(['1234', '5678']);

    await expect(readBoundedBody(request, 8)).resolves.toEqual(
      new TextEncoder().encode('12345678'),
    );
  });

  it('rejects a declared body above the limit before consuming the stream', async () => {
    const { request, cancel } = streamingRequest(
      ['body'],
      { 'content-length': '9' },
    );

    await expect(readBoundedBody(request, 8)).rejects.toMatchObject({
      status: 413,
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('enforces streamed bytes when length is absent, malformed, or spoofed smaller', async () => {
    for (const contentLength of [undefined, 'bogus', '1']) {
      const headers: Record<string, string> = contentLength === undefined
        ? {}
        : { 'content-length': contentLength };
      const { request } = streamingRequest(['1234', '56789'], headers);

      await expect(readBoundedBody(request, 8)).rejects.toMatchObject({
        status: 413,
      });
    }
  });

  it('requires the declared JSON media type and rejects malformed JSON', async () => {
    await expect(readBoundedJson(
      new Request('http://localhost/test', { method: 'POST', body: '{}' }),
      32,
    )).rejects.toMatchObject({ status: 415 });

    await expect(readBoundedJson(
      new Request('http://localhost/test', {
        method: 'POST',
        body: '{"broken":',
        headers: { 'content-type': 'application/json' },
      }),
      32,
    )).rejects.toMatchObject({ status: 400 });
  });

  it('parses supported URL-encoded forms and rejects JSON forms', async () => {
    const form = await readBoundedFormData(
      new Request('http://localhost/test', {
        method: 'POST',
        body: 'title=Hello&text=World',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
      128,
    );
    expect(form.get('title')).toBe('Hello');
    expect(form.get('text')).toBe('World');

    await expect(readBoundedFormData(
      new Request('http://localhost/test', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
      128,
    )).rejects.toBeInstanceOf(BoundedBodyError);
  });
});
