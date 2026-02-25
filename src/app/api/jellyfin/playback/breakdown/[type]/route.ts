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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { type } = await params;
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

    const validTypes = ['UserId', 'ItemType', 'PlaybackMethod', 'ClientName', 'DeviceName'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

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

      const columnMap: Record<string, string> = {
        UserId: 'UserId',
        ItemType: 'ItemType',
        PlaybackMethod: 'PlaybackMethod',
        ClientName: 'ClientName',
        DeviceName: 'DeviceName',
      };
      const column = columnMap[type];

      const query = `
        SELECT
          COALESCE(NULLIF(${column}, ''), 'Unknown') as Label,
          COUNT(*) as Plays,
          COALESCE(SUM(PlayDuration), 0) as TotalDuration
        FROM PlaybackActivity
        WHERE date(DateCreated) >= date('${escapeSqlLiteral(range.startDate)}')
          AND date(DateCreated) <= date('${escapeSqlLiteral(range.endDate)}')
          AND UserId = '${escapeSqlLiteral(userId)}'
        GROUP BY Label
        ORDER BY Plays DESC, TotalDuration DESC
      `;

      let result: { columns: string[]; results: string[][] } | null;
      try {
        result = await client.submitCustomQuery(query);
      } catch {
        return NextResponse.json({ entries: [], pluginAvailable: false });
      }

      if (!result || !Array.isArray(result.results)) {
        return NextResponse.json({ entries: [], pluginAvailable: false });
      }

      const entries = result.results
        .filter((row): row is string[] => Array.isArray(row))
        .map((row) => ({
          label: String(row[0] ?? 'Unknown'),
          count: Number.parseFloat(String(row[1] ?? '0')) || 0,
          time: Number.parseFloat(String(row[2] ?? '0')) || 0,
        }))
        .filter((row) => row.label && (row.count > 0 || row.time > 0));

      return NextResponse.json({ entries, pluginAvailable: true });
    }

    const entries = await client.getBreakdownReport(type, days, endDate);
    return NextResponse.json({ entries: entries ?? [], pluginAvailable: entries !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch breakdown report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
