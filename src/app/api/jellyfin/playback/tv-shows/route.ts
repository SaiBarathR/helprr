import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import {
  getDefaultEndDate,
  sanitizeDays,
  parsePlaybackUserId,
  executeUserPlaybackQuery,
} from '@/lib/jellyfin-playback-query';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

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
        itemType: 'Episode',
        labelExpr: `
          CASE
            WHEN instr(ItemName, ' - ') > 0 THEN substr(ItemName, 1, instr(ItemName, ' - ') - 1)
            ELSE ItemName
          END
        `,
      });
      if (result.kind === 'badRequest') {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ shows: result.entries, pluginAvailable: result.pluginAvailable });
    }

    const days = sanitizeDays(searchParams.get('days'), 30);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();
    const shows = await client.getTvShowsReport(days, endDate);
    return NextResponse.json({ shows: shows ?? [], pluginAvailable: shows !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch TV shows report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
