import { getSeerrClient } from '@/lib/service-helpers';
import { getCachedSeerrMediaDetail } from '@/lib/seerr-helpers';
import { tmdbImageUrl } from '@/lib/discover';
import { can } from '@/lib/permissions';
import { matchLocalQuery } from '@/lib/search/providers/local-module';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

export const searchRequests: ProviderHandler = async ({ user, query, limit }) => {
  let requestedBy: number | undefined;
  if (can(user, 'requests.approve')) {
    requestedBy = undefined;
  } else {
    const own = user.seerrUserId ? Number.parseInt(user.seerrUserId, 10) : NaN;
    if (!Number.isInteger(own)) return { results: [] };
    requestedBy = own;
  }

  const client = await getSeerrClient();
  const data = await client.listRequests({
    take: 200,
    skip: 0,
    filter: 'all',
    sort: 'modified',
    sortDirection: 'desc',
    requestedBy,
  });

  const cheapMatches = data.results.filter((req) =>
    matchLocalQuery(query, req.type, String(req.status), tmdbIdLabel(req.media?.tmdbId))
  );

  const enriched = await Promise.all(
    cheapMatches.map(async (req) => {
      const tmdbId = req.media?.tmdbId;
      if (!tmdbId) {
        return { req, title: null as string | null, year: null as number | null, poster: null as string | null };
      }
      const detail = await getCachedSeerrMediaDetail(client, req.type, tmdbId).catch(() => null);
      const dateStr = req.type === 'movie' ? detail?.releaseDate : detail?.firstAirDate;
      const year = dateStr ? Number.parseInt(dateStr.slice(0, 4), 10) || null : null;
      return {
        req,
        title: detail?.title ?? detail?.name ?? null,
        year,
        poster: tmdbImageUrl(detail?.posterPath ?? null, 'w300'),
      };
    })
  );

  const results: SearchProviderResult[] = enriched
    .filter(({ req, title }) =>
      matchLocalQuery(query, title, req.type, String(req.status), tmdbIdLabel(req.media?.tmdbId))
    )
    .slice(0, limit)
    .map(({ req, title, year, poster }) => ({
      id: `request:${req.id}`,
      title: title ?? `Request #${req.id}`,
      subtitle: [req.type === 'movie' ? 'Movie' : 'TV', requestStatusLabel(req.status)].join(' · '),
      year,
      poster,
      posterService: poster ? 'tmdb' : undefined,
      route: '/requests',
      provider: 'requests',
      badge: requestStatusLabel(req.status),
    }));

  return { results };
};

function tmdbIdLabel(id: number | undefined): string | undefined {
  return id ? String(id) : undefined;
}

function requestStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return 'Pending';
    case 2:
      return 'Approved';
    case 3:
      return 'Declined';
    case 4:
      return 'Available';
    case 5:
      return 'Processing';
    default:
      return 'Unknown';
  }
}
