import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { getModuleIndex, getWatchlistDocs } from '@/lib/search/index-builder';
import { mergeAndRank } from '@/lib/search/score';
import { withTimeout } from '@/lib/search/with-timeout';
import {
  SEARCH_MODULE_CAPABILITY,
  SEARCH_MODULE_ORDER,
  type SearchDoc,
  type SearchModule,
  type SearchResponse,
} from '@/lib/search/types';

// Local, instant global search. Searches only what the caller already has/configured
// (no upstream TMDB/AniList calls — that's the future remote tier on a separate route)
// and only the modules their capabilities allow. Library indexes are served from a
// generation-versioned Redis cache, so fast typing scans cache, not the *arr services.

const MIN_QUERY = 2;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// Backstop so a pathologically slow module (e.g. a dead instance during a cold build)
// can't hang the palette. The common warm-cache path returns in a few ms, far under this.
const MODULE_TIMEOUT_MS = 5_000;

const EMPTY: SearchResponse = { results: [], searched: [], degraded: [] };

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < MIN_QUERY) return NextResponse.json(EMPTY);

  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  // Gate purely by existing per-module *.view caps — no dedicated search capability.
  const gated = SEARCH_MODULE_ORDER.filter((m) => can(user, SEARCH_MODULE_CAPABILITY[m]));
  if (gated.length === 0) return NextResponse.json(EMPTY);

  // Fan out the gated module loads concurrently; a slow/failed one is omitted and
  // flagged `degraded` rather than blocking the whole response.
  const loaded = await Promise.all(
    gated.map(async (module): Promise<{ module: SearchModule; docs: SearchDoc[] | null }> => {
      const loader = module === 'watchlist' ? getWatchlistDocs(user.id) : getModuleIndex(module);
      const docs = await withTimeout<SearchDoc[] | null>(loader, MODULE_TIMEOUT_MS, null);
      return { module, docs };
    })
  );

  const searched: SearchModule[] = [];
  const degraded: SearchModule[] = [];
  const docsByModule: Record<string, SearchDoc[]> = {};
  for (const { module, docs } of loaded) {
    if (docs) {
      docsByModule[module] = docs;
      searched.push(module);
    } else {
      degraded.push(module);
    }
  }

  const results = mergeAndRank(docsByModule, q, limit);
  const body: SearchResponse = { results, searched, degraded };
  return NextResponse.json(body);
}

export const GET = withApiLogging(getHandler, 'api/search');
