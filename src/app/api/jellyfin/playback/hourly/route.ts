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

    const days = sanitizeDays(searchParams.get('days'), 7);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();

    const client = await getJellyfinClient();

    if (userId) {
      let range;
      try {
        range = parsePlaybackDateRange(searchParams.get('days'), searchParams.get('endDate'), 7);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Invalid date range' },
          { status: 400 }
        );
      }

      const query = `
        SELECT
          ((CAST(strftime('%w', DateCreated) AS INTEGER) + 6) % 7) as DayIdx,
          strftime('%H', DateCreated) as Hour,
          COALESCE(SUM(PlayDuration), 0) as TotalDuration
        FROM PlaybackActivity
        WHERE date(DateCreated) >= date('${escapeSqlLiteral(range.startDate)}')
          AND date(DateCreated) <= date('${escapeSqlLiteral(range.endDate)}')
          AND UserId = '${escapeSqlLiteral(userId)}'
        GROUP BY DayIdx, Hour
        ORDER BY DayIdx ASC, Hour ASC
      `;

      let result: { columns: string[]; results: string[][] } | null;
      try {
        result = await client.submitCustomQuery(query);
      } catch {
        return NextResponse.json({ data: {}, pluginAvailable: false });
      }

      if (!result || !Array.isArray(result.results)) {
        return NextResponse.json({ data: {}, pluginAvailable: false });
      }

      const data: Record<string, number> = {};
      for (const row of result.results) {
        if (!Array.isArray(row)) continue;
        const dayIdx = Number.parseInt(String(row[0] ?? '-1'), 10);
        const hour = String(row[1] ?? '').padStart(2, '0');
        const totalDuration = Number.parseFloat(String(row[2] ?? '0'));
        if (dayIdx < 0 || dayIdx > 6 || hour.length !== 2 || Number.isNaN(totalDuration)) continue;
        data[`${dayIdx}-${hour}`] = totalDuration;
      }

      return NextResponse.json({ data, pluginAvailable: true });
    }

    let filter = searchParams.get('filter');
    if (!filter) {
      const types = await client.getTypeFilterList();
      filter = !types || types.length === 0 ? 'Movie,Episode,Audio' : types.join(',');
    }

    const data = await client.getHourlyReport(days, endDate, filter);
    return NextResponse.json({ data: data ?? {}, pluginAvailable: data !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch hourly report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
