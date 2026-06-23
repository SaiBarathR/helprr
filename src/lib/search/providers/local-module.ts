import { normalizeTitle } from '@/lib/discover';
import { getModuleIndex, getWatchlistDocs } from '@/lib/search/index-builder';
import { mergeAndRank } from '@/lib/search/score';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchModule, SearchProviderResult } from '@/lib/search/types';

function toProviderResults(results: ReturnType<typeof mergeAndRank>, provider: SearchModule): SearchProviderResult[] {
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    year: r.year,
    poster: r.poster,
    posterService: r.posterService,
    route: r.modules[0]?.route ?? '/',
    provider,
    score: r.score,
  }));
}

export function createLocalModuleHandler(module: SearchModule): ProviderHandler {
  return async ({ user, query, limit }) => {
    const docs =
      module === 'watchlist' ? await getWatchlistDocs(user.id) : await getModuleIndex(module);
    const ranked = mergeAndRank({ [module]: docs }, query, limit);
    return { results: toProviderResults(ranked, module) };
  };
}

/** Simple substring match for service-local lists (torrents, activity, etc.). */
export function matchLocalQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const nq = normalizeTitle(query);
  if (!nq) return false;
  return fields.some((f) => f && normalizeTitle(f).includes(nq));
}

export function matchLocalQueryAny(query: string, haystack: string): boolean {
  const nq = normalizeTitle(query);
  if (!nq) return false;
  return normalizeTitle(haystack).includes(nq);
}
