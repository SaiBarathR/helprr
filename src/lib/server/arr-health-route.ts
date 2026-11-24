// GET /api/{sonarr,radarr,lidarr}/health: one instance's health checks.
import { NextResponse, type NextRequest } from 'next/server';
import { listConnections, type ArrServiceType } from '@/lib/arr-instances';
import { getLidarrClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { upstreamErrorResponse } from '@/lib/api-error';
import { toHealthChecks } from '@/lib/arr-health';
import type { HealthCheck } from '@/types/arr';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const CLIENTS: Record<ArrServiceType, (instanceId: string) => Promise<{ getHealth(): Promise<HealthCheck[]> }>> = {
  SONARR: getSonarrClient,
  RADARR: getRadarrClient,
  LIDARR: getLidarrClient,
};

/**
 * GET /api/{sonarr,radarr,lidarr}/health?instanceId=…, after the route's own
 * authorization. The instance is required and must be one of this type, so a
 * Radarr id sent to the Sonarr route (or any other row id) reaches nothing.
 */
export async function arrHealthResponse(type: ArrServiceType, request: NextRequest): Promise<NextResponse> {
  const instanceId = request.nextUrl.searchParams.get('instanceId')?.trim() ?? '';
  if (!instanceId || instanceId.length > 128) {
    return NextResponse.json({ error: 'instanceId is required' }, { status: 400 });
  }
  try {
    const connections = await listConnections(type);
    if (!connections.some((connection) => connection.id === instanceId)) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }
    const client = await CLIENTS[type](instanceId);
    return NextResponse.json(toHealthChecks(await client.getHealth()), { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch health');
  }
}
