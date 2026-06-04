import { NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  // Root folders expose filesystem paths; gate behind the add/edit-path
  // capabilities that actually consume them (add page, edit page).
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'music.add') && !can(auth.user, 'music.changePath')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
