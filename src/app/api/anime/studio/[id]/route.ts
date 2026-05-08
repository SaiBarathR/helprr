import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getStudioDetail } from '@/lib/anilist-client';
import type { AniListSort } from '@/types/anilist';

const VALID_SORTS = new Set<AniListSort>([
  'START_DATE_DESC',
  'POPULARITY_DESC',
  'SCORE_DESC',
  'FAVOURITES_DESC',
  'START_DATE',
  'TITLE_ROMAJI',
]);

function parsePage(value: string | null): number {
  return Math.max(1, parseInt(value || '1', 10) || 1);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid studio ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const page = parsePage(url.searchParams.get('page'));
    const sortParam = url.searchParams.get('sort') || 'START_DATE_DESC';
    if (!VALID_SORTS.has(sortParam as AniListSort)) {
      return NextResponse.json({ error: 'Invalid sort' }, { status: 400 });
    }
    const sort = sortParam as AniListSort;

    const detail = await getStudioDetail(id, page, sort);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load studio detail';
    console.error('[Studio Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
