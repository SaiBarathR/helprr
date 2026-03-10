import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getMangaDetail } from '@/lib/anilist-client';
import { normalizeAniListMangaDetail } from '@/lib/anilist-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid manga ID' }, { status: 400 });
    }

    const detail = await getMangaDetail(id);
    const normalized = normalizeAniListMangaDetail(detail);

    return NextResponse.json(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load manga detail';
    console.error('[Manga Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
