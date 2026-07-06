import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const seriesId = Number(new URL(request.url).searchParams.get('seriesId'));
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'seriesId is required' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const preview = await client.getRenamePreview(seriesId);
    return NextResponse.json(preview);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch rename preview');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/rename');
