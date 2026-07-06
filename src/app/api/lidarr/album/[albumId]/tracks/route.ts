import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

function parsePositiveId(id: string): { value: number } | { error: NextResponse } {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: NextResponse.json({ error: 'Invalid album id' }, { status: 400 }) };
  }
  return { value: parsed };
}

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { albumId } = await params;
    const parsed = parsePositiveId(albumId);
    if ('error' in parsed) return parsed.error;
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const tracks = await client.getTracks(parsed.value);
    return NextResponse.json(tracks);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch tracks');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/album/[albumId]/tracks');
