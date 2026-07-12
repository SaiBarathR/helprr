import { describe, it, expect } from 'vitest';
import { fetchFullQueue, QUEUE_PAGE_SIZE, MAX_QUEUE_PAGES } from '@/lib/cleanup/queue-pagination';

function makeQueue(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i + 1);
}

function pagedFetcher(items: number[], reportedTotal = items.length) {
  const calls: number[] = [];
  const fetchPage = (page: number, pageSize: number) => {
    calls.push(page);
    const start = (page - 1) * pageSize;
    return Promise.resolve({
      records: items.slice(start, start + pageSize),
      totalRecords: reportedTotal,
    });
  };
  return { fetchPage, calls };
}

describe('fetchFullQueue', () => {
  it('returns a small queue in one request', async () => {
    const { fetchPage, calls } = pagedFetcher(makeQueue(42));
    const result = await fetchFullQueue(fetchPage);
    expect(result).toHaveLength(42);
    expect(calls).toEqual([1]);
  });

  it('paginates past the per-request cap until complete (the old 1,000 truncation)', async () => {
    const { fetchPage, calls } = pagedFetcher(makeQueue(2500));
    const result = await fetchFullQueue(fetchPage);
    expect(result).toHaveLength(2500);
    expect(calls).toEqual([1, 2, 3]);
  });

  it('handles an exact page-size boundary without an extra request loop', async () => {
    const { fetchPage } = pagedFetcher(makeQueue(QUEUE_PAGE_SIZE));
    const result = await fetchFullQueue(fetchPage);
    expect(result).toHaveLength(QUEUE_PAGE_SIZE);
  });

  it('falls back to a short page as the end signal when totalRecords is missing', async () => {
    const items = makeQueue(1500);
    const fetchPage = (page: number, pageSize: number) =>
      Promise.resolve({ records: items.slice((page - 1) * pageSize, page * pageSize) });
    const result = await fetchFullQueue(fetchPage);
    expect(result).toHaveLength(1500);
  });

  it('returns null (fail-safe: skip the instance) when the queue exceeds the bound', async () => {
    const hugeTotal = QUEUE_PAGE_SIZE * MAX_QUEUE_PAGES + 1;
    const fetchPage = (page: number, pageSize: number) =>
      Promise.resolve({ records: makeQueue(pageSize), totalRecords: hugeTotal });
    const result = await fetchFullQueue(fetchPage);
    expect(result).toBeNull();
  });

  it('treats an empty queue as complete', async () => {
    const { fetchPage } = pagedFetcher([]);
    const result = await fetchFullQueue(fetchPage);
    expect(result).toEqual([]);
  });
});
