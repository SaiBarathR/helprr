import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { prisma } from '@/lib/db';
import { findUnsyncedConnections, toApplicationSummary } from '@/lib/prowlarr-applications';

/** The apps Prowlarr syncs to, and any arr in Helprr that none of them points at. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getProwlarrClient();
    const applications = await client.getApplications();
    const connections = await prisma.serviceConnection.findMany({
      where: { type: { in: ['SONARR', 'RADARR', 'LIDARR'] } },
      select: { type: true, url: true, label: true },
    });
    return NextResponse.json({
      applications: applications.map(toApplicationSummary),
      unsynced: findUnsyncedConnections(connections, applications),
    });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch applications');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/applications');
