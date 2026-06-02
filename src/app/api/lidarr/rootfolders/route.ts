import { NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getLidarrClient();
    const folders = await client.getRootFolders();
    return NextResponse.json(folders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch root folders';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/rootfolders');
