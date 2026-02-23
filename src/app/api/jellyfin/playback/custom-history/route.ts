import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

/**
 * Efficient history endpoint using submit_custom_query against PlaybackActivity table.
 * Single API call with date range, user/type filters, and pagination.
 *
 * Query params:
 *   from     - Start date YYYY-MM-DD (required)
 *   to       - End date YYYY-MM-DD (required)
 *   userId   - Filter by user ID (optional)
 *   type     - Filter by item type e.g. Movie, Episode (optional)
 *   limit    - Page size, default 50 (optional)
 *   offset   - Offset for pagination, default 0 (optional)
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_TYPES = ['Movie', 'Episode', 'Audio', 'MusicVideo', 'Book'];

function escapeSQL(val: string): string {
  return val.replace(/'/g, "''");
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const userId = searchParams.get('userId');
    const type = searchParams.get('type');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
    }

    if (type && !ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 });
    }

    // Build WHERE clauses
    const conditions: string[] = [
      `date(DateCreated) >= date('${escapeSQL(from)}')`,
      `date(DateCreated) <= date('${escapeSQL(to)}')`,
    ];
    if (userId) conditions.push(`UserId = '${escapeSQL(userId)}'`);
    if (type) conditions.push(`ItemType = '${escapeSQL(type)}'`);

    const where = conditions.join(' AND ');

    const client = await getJellyfinClient();

    // Run count + data queries in parallel
    const [countResult, dataResult] = await Promise.all([
      client.submitCustomQuery(`SELECT COUNT(*) as total FROM PlaybackActivity WHERE ${where}`),
      client.submitCustomQuery(
        `SELECT rowid, DateCreated, UserId, ItemId, ItemType, ItemName, PlaybackMethod, ClientName, DeviceName, PlayDuration FROM PlaybackActivity WHERE ${where} ORDER BY rowid DESC LIMIT ${limit} OFFSET ${offset}`
      ),
    ]);

    if (!countResult || !dataResult) {
      return NextResponse.json({ items: [], total: 0, pluginAvailable: false });
    }

    const total = parseInt(countResult.results[0]?.[0] || '0', 10);

    const items = dataResult.results.map((row) => ({
      RowId: parseInt(row[0], 10),
      DateCreated: row[1],
      UserId: row[2],
      ItemId: row[3],
      ItemType: row[4],
      ItemName: row[5],
      PlaybackMethod: row[6],
      ClientName: row[7],
      DeviceName: row[8],
      PlayDuration: parseInt(row[9], 10) || 0,
    }));

    return NextResponse.json({ items, total, limit, offset, pluginAvailable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
