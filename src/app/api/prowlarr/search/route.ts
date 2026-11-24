import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { issueReleaseTokens, PROWLARR_SCOPE } from '@/lib/release-tokens';
import { redactProwlarrText } from '@/lib/prowlarr-redact';
import type { ProwlarrRelease } from '@/lib/prowlarr-client';
import {
  keepTopForEverySort,
  PROWLARR_SEARCH_ID_FIELDS,
  PROWLARR_SEARCH_ID_LABELS,
  PROWLARR_SEARCH_ID_TOKENS,
  PROWLARR_SEARCH_TYPES,
  type ProwlarrSearchIdField,
  type ProwlarrSearchType,
} from '@/lib/prowlarr-search';

const MAX_QUERY_LENGTH = 200;
const ALLOWED_CATEGORIES = new Set([2000, 3000, 5000, 7000]);
const SEARCH_TYPES = new Set<string>(PROWLARR_SEARCH_TYPES.map(({ id }) => id));
const MAX_INDEXER_IDS = 100;
const WHOLE_ID = /^\d{1,10}$/;
const ID_PATTERNS: Record<ProwlarrSearchIdField, RegExp> = {
  tvdbId: WHOLE_ID,
  tmdbId: WHOLE_ID,
  imdbId: /^tt\d{1,10}$/,
  season: /^\d{1,4}$/,
  episode: /^\d{1,4}$/,
};
const ALL_ID_FIELDS = Object.keys(ID_PATTERNS) as ProwlarrSearchIdField[];

export interface ProwlarrSearchResult {
  id: string;
  title: string;
  size: number;
  seeders: number | null;
  leechers: number | null;
  publishDate: string | null;
  indexer: string;
  protocol: string;
}

export interface ProwlarrSearchResponse {
  results: ProwlarrSearchResult[];
  /** Every release found, before the cut to the best rows of each sort. */
  total: number;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/** Whole numbers Prowlarr reads as an int (an id over 2^31 - 1 would not parse there). */
function isIntId(value: string): boolean {
  return WHOLE_ID.test(value) && Number(value) <= 2_147_483_647;
}

/**
 * Search every indexer, or the ones picked. A search hits private trackers too,
 * so it needs prowlarr.manage, not view. Only display fields leave the server:
 * a release's guid, download, magnet and info links can all carry a passkey or
 * Prowlarr's own key, so the browser gets a token in place of the guid.
 *
 * A typed search (TV, movie) can name ids, which go to Prowlarr as its query
 * tokens (`{TvdbId:…}`). Every value is checked here first, and the free text
 * may hold no braces, so the only tokens sent are the checked ones.
 */
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const text = (params.get('q') ?? '').trim();
  const type = (params.get('type') ?? 'search') as ProwlarrSearchType;
  if (!SEARCH_TYPES.has(type)) return bad('Unknown search type');

  const ids: Partial<Record<ProwlarrSearchIdField, string>> = {};
  for (const field of ALL_ID_FIELDS) {
    const value = (params.get(field) ?? '').trim();
    if (!value) continue;
    const label = PROWLARR_SEARCH_ID_LABELS[field];
    if (!PROWLARR_SEARCH_ID_FIELDS[type].includes(field)) return bad(`This search type takes no ${label}`);
    if (!ID_PATTERNS[field].test(value) || (field !== 'imdbId' && !isIntId(value))) return bad(`Check the ${label}`);
    ids[field] = value;
  }
  if (ids.episode && !ids.season) return bad('An episode needs a season');
  const hasId = Boolean(ids.tvdbId || ids.imdbId || ids.tmdbId);

  if (text.length > MAX_QUERY_LENGTH || (text.length < 2 && !hasId)) {
    return bad(`Search for 2 to ${MAX_QUERY_LENGTH} characters, or an ID`);
  }
  if (type !== 'search' && /[{}]/.test(text)) return bad('Use the ID fields instead of braces');
  // No spaces between the tokens: Prowlarr cuts each out of the query and
  // trims only the ends, so an ID-only query leaves no stray text.
  const query = text + ALL_ID_FIELDS
    .filter((field) => ids[field])
    .map((field) => `{${PROWLARR_SEARCH_ID_TOKENS[field]}:${ids[field]}}`)
    .join('');

  const categories = (params.get('categories') ?? '').split(',').filter(Boolean).map(Number);
  if (!categories.every((category) => ALLOWED_CATEGORIES.has(category))) {
    return bad('Unknown category');
  }

  const rawIndexerIds = (params.get('indexerIds') ?? '').split(',').filter(Boolean);
  if (rawIndexerIds.length > MAX_INDEXER_IDS || !rawIndexerIds.every(isIntId)) return bad('Unknown indexer');
  const indexerIds = [...new Set(rawIndexerIds.map(Number))];

  try {
    const client = await getProwlarrClient();
    if (indexerIds.length > 0) {
      // Prowlarr skips an id it doesn't know, so a stale pick would search
      // nothing, or with every id gone, every indexer. Refuse it instead.
      const enabled = new Set((await client.getIndexers()).filter((indexer) => indexer.enable).map(({ id }) => id));
      if (!indexerIds.every((id) => enabled.has(id))) {
        return bad('An indexer you picked is gone or disabled. Pick again.');
      }
    }
    const found = await client.searchReleases({ query, type, categories, indexerIds }, request.signal);
    const valid = (Array.isArray(found) ? found : [])
      .filter((release): release is ProwlarrRelease => Boolean(release?.guid && release.title && release.indexerId));
    const releases = keepTopForEverySort(valid);
    const tokens = await issueReleaseTokens(
      PROWLARR_SCOPE,
      auth.user.id,
      releases.map(({ guid, indexerId }) => ({ guid, indexerId })),
    );
    const results: ProwlarrSearchResult[] = releases.map((release, index) => ({
      id: tokens[index],
      title: redactProwlarrText(release.title),
      size: release.size ?? 0,
      seeders: release.seeders ?? null,
      leechers: release.leechers ?? null,
      publishDate: release.publishDate ?? null,
      indexer: redactProwlarrText(release.indexer ?? ''),
      protocol: release.protocol ?? '',
    }));
    return NextResponse.json({ results, total: valid.length } satisfies ProwlarrSearchResponse);
  } catch (error) {
    if (isAxiosError(error) && error.code === 'ERR_CANCELED') return new NextResponse(null, { status: 499 });
    return upstreamErrorResponse(error, 'Search failed');
  }
}

// A search can be for a pasted URL with a key in it.
export const GET = withApiLogging(getHandler, 'api/prowlarr/search', { redactQueryParams: ['q'] });
