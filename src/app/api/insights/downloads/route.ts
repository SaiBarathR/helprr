import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { getLocalDateKey } from '@/lib/timezone';
import {
  categorizeHistoryEvent,
  eachDayKey,
  normalizeDateKey,
  shiftDayKey,
  type DownloadCategory,
} from '@/lib/insights';
import type { HistoryResponse } from '@/types';
import { withApiLogging } from '@/lib/api-logger';

// Bounded pagination: walk newest→oldest until we pass the window's start or hit
// the page cap. arr history has no date-range filter, so for a window whose `to`
// is in the past we must page through the newer records first; the cap is sized
// to cover a typical home server's full history (~5k events). Beyond it, the
// oldest buckets may undercount — acceptable for v1.
const PAGE_SIZE = 250;
const MAX_PAGES = 20;

interface HistoryClient {
  getHistory: (
    page: number,
    pageSize: number,
    sortKey: string,
    sortDirection: string
  ) => Promise<HistoryResponse>;
}

// Pull every in-range history record's (dayKey, category) from one instance.
async function collectEvents(
  client: HistoryClient,
  from: string,
  to: string,
  tz: string
): Promise<Array<{ day: string; cat: DownloadCategory }>> {
  const out: Array<{ day: string; cat: DownloadCategory }> = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: HistoryResponse;
    try {
      res = await client.getHistory(page, PAGE_SIZE, 'date', 'descending');
    } catch {
      break;
    }
    const records = res.records ?? [];
    if (records.length === 0) break;

    for (const rec of records) {
      const day = getLocalDateKey(rec.date, tz);
      if (!day || day < from || day > to) continue;
      const cat = categorizeHistoryEvent(rec.eventType);
      if (cat) out.push({ day, cat });
    }

    const oldest = getLocalDateKey(records[records.length - 1].date, tz);
    if (oldest && oldest < from) break;
    if (records.length < PAGE_SIZE) break;
  }
  return out;
}

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const settings = await getOrCreateAppSettings();
  const tz = settings.timeZone;
  const todayKey = getLocalDateKey(new Date(), tz);

  const { searchParams } = new URL(request.url);
  const to = normalizeDateKey(searchParams.get('to')) ?? todayKey;
  const from = normalizeDateKey(searchParams.get('from')) ?? shiftDayKey(to, -29);
  const days = eachDayKey(from, to);

  // Gather clients across the services the user may view.
  const clients: HistoryClient[] = [];
  if (can(user, 'series.view')) clients.push(...(await getSonarrClients().catch(() => [])).map((i) => i.client));
  if (can(user, 'movies.view')) clients.push(...(await getRadarrClients().catch(() => [])).map((i) => i.client));
  if (can(user, 'music.view')) clients.push(...(await getLidarrClients().catch(() => [])).map((i) => i.client));

  const events = (await Promise.all(clients.map((c) => collectEvents(c, from, to, tz)))).flat();

  const byDay = new Map<string, { grabbed: number; imported: number; failed: number }>();
  for (const day of days) byDay.set(day, { grabbed: 0, imported: 0, failed: 0 });
  let grabbed = 0;
  let imported = 0;
  let failed = 0;
  for (const { day, cat } of events) {
    const bucket = byDay.get(day);
    if (!bucket) continue;
    bucket[cat] += 1;
    if (cat === 'grabbed') grabbed += 1;
    else if (cat === 'imported') imported += 1;
    else failed += 1;
  }

  const perDay = days.map((day) => ({ date: day, ...byDay.get(day)! }));
  const resolved = imported + failed;
  const successRate = resolved > 0 ? Math.round((imported / resolved) * 100) : null;

  return NextResponse.json({
    from,
    to,
    perDay,
    totals: { grabbed, imported, failed },
    successRate,
  });
}

export const GET = withApiLogging(getHandler, 'api/insights/downloads');
