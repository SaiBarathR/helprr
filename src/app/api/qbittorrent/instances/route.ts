import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { listConnections } from '@/lib/arr-instances';
import { withApiLogging } from '@/lib/api-logger';

// The qBittorrents the Torrents pages can switch between: id, name and which
// one is the default, never a URL or password. Its own list rather than part
// of /api/instances, whose pickers and filters are for the arrs.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;

  const instances = await listConnections('QBITTORRENT');
  return NextResponse.json(
    instances.map(({ id, label, isDefault }) => ({ id, label, isDefault })),
    { headers: { 'Cache-Control': 'private, no-cache', Vary: 'Cookie' } },
  );
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/instances');
