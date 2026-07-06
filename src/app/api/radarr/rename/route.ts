import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const movieId = Number(new URL(request.url).searchParams.get('movieId'));
    if (!Number.isFinite(movieId) || movieId <= 0) {
      return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const preview = await client.getRenamePreview(movieId);
    return NextResponse.json(preview);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch rename preview');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/rename');
