import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function parsePositiveId(id: string): { value: number } | { error: NextResponse } {
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: NextResponse.json({ error: 'Invalid artist id' }, { status: 400 }) };
  }
  return { value: parsed };
}

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const parsed = parsePositiveId(id);
    if ('error' in parsed) return parsed.error;
    const client = await getLidarrClient();
    const albums = await client.getAlbums(parsed.value);
    return NextResponse.json(albums);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch albums';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/[id]/albums');
