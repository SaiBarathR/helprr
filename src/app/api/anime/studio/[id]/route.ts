import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getStudioDetail } from '@/lib/anilist-client';

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
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const sort = url.searchParams.get('sort') || 'START_DATE_DESC';

    const detail = await getStudioDetail(id, page, sort);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load studio detail';
    console.error('[Studio Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
