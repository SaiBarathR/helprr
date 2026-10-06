export const QUEUE_PAGE_SIZE = 1000;
// 20 pages = 20k items — far beyond any plausible real queue. Hitting this
// means something is wrong (or the instance is absurdly large); cleaning
// against a partial queue view would silently exempt the truncated tail from
// rules and strike handling, so the caller must skip the instance instead.
export const MAX_QUEUE_PAGES = 20;

/**
 * Fetch a complete *arr queue by paginating past the per-request cap.
 * Returns null when the queue could not be read completely — MAX_QUEUE_PAGES
 * exceeded, a response with no records array, or a short page that leaves the
 * arr's own reported total unmet. The caller must then skip the instance for
 * the cycle rather than clean against a partial view.
 */
export async function fetchFullQueue<R>(
  fetchPage: (page: number, pageSize: number) => Promise<{ records?: R[]; totalRecords?: number }>
): Promise<R[] | null> {
  const all: R[] = [];
  for (let page = 1; page <= MAX_QUEUE_PAGES; page++) {
    const r = await fetchPage(page, QUEUE_PAGE_SIZE);
    // No records array means this is not a paged *arr response at all (an
    // error body, a proxy's login page) — unreadable, not an empty queue.
    const records = r.records;
    if (!Array.isArray(records)) return null;
    all.push(...records);
    // Without a usable totalRecords, a short page is the only end signal — a
    // full page must always fetch the next one.
    const total = typeof r.totalRecords === 'number' && Number.isFinite(r.totalRecords)
      ? r.totalRecords
      : null;
    if (total !== null && all.length >= total) return all;
    // A short page that still leaves the reported total unmet is a truncated
    // read (e.g. a server-side page-size cap), not the end of the queue.
    if (records.length < QUEUE_PAGE_SIZE) return total === null ? all : null;
  }
  return null;
}
