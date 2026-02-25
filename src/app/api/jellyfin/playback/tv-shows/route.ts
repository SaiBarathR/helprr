import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import {
  getDefaultEndDate,
  sanitizeDays,
  parsePlaybackUserId,
  parsePlaybackDateRange,
  escapeSqlLiteral,
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

    const days = sanitizeDays(searchParams.get('days'), 30);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();

    const client = await getJellyfinClient();

    if (userId) {
      let range;
      try {
        range = parsePlaybackDateRange(searchParams.get('days'), searchParams.get('endDate'), 30);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid date range' },
          { status: 400 }
        );
      }

      const query = `
        SELECT
          CASE
            WHEN instr(ItemName, ' - ') > 0 THEN substr(ItemName, 1, instr(ItemName, ' - ') - 1)
            ELSE ItemName
          END as Label,
          COUNT(*) as Plays,
          COALESCE(SUM(PlayDuration), 0) as TotalDuration
        FROM PlaybackActivity
        WHERE ItemType = 'Episode'
          AND date(DateCreated) >= date('${escapeSqlLiteral(range.startDate)}')
          AND date(DateCreated) <= date('${escapeSqlLiteral(range.endDate)}')
          AND UserId = '${escapeSqlLiteral(userId)}'
        GROUP BY Label
        ORDER BY Plays DESC, TotalDuration DESC
      `;

      const result = await client.submitCustomQuery(query);
      if (!result || !Array.isArray(result.results)) {
        return NextResponse.json({ shows: [], pluginAvailable: false });
      }

      const shows = result.results
        .filter((row): row is string[] => Array.isArray(row))
        .map((row) => ({
          label: String(row[0] ?? 'Unknown'),
          count: Number.parseFloat(String(row[1] ?? '0')) || 0,
          time: Number.parseFloat(String(row[2] ?? '0')) || 0,
        }))
        .filter((row) => row.label && (row.count > 0 || row.time > 0));

      return NextResponse.json({ shows, pluginAvailable: true });
    }

    const shows = await client.getTvShowsReport(days, endDate);
    return NextResponse.json({ shows: shows ?? [], pluginAvailable: shows !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch TV shows report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
