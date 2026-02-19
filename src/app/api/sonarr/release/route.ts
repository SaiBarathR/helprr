import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const episodeId = searchParams.get('episodeId');
    const seriesId = searchParams.get('seriesId');
    const seasonNumber = searchParams.get('seasonNumber');

    if (!episodeId && !seriesId) {
      return NextResponse.json({ error: 'episodeId or seriesId is required' }, { status: 400 });
    }

    const client = await getSonarrClient();
    const params: { episodeId?: number; seriesId?: number; seasonNumber?: number } = {};
    if (episodeId) {
      params.episodeId = Number(episodeId);
    } else {
      params.seriesId = Number(seriesId);
      if (seasonNumber !== null) {
        params.seasonNumber = Number(seasonNumber);
      }
    }

    const releases = await client.getReleases(params);
    return NextResponse.json(releases);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search releases';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Initiates a grab of a Sonarr release using parameters supplied in the request body.
 *
 * Expects a JSON body with `guid` (release identifier) and `indexerId` (indexer identifier); `downloadClientId` may be provided to select a specific download client.
 *
 * @param request - HTTP request whose JSON body must contain:
 *   - `guid`: the release GUID to grab
 *   - `indexerId`: the indexer ID to use for the grab
 *   - `downloadClientId` (optional): the download client ID to route the grab through
 * @returns A NextResponse with `{ success: true }` on success, or `{ error: string }` on failure. Responses use status 400 for missing required fields and 500 for server errors.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { guid, indexerId, downloadClientId } = body;

    if (!guid || indexerId === undefined) {
      return NextResponse.json({ error: 'guid and indexerId are required' }, { status: 400 });
    }

    const client = await getSonarrClient();
    await client.grabRelease(guid, indexerId, downloadClientId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to grab release';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}