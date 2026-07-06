import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import {
  getDefaultEndDate,
  sanitizeDays,
  parsePlaybackUserId,
  executeUserPlaybackQuery,
} from '@/lib/jellyfin-playback-query';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.stats');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    let userId: string | null;
    try {
      userId = parsePlaybackUserId(searchParams.get('userId'));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid userId' },
        { status: 400 }
      );
    }

    const client = await getJellyfinClient();

    if (userId) {
      const result = await executeUserPlaybackQuery(client, userId, searchParams, {
        defaultDays: 30,
        itemType: 'Movie',
        labelExpr: 'ItemName',
      });
      if (result.kind === 'badRequest') {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ movies: result.entries, pluginAvailable: result.pluginAvailable });
    }

    const days = sanitizeDays(searchParams.get('days'), 30);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();
    const movies = await client.getMoviesReport(days, endDate);
    return NextResponse.json({ movies: movies ?? [], pluginAvailable: movies !== null });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch movies report');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/movies');
