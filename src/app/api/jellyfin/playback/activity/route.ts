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

export async function GET(request: NextRequest) {
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
    const dataType = searchParams.get('dataType') || 'count';

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

      const aggregateExpr = dataType === 'duration' || dataType === 'time'
        ? 'COALESCE(SUM(PlayDuration), 0)'
        : 'COUNT(*)';

      const query = `
        SELECT date(DateCreated) as Day, ${aggregateExpr} as Plays
        FROM PlaybackActivity
        WHERE date(DateCreated) >= date('${escapeSqlLiteral(range.startDate)}')
          AND date(DateCreated) <= date('${escapeSqlLiteral(range.endDate)}')
          AND UserId = '${escapeSqlLiteral(userId)}'
        GROUP BY date(DateCreated)
        ORDER BY date(DateCreated) ASC
      `;

      const [result, users] = await Promise.all([
        client.submitCustomQuery(query).catch(() => null),
        client.getUsers().catch(() => []),
      ]);

      if (!result || !Array.isArray(result.results)) {
        return NextResponse.json({ data: [], pluginAvailable: false });
      }

      const userUsage: Record<string, number> = {};
      for (const row of result.results) {
        if (!Array.isArray(row)) continue;
        const day = String(row[0] ?? '');
        const count = Number.parseFloat(String(row[1] ?? '0'));
        if (day) userUsage[day] = Number.isFinite(count) ? count : 0;
      }

      const userName = users.find((u) => u.Id === userId)?.Name || userId;
      return NextResponse.json({
        data: [{ user_id: userId, user_name: userName, user_usage: userUsage }],
        pluginAvailable: true,
      });
    }

    // filter is required — resolve from type_filter_list if not provided
    let filter = searchParams.get('filter');
    if (!filter) {
      const types = await client.getTypeFilterList();
      filter = types ? types.join(',') : 'Movie,Episode,Audio';
    }

    const data = await client.getPlayActivity(days, endDate, filter, dataType);
    return NextResponse.json({ data: data ?? [], pluginAvailable: data !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch play activity';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
