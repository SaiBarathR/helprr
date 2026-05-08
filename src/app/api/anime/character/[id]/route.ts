import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCharacterDetail } from '@/lib/anilist-client';

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
      return NextResponse.json({ error: 'Invalid character ID' }, { status: 400 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const sort = url.searchParams.get('sort') || 'POPULARITY_DESC';

    const detail = await getCharacterDetail(id, page, sort);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load character detail';
    console.error('[Character Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
