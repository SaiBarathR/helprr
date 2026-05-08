import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getStaffCharacterMediaPage,
  getStaffDetail,
  getStaffMediaPage,
} from '@/lib/anilist-client';

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
      return NextResponse.json({ error: 'Invalid staff ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const sort = url.searchParams.get('sort') || 'POPULARITY_DESC';
    const type = url.searchParams.get('type') as
      | 'ANIME'
      | 'MANGA'
      | 'VOICE_ACTING'
      | null;

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
    const detail = await getStaffDetail(id, 1, 1, 1, sort);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load staff detail';
    console.error('[Staff Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
