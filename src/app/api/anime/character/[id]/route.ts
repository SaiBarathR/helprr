import { NextRequest, NextResponse } from 'next/server';
import { requireUserAnyCapability } from '@/lib/auth';
import { getCharacterDetail, maxAniListPage, ANILIST_DETAIL_PAGE_SIZE } from '@/lib/anilist-client';
import type { AniListSort } from '@/types/anilist';
import { withApiLogging } from '@/lib/api-logger';
import { anilistNotFoundResponse } from '@/lib/anilist-http';
import { parsePageNumber } from '@/lib/pagination';

const VALID_SORTS = new Set<AniListSort>([
  'POPULARITY_DESC',
  'SCORE_DESC',
  'FAVOURITES_DESC',
  'START_DATE_DESC',
  'START_DATE',
  'TITLE_ROMAJI',
]);

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserAnyCapability(['anime.view', 'series.view', 'watchlist.view', 'recommendations.view']);
  if (!auth.ok) return auth.response;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid character ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const page = parsePageNumber(url.searchParams, { max: maxAniListPage(ANILIST_DETAIL_PAGE_SIZE) });
    const sortParam = url.searchParams.get('sort') || 'POPULARITY_DESC';
    if (!VALID_SORTS.has(sortParam as AniListSort)) {
      return NextResponse.json({ error: 'Invalid sort' }, { status: 400 });
    }
    const sort = sortParam as AniListSort;

    const detail = await getCharacterDetail(id, page, sort);
    return NextResponse.json(detail);
  } catch (error) {
    const notFound = anilistNotFoundResponse(error);
    if (notFound) return notFound;
    const message = error instanceof Error ? error.message : 'Failed to load character detail';
    console.error('[Character Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/character/[id]');
