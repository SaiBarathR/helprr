import { NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getLidarrClient();
    const profiles = await client.getQualityProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch quality profiles';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/qualityprofiles');
