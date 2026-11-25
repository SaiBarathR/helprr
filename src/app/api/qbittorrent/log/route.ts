import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';
import { QBIT_LOG_LEVELS, type QbitLogLevel } from '@/lib/qbittorrent-log';
import { toQbitLogPage } from '@/lib/server/qbittorrent-log';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const LEVELS: ReadonlySet<string> = new Set(QBIT_LOG_LEVELS);

// qBittorrent's main log (QBT-24), newest first, a page at a time. Admins only:
// its lines name file paths and torrents, and are redacted of IP addresses,
// URL paths, credentials and magnets before they leave (toQbitLogPage).
async function getHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const params = request.nextUrl.searchParams;

  const levelsParam = params.get('levels');
  const levels = levelsParam === null ? [...QBIT_LOG_LEVELS] : levelsParam.split(',').filter(Boolean);
  if (levels.length === 0 || levels.some((level) => !LEVELS.has(level))) {
    return NextResponse.json({ error: `levels must name some of ${QBIT_LOG_LEVELS.join(', ')}` }, { status: 400 });
  }
  const beforeParam = params.get('before');
  const before = beforeParam === null ? null : Number(beforeParam);
  if (before !== null && (!/^\d{1,10}$/.test(beforeParam!) || !Number.isSafeInteger(before))) {
    return NextResponse.json({ error: 'before must be an entry id' }, { status: 400 });
  }

  try {
    const client = await getQBittorrentClient(instance.instanceId);
    const wanted = (level: QbitLogLevel) => levels.includes(level);
    const raw = await client.getMainLog({
      normal: wanted('normal'),
      info: wanted('info'),
      warning: wanted('warning'),
      critical: wanted('critical'),
    });
    return NextResponse.json(toQbitLogPage(raw, before), { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch the qBittorrent log');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/log');
