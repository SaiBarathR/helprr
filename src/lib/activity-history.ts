import type { HistoryItem, HistoryResponse } from '@/types';

export type ActivityHistorySource = 'sonarr' | 'radarr' | 'lidarr';
export type ActivityHistoryRecord = HistoryItem & {
  source: ActivityHistorySource;
  instanceId: string;
  instanceLabel: string;
};

export interface ActivityHistorySourceDescriptor {
  source: ActivityHistorySource;
  instanceId: string;
  instanceLabel: string;
  fetchPage: (page: number, pageSize: number) => Promise<HistoryResponse>;
  localFilter?: (record: HistoryItem) => boolean;
}

export interface ActivityHistorySourceResult {
  source: ActivityHistorySource;
  records: ActivityHistoryRecord[];
  totalRecords: number;
  totalRecordsExact: boolean;
  hasMore: boolean;
  truncated: boolean;
}

export const ACTIVITY_HISTORY_MAX_WINDOW = 5_000;
export const ACTIVITY_HISTORY_SOURCE_CONCURRENCY = 6;
const LOCAL_FILTER_PAGE_SIZE = 100;

function normalizeTotal(value: number, recordsLength: number): number {
  return Number.isFinite(value) && value >= recordsLength
    ? Math.floor(value)
    : recordsLength;
}

function tagRecords(
  descriptor: ActivityHistorySourceDescriptor,
  records: HistoryItem[],
): ActivityHistoryRecord[] {
  return records.map((record) => ({
    ...record,
    source: descriptor.source,
    instanceId: descriptor.instanceId,
    instanceLabel: descriptor.instanceLabel,
  }));
}

export async function fetchActivityHistorySource(
  descriptor: ActivityHistorySourceDescriptor,
  endIndex: number,
): Promise<ActivityHistorySourceResult> {
  if (!descriptor.localFilter) {
    const response = await descriptor.fetchPage(1, endIndex);
    const records = response.records.slice(0, endIndex);
    const totalRecords = normalizeTotal(response.totalRecords, records.length);
    return {
      source: descriptor.source,
      records: tagRecords(descriptor, records),
      totalRecords,
      totalRecordsExact: true,
      hasMore: totalRecords > records.length,
      truncated: false,
    };
  }

  const matches: HistoryItem[] = [];
  let page = 1;
  let scanned = 0;
  let upstreamTotal = 0;
  let sourceExhausted = false;

  while (matches.length < endIndex && scanned < ACTIVITY_HISTORY_MAX_WINDOW) {
    const pageSize = Math.min(
      LOCAL_FILTER_PAGE_SIZE,
      ACTIVITY_HISTORY_MAX_WINDOW - scanned,
    );
    const response = await descriptor.fetchPage(page, pageSize);
    upstreamTotal = normalizeTotal(response.totalRecords, response.records.length);
    scanned += response.records.length;
    matches.push(...response.records.filter(descriptor.localFilter));

    if (response.records.length === 0) {
      sourceExhausted = true;
      break;
    }
    if (scanned >= upstreamTotal) break;
    page += 1;
  }

  const totalRecordsExact = scanned >= upstreamTotal;
  const scanLimitReached =
    scanned >= ACTIVITY_HISTORY_MAX_WINDOW && !totalRecordsExact;
  return {
    source: descriptor.source,
    records: tagRecords(descriptor, matches.slice(0, endIndex)),
    totalRecords: matches.length,
    totalRecordsExact,
    hasMore:
      matches.length > endIndex
      || (!totalRecordsExact && !scanLimitReached && !sourceExhausted),
    truncated: scanLimitReached,
  };
}

export async function mapSettledWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run),
  );
  return results;
}

export function mergeActivityHistory(
  sources: readonly ActivityHistoryRecord[][],
  endIndex: number,
  sortDirection: 'ascending' | 'descending',
): ActivityHistoryRecord[] {
  return sources
    .flat()
    .sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return sortDirection === 'descending' ? dateB - dateA : dateA - dateB;
    })
    .slice(0, endIndex);
}
