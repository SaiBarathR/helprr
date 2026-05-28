import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getTMDBClient } from '@/lib/service-helpers';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import { withApiLogging } from '@/lib/api-logger';

/**
 * Returns the list of TMDB watch-provider regions sorted by English name.
 *
 * Lightweight companion to /api/discover/filters — the filters route fans out
 * to many TMDB endpoints (genres, providers, popular TV, networks) which is
 * wasteful when all we want for the settings page is the region list. TMDB
 * caches this response under TMDB_CACHE_STATIC_TTL_SECONDS, so repeat loads
 * are effectively free.
 */
async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const tmdb = await getTMDBClient();
    const regions = await tmdb.watchProviderRegions();
    const formatted = regions
      .filter((r) => r.iso_3166_1 && r.english_name)
      .map((r) => ({ code: r.iso_3166_1, name: r.english_name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ regions: formatted });
  } catch (error) {
    if (error instanceof TmdbRateLimitError) {
      return NextResponse.json(
        {
          error: 'TMDB rate limit reached',
          code: 'TMDB_RATE_LIMIT',
          retryAfterSeconds: error.retryAfterSeconds,
          retryAt: error.retryAt,
        },
        { status: 429 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to load regions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/settings/watch-provider-regions');
