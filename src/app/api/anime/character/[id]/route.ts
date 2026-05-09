import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCharacterDetail } from '@/lib/anilist-client';
import type { AniListSort } from '@/types/anilist';
import { withApiLogging } from '@/lib/api-logger';

const VALID_SORTS = new Set<AniListSort>([
  'POPULARITY_DESC',
  'SCORE_DESC',
  'FAVOURITES_DESC',
  'START_DATE_DESC',
  'START_DATE',
  'TITLE_ROMAJI',
]);

function parsePage(value: string | null): number {
  return Math.max(1, parseInt(value || '1', 10) || 1);
}

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid character ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const page = parsePage(url.searchParams.get('page'));
    const sortParam = url.searchParams.get('sort') || 'POPULARITY_DESC';
    if (!VALID_SORTS.has(sortParam as AniListSort)) {
      return NextResponse.json({ error: 'Invalid sort' }, { status: 400 });
    }
    const sort = sortParam as AniListSort;

    const detail = await getCharacterDetail(id, page, sort);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load character detail';
    console.error('[Character Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/character/[id]');
