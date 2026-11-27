import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { ProwlarrStatsParams } from '@/lib/prowlarr-client';

// What the Stats tab, the stats widget and Insights send: a UTC ISO time.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PROTOCOLS = new Set(['torrent', 'usenet']);
const MAX_IDS = 200;

/** A UTC ISO time as Helprr writes it, not as the caller spelled it; null when it is not one. */
function isoUtc(value: string): string | null {
  const time = ISO_UTC.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** A comma-separated list of positive whole numbers, deduplicated; null when any entry is not one. */
function idList(value: string): number[] | null {
  const parts = value.split(',');
  if (parts.length > MAX_IDS || !parts.every((part) => /^\d{1,10}$/.test(part))) return null;
  const ids = parts.map(Number);
  if (!ids.every((id) => id > 0 && id <= 2_147_483_647)) return null;
  return [...new Set(ids)];
}

/**
 * The filters Prowlarr's indexerstats takes, each checked here: Prowlarr parses
 * them loosely (an unknown protocol counts as no protocol, an unknown tag fails
 * the whole request), so nothing is passed on as the caller wrote it.
 */
function parseStatsParams(searchParams: URLSearchParams): ProwlarrStatsParams | string {
  const params: ProwlarrStatsParams = {};
  for (const key of ['startDate', 'endDate'] as const) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = isoUtc(raw);
    if (!value) return `${key} must be an ISO date and time in UTC`;
    params[key] = value;
  }
  const indexers = searchParams.get('indexers');
  if (indexers !== null) {
    const ids = idList(indexers);
    if (!ids) return `indexers must list 1 to ${MAX_IDS} indexer ids`;
    params.indexers = ids.join(',');
  }
  const tags = searchParams.get('tags');
  if (tags !== null) {
    const ids = idList(tags);
    if (!ids) return `tags must list 1 to ${MAX_IDS} tag ids`;
    params.tags = ids.join(',');
  }
  const protocols = searchParams.get('protocols');
  if (protocols !== null) {
    const list = [...new Set(protocols.split(','))];
    if (!list.every((protocol) => PROTOCOLS.has(protocol))) return 'protocols must be torrent, usenet or both';
    params.protocols = list.join(',');
  }
  return params;
}

/**
 * Handle GET requests and return indexer statistics from a Prowlarr client.
 *
 * Optional filters: `startDate` and `endDate` (UTC ISO times), `indexers` and
 * `tags` (comma-separated ids) and `protocols` (`torrent`, `usenet`). Anything
 * malformed, or a tag Prowlarr no longer has, is a 400 and Prowlarr is not asked
 * for stats.
 *
 * @param request - Incoming request whose URL may carry the filters above
 * @returns The indexer statistics as a JSON payload on success; on failure, a JSON object `{ error: string }` with HTTP status 500
 */
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  const params = parseStatsParams(new URL(request.url).searchParams);
  if (typeof params === 'string') return NextResponse.json({ error: params }, { status: 400 });

  try {
    const client = await getProwlarrClient();
    if (params.tags) {
      const known = new Set((await client.getTags()).map((tag) => tag.id));
      if (!params.tags.split(',').every((id) => known.has(Number(id)))) {
        return NextResponse.json({ error: 'That tag no longer exists' }, { status: 400 });
      }
    }
    const stats = await client.getIndexerStats(params);
    // Hosts are the addresses that queried Prowlarr (the apps' LAN, or public,
    // IPs): admins only, as peer addresses are. The page then shows no host charts.
    return NextResponse.json(auth.user.role === 'admin' ? stats : { ...stats, hosts: [] });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch indexer stats');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/stats');
