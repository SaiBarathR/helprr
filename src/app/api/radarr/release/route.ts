import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const movieId = searchParams.get('movieId');

    if (!movieId) {
      return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
    }

    const client = await getRadarrClient();
    const releases = await client.getReleases(Number(movieId));
    return NextResponse.json(releases);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search releases';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Trigger grabbing a Radarr release using identifiers supplied in the request body.
 *
 * Expects the request body to be JSON with `guid` (string) and `indexerId` (number) — `downloadClientId` (number) may be provided to select a download client.
 *
 * @param request - The incoming HTTP request whose JSON body contains `{ guid, indexerId, downloadClientId? }`
 * @returns A JSON response: `{ success: true }` on success; otherwise `{ error: string }` with status `400` for missing/invalid input or `500` for internal failures.
 */
export async function POST(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const { guid, indexerId, downloadClientId } = body;

    if (!guid || indexerId === undefined) {
      return NextResponse.json({ error: 'guid and indexerId are required' }, { status: 400 });
    }

    const client = await getRadarrClient();
    await client.grabRelease(guid, indexerId, downloadClientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to grab release';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}