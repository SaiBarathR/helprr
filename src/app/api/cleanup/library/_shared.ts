import { NextResponse } from 'next/server';
import { LibraryCleanupUnavailableError } from '@/lib/library-cleanup/inputs';

/** A source that could not be read: the message says which, and that nothing changed. */
export function libraryCleanupErrorResponse(error: unknown): NextResponse {
  if (error instanceof LibraryCleanupUnavailableError) {
    return NextResponse.json({ error: error.message, code: 'SOURCE_UNAVAILABLE' }, { status: 503 });
  }
  throw error;
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
