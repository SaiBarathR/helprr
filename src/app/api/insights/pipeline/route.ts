import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { getLocalDateKey } from '@/lib/timezone';
import {
  categorizeHistoryEvent,
  clampWindowStart,
  normalizeDateKey,
  shiftDayKey,
  type DownloadCategory,
} from '@/lib/insights';
import type { HistoryResponse } from '@/types';
import type { InsightsPipelineResponse } from '@/types/insights';
import { withApiLogging } from '@/lib/api-logger';

// Same bounded newest→oldest walk as /api/insights/downloads — arr history has
// no date filter, so we page until the window's start or the cap.
const PAGE_SIZE = 250;
const MAX_PAGES = 20;
const TOP_N = 8;

interface HistoryClient {
  getHistory: (
    page: number,
    pageSize: number,
    sortKey: string,
    sortDirection: string
  ) => Promise<HistoryResponse>;
}

interface PipelineEvent {
  cat: DownloadCategory;
  ts: number;
  hour: number;
  indexer?: string;
  releaseGroup?: string;
  downloadId?: string;
}

function localHour(date: Date, tz: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(date);
    const parsed = Number.parseInt(h, 10);
    return Number.isFinite(parsed) ? parsed % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

async function collectEvents(
  client: HistoryClient,
  from: string,
  to: string,
  tz: string
): Promise<PipelineEvent[]> {
  const out: PipelineEvent[] = [];
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
      if (!cat) continue;
      const date = new Date(rec.date);
      out.push({
        cat,
        ts: date.getTime(),
        hour: localHour(date, tz),
        indexer: rec.data?.indexer || undefined,
        releaseGroup: rec.data?.releaseGroup || undefined,
        downloadId: rec.data?.downloadId || undefined,
      });
    }

    const oldest = getLocalDateKey(records[records.length - 1].date, tz);
    if (oldest && oldest < from) break;
    if (records.length < PAGE_SIZE) break;
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
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
  let from = normalizeDateKey(searchParams.get('from')) ?? shiftDayKey(to, -29);
  if (from > to) {
    return NextResponse.json({ error: "invalid date range: 'from' must be <= 'to'" }, { status: 400 });
  }
  from = clampWindowStart(from, to);

  const clients: HistoryClient[] = [];
  if (can(user, 'series.view')) clients.push(...(await getSonarrClients().catch(() => [])).map((i) => i.client));
  if (can(user, 'movies.view')) clients.push(...(await getRadarrClients().catch(() => [])).map((i) => i.client));
  if (can(user, 'music.view')) clients.push(...(await getLidarrClients().catch(() => [])).map((i) => i.client));

  const events = (await Promise.all(clients.map((c) => collectEvents(c, from, to, tz)))).flat();

  // Activity by local hour (grabs + imports — the pipeline's heartbeat).
  const hours = new Array<number>(24).fill(0);
  for (const e of events) {
    if (e.cat === 'grabbed' || e.cat === 'imported') hours[e.hour] += 1;
  }

  // Grab→import latency, matched per downloadId (earliest grab → earliest import).
  const grabAt = new Map<string, number>();
  const importAt = new Map<string, number>();
  const grabIndexer = new Map<string, string>();
  const grabGroup = new Map<string, string>();
  for (const e of events) {
    if (!e.downloadId) continue;
    if (e.cat === 'grabbed') {
      const prev = grabAt.get(e.downloadId);
      if (prev === undefined || e.ts < prev) grabAt.set(e.downloadId, e.ts);
      if (e.indexer) grabIndexer.set(e.downloadId, e.indexer);
      if (e.releaseGroup) grabGroup.set(e.downloadId, e.releaseGroup);
    } else if (e.cat === 'imported') {
      const prev = importAt.get(e.downloadId);
      if (prev === undefined || e.ts < prev) importAt.set(e.downloadId, e.ts);
    }
  }
  const latencies: number[] = [];
  for (const [id, g] of grabAt) {
    const imp = importAt.get(id);
    if (imp !== undefined && imp >= g) latencies.push((imp - g) / 60_000);
  }
  latencies.sort((a, b) => a - b);
  const latency =
    latencies.length > 0
      ? {
          medianMins: Math.round(percentile(latencies, 50)),
          p90Mins: Math.round(percentile(latencies, 90)),
          samples: latencies.length,
        }
      : null;

  // Indexer reliability: grabs counted from grab events; failures attributed to
  // the grabbing indexer via downloadId (failure records rarely carry one).
  const indexerStats = new Map<string, { grabs: number; failures: number }>();
  const bump = (name: string, key: 'grabs' | 'failures') => {
    const entry = indexerStats.get(name) ?? { grabs: 0, failures: 0 };
    entry[key] += 1;
    indexerStats.set(name, entry);
  };
  for (const e of events) {
    if (e.cat === 'grabbed' && e.indexer) bump(e.indexer, 'grabs');
    if (e.cat === 'failed') {
      const name = e.indexer ?? (e.downloadId ? grabIndexer.get(e.downloadId) : undefined);
      if (name) bump(name, 'failures');
    }
  }
  const indexers = [...indexerStats.entries()]
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.grabs - a.grabs)
    .slice(0, TOP_N);

  // Release groups actually landing in the library (imports; fall back to the
  // grab's group when the import record omits it).
  const groupCounts = new Map<string, number>();
  for (const e of events) {
    if (e.cat !== 'imported') continue;
    const name = e.releaseGroup ?? (e.downloadId ? grabGroup.get(e.downloadId) : undefined);
    if (!name) continue;
    groupCounts.set(name, (groupCounts.get(name) ?? 0) + 1);
  }
  const releaseGroups = [...groupCounts.entries()]
    .map(([name, imports]) => ({ name, imports }))
    .sort((a, b) => b.imports - a.imports)
    .slice(0, TOP_N);

  const response: InsightsPipelineResponse = { from, to, hours, latency, indexers, releaseGroups };
  return NextResponse.json(response);
}

export const GET = withApiLogging(getHandler, 'api/insights/pipeline');
