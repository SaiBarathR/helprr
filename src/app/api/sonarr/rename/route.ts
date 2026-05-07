import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const seriesId = Number(new URL(request.url).searchParams.get('seriesId'));
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'seriesId is required' }, { status: 400 });
    }
    const client = await getSonarrClient();
    const preview = await client.getRenamePreview(seriesId);
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch rename preview';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
