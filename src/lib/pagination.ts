// Shared server-side pagination helpers. Two shapes are used across the app:
//   - page/pageSize  → page-control clients (notifications, cleanup history/strikes)
//   - skip/take      → infinite-scroll clients (seerr requests/pending-requests)
// Both clamp to sane bounds so a hand-crafted query string can't ask for an
// unbounded page. No `take` cap is applied to the *dataset* — callers page
// through everything; the cap is only on a single request's page size.

/**
 * Parse a query-string integer, clamped to [min, max]. Returns undefined for
 * missing/non-numeric input so callers can apply their own default.
 * (Generalized from the local copy that lived in api/seerr/requests/route.ts.)
 */
export function parseInt32(
  value: string | null,
  opts?: { min?: number; max?: number }
): number | undefined {
  if (!value) return undefined;
  const n = Math.trunc(Number.parseInt(value, 10));
  if (!Number.isFinite(n)) return undefined;
  const min = opts?.min ?? 0;
  const max = opts?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(n, min), max);
}

// Hard cap on the row offset a single request may ask for, so a hand-crafted
// `?page=` / `?skip=` can't force a pathological deep-offset scan.
const MAX_SKIP = 100_000;

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/**
 * page/pageSize for prev/next page-control clients. Mirrors the validation in
 * api/cleanup/history (page>=1, pageSize clamped to [1, maxSize]).
 */
export function parsePageParams(
  sp: URLSearchParams,
  opts?: { defaultSize?: number; maxSize?: number }
): PageParams {
  const defaultSize = opts?.defaultSize ?? 30;
  const maxSize = opts?.maxSize ?? 100;
  const pageSize = parseInt32(sp.get('pageSize'), { min: 1, max: maxSize }) ?? defaultSize;
  const maxPage = Math.max(1, Math.floor(MAX_SKIP / pageSize));
  const page = parseInt32(sp.get('page'), { min: 1, max: maxPage }) ?? 1;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * skip/take for infinite-scroll clients that send a raw cursor offset.
 */
export function parseSkipTake(
  sp: URLSearchParams,
  opts?: { defaultTake?: number; maxTake?: number }
): { skip: number; take: number } {
  const defaultTake = opts?.defaultTake ?? 50;
  const maxTake = opts?.maxTake ?? 100;
  const take = parseInt32(sp.get('take'), { min: 1, max: maxTake }) ?? defaultTake;
  const skip = parseInt32(sp.get('skip'), { min: 0, max: MAX_SKIP }) ?? 0;
  return { skip, take };
}

export interface PageInfo {
  page: number;
  pages: number;
  pageSize: number;
  results: number;
}

/**
 * The `{page, pages, pageSize, results}` envelope the infinite-scroll hook and
 * requests-list-widget already read. `page` is derived from skip/pageSize.
 */
export function buildPageInfo(total: number, skip: number, pageSize: number): PageInfo {
  const size = Math.max(1, pageSize);
  return {
    page: Math.floor(skip / size) + 1,
    pages: Math.ceil(total / size),
    pageSize: size,
    results: total,
  };
}
