import { NextResponse } from 'next/server';
import { YoutubeKeyRejectedError, YoutubeQuotaError } from '@/lib/youtube/api';

/** What a route says when a YouTube call fails. Each message tells the reader what to do. */
export function youtubeErrorResponse(error: unknown): NextResponse {
  if (error instanceof YoutubeKeyRejectedError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof YoutubeQuotaError) return NextResponse.json({ error: error.message }, { status: 429 });
  return NextResponse.json({ error: 'Could not reach YouTube' }, { status: 502 });
}
