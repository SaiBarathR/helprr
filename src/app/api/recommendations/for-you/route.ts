import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getRecommendationRails } from '@/lib/recommendations/engine';
import type { RecItem } from '@/lib/recommendations/rec-types';
import type { ForYouItem, ForYouResponse } from '@/lib/recommendations/types';

// For You dashboard widget — served from the learning engine's discovery
// output (the same snapshot as /api/recommendations, so the widget and the
// page never disagree). The response shape is the widget's original contract.

const DEFAULT_LIMIT = 12;

function toForYouItem(item: RecItem): ForYouItem | null {
  if (!item.tmdbId || (item.mediaType !== 'movie' && item.mediaType !== 'tv')) return null;
  return {
    id: item.tmdbId,
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.title,
    year: item.year,
    posterPath: item.posterUrl,
    rating: item.rating ?? 0,
    overview: item.overview ?? '',
    reason: item.reason ?? 'Matched to your taste',
    href: item.href,
  };
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // Same gate as /api/recommendations — this serves the same engine output,
  // so revoking recommendations.view must close the widget path too.
  const auth = await requireUserCapability('recommendations.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 50
    ? Math.floor(limitParam)
    : DEFAULT_LIMIT;

  try {
    const { rails } = await getRecommendationRails(auth.user);
    // Widget = discovery suggestions: the "Because you watched" rails first
    // (strongest personal signal), then the general discover rail.
    const seen = new Set<string>();
    const items: ForYouItem[] = [];
    const discoveryRails = [
      ...rails.filter((rail) => rail.id.startsWith('because:')),
      ...rails.filter((rail) => rail.id === 'discover'),
    ];
    for (const rail of discoveryRails) {
      for (const railItem of rail.items) {
        if (railItem.owned || seen.has(railItem.itemKey)) continue;
        const mapped = toForYouItem(railItem);
        if (!mapped) continue;
        seen.add(railItem.itemKey);
        // Items in a "Because you watched X" rail inherit the rail title as
        // their reason (the composer leaves per-item reasons null there).
        items.push(rail.id.startsWith('because:') && !railItem.reason
          ? { ...mapped, reason: rail.title }
          : mapped);
        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }

    const payload: ForYouResponse = { items, empty: items.length === 0 };
    return NextResponse.json(payload);
  } catch {
    const payload: ForYouResponse = { items: [], empty: true };
    return NextResponse.json(payload);
  }
}

export const GET = withApiLogging(getHandler, 'api/recommendations/for-you');
