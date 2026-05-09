import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getStaffCharacterMediaPage,
  getStaffDetail,
  getStaffMediaPage,
} from '@/lib/anilist-client';
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

type StaffMediaType = 'ANIME' | 'MANGA' | 'VOICE_ACTING';

function parsePage(value: string | null): number {
  return Math.max(1, parseInt(value || '1', 10) || 1);
}

function parseSort(value: string | null): AniListSort | null {
  const sort = value || 'POPULARITY_DESC';
  return VALID_SORTS.has(sort as AniListSort) ? (sort as AniListSort) : null;
}

function parseType(value: string | null): StaffMediaType | null {
  if (value === 'ANIME' || value === 'MANGA' || value === 'VOICE_ACTING') return value;
  return null;
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
      return NextResponse.json({ error: 'Invalid staff ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const page = parsePage(url.searchParams.get('page'));
    const sort = parseSort(url.searchParams.get('sort'));
    if (!sort) return NextResponse.json({ error: 'Invalid sort' }, { status: 400 });

    const rawType = url.searchParams.get('type');
    const type = parseType(rawType);
    if (rawType && !type) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // Paginated request for a specific section
    if (page > 1 || type) {
      if (type === 'VOICE_ACTING') {
        const result = await getStaffCharacterMediaPage(id, page, sort);
        return NextResponse.json(result);
      }
      const mediaType = type === 'MANGA' ? 'MANGA' : 'ANIME';
      const result = await getStaffMediaPage(id, mediaType, page, sort);
      return NextResponse.json(result);
    }

    // Initial load — full staff detail with first page of anime/manga/voice-acting
    const animeSort = parseSort(url.searchParams.get('animeSort'));
    const mangaSort = parseSort(url.searchParams.get('mangaSort'));
    const vaSort = parseSort(url.searchParams.get('vaSort'));
    if (!animeSort || !mangaSort || !vaSort) {
      return NextResponse.json({ error: 'Invalid sort' }, { status: 400 });
    }
    const detail = await getStaffDetail(id, 1, 1, 1, animeSort, mangaSort, vaSort);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load staff detail';
    console.error('[Staff Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/staff/[id]');
