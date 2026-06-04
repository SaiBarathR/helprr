import { NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.view');
  if (capError) return capError;

  try {
    const client = await getLidarrClient();
    const health = await client.getHealth();
    return NextResponse.json(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch health';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/health');
