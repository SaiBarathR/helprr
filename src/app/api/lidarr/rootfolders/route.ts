import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  // Root folders expose filesystem paths; gate behind the add/edit-path
  // capabilities that actually consume them (add page, edit page).
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'music.add') && !can(auth.user, 'music.changePath')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const folders = await client.getRootFolders();
    return NextResponse.json(folders, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch root folders');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/rootfolders');
