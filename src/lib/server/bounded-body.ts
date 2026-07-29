import { NextResponse } from 'next/server';

export class BoundedBodyError extends Error {
  constructor(
    public readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = 'BoundedBodyError';
  }
}

function mediaTypeOf(request: Request): string {
  return (request.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function declaredLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) {
    throw new BoundedBodyError(413, 'Request body is too large');
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedBodyError(413, 'Request body is too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoundedBodyError) throw error;
    await reader.cancel().catch(() => undefined);
    throw new BoundedBodyError(400, 'Invalid request body');
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedJson<T>(
  request: Request,
  maxBytes: number,
): Promise<T> {
  if (mediaTypeOf(request) !== 'application/json') {
    throw new BoundedBodyError(415, 'Content-Type must be application/json');
  }

  const bytes = await readBoundedBody(request, maxBytes);
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(raw) as T;
  } catch {
    throw new BoundedBodyError(400, 'Invalid JSON body');
  }
}

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const mediaType = mediaTypeOf(request);
  if (
    mediaType !== 'multipart/form-data'
    && mediaType !== 'application/x-www-form-urlencoded'
  ) {
    throw new BoundedBodyError(
      415,
      'Content-Type must be multipart/form-data or application/x-www-form-urlencoded',
    );
  }

  const bytes = await readBoundedBody(request, maxBytes);
  try {
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const clone = new Request(request.url, {
      method: 'POST',
      headers,
      body: bytes,
    });
    return await clone.formData();
  } catch {
    throw new BoundedBodyError(400, 'Invalid form body');
  }
}

export function boundedBodyErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof BoundedBodyError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}
