import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { SEARCH_PROVIDER_BY_ID } from '@/lib/search/provider-defs';
import { getProviderHandler } from '@/lib/search/providers/registry';
import { withTimeout } from '@/lib/search/with-timeout';
import type { SearchProviderId, SearchProviderResponse } from '@/lib/search/types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const PROVIDER_TIMEOUT_MS = 8_000;

const VALID_PROVIDERS = new Set<string>(Object.keys(SEARCH_PROVIDER_BY_ID));

function isSearchProviderId(value: string): value is SearchProviderId {
  return VALID_PROVIDERS.has(value);
}

async function checkProviderConfig(def: (typeof SEARCH_PROVIDER_BY_ID)[SearchProviderId]): Promise<string | null> {
  if (def.requiresTmdb) {
    const count = await prisma.serviceConnection.count({ where: { type: 'TMDB' } });
    if (count === 0) return 'TMDB is not configured';
  }
  if (def.requiresSeerr) {
    const count = await prisma.serviceConnection.count({ where: { type: 'SEERR' } });
    if (count === 0) return 'Seerr is not configured';
  }
  return null;
}

async function getHandler(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { provider: rawProvider } = await context.params;
  if (!isSearchProviderId(rawProvider)) {
    return NextResponse.json({ error: 'Unknown search provider' }, { status: 404 });
  }

  const def = SEARCH_PROVIDER_BY_ID[rawProvider];
  if (!can(auth.user, def.capability)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const configError = await checkProviderConfig(def);
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 503 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < def.minQuery) {
    const empty: SearchProviderResponse = {
      results: [],
      searched: [],
      degraded: [],
      meta: { scopeLabel: def.label, cost: def.cost, remote: def.cost === 'remote' },
    };
    return NextResponse.json(empty);
  }

  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const handler = getProviderHandler(rawProvider);
  const outcome = await withTimeout(
    handler({ user: auth.user, query: q, limit }),
    PROVIDER_TIMEOUT_MS,
    null
  );

  if (!outcome) {
    const body: SearchProviderResponse = {
      results: [],
      searched: [],
      degraded: [rawProvider],
      meta: { scopeLabel: def.label, cost: def.cost, remote: def.cost === 'remote' },
    };
    return NextResponse.json(body);
  }

  const body: SearchProviderResponse = {
    results: outcome.results,
    searched: outcome.rateLimited ? [] : [rawProvider],
    degraded: outcome.rateLimited ? [rawProvider] : [],
    rateLimited: outcome.rateLimited,
    meta: { scopeLabel: def.label, cost: def.cost, remote: def.cost === 'remote' },
  };

  return NextResponse.json(body);
}

export const GET = withApiLogging(getHandler, 'api/search/providers/[provider]');
