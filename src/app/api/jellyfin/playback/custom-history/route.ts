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
const USER_ID_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const ALLOWED_TYPES = ['Movie', 'Episode', 'Audio', 'MusicVideo', 'Book'];

function escapeSQL(val: string): string {
  return val.replace(/'/g, "''");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const userId = searchParams.get('userId');
    const type = searchParams.get('type');
    const rawLimit = searchParams.get('limit');
    const parsedLimit = rawLimit === null ? Number.NaN : parseInt(rawLimit, 10);
    const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
    }

    if (from > to) {
      return NextResponse.json({ error: "'from' must be on or before 'to' (YYYY-MM-DD)" }, { status: 400 });
    }

    if (userId && !USER_ID_RE.test(userId)) {
      return NextResponse.json({ error: 'userId must be a valid Jellyfin user ID' }, { status: 400 });
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

    if (
      !countResult
      || !dataResult
      || !Array.isArray(countResult.results)
      || !Array.isArray(dataResult.results)
    ) {
      return NextResponse.json({ items: [], total: 0, pluginAvailable: false });
    }

    const countRow = Array.isArray(countResult.results[0]) ? countResult.results[0] : [];
    const total = parseInt(String(countRow[0] ?? '0'), 10) || 0;

    const items = dataResult.results
      .filter((row): row is string[] => Array.isArray(row))
      .map((row) => ({
        RowId: parseInt(String(row[0] ?? '0'), 10) || 0,
        DateCreated: String(row[1] ?? ''),
        UserId: String(row[2] ?? ''),
        ItemId: String(row[3] ?? ''),
        ItemType: String(row[4] ?? ''),
        ItemName: String(row[5] ?? ''),
        PlaybackMethod: String(row[6] ?? ''),
        ClientName: String(row[7] ?? ''),
        DeviceName: String(row[8] ?? ''),
        PlayDuration: parseInt(String(row[9] ?? '0'), 10) || 0,
      }));

    return NextResponse.json({ items, total, limit, offset, pluginAvailable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
