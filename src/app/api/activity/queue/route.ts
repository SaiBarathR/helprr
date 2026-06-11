import { NextRequest, NextResponse } from 'next/server';
import type { ServiceConnection } from '@prisma/client';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { QueueItem } from '@/types';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);

    // Fan out across every instance of a type; one unreachable instance must not
    // blank the rest. Tag each record with its source + instance.
    const fanOut = async (
      clients: Array<{ connection: ServiceConnection; client: { getQueue(p: number, s: number): Promise<{ records: QueueItem[]; totalRecords: number }> } }>,
      source: 'sonarr' | 'radarr' | 'lidarr',
    ) => {
      const perInstance = await Promise.all(
        clients.map(async ({ connection, client }) => {
          try {
            const q = await client.getQueue(page, pageSize);
            return {
              records: q.records.map((record: QueueItem) => ({
                ...record,
                source,
                instanceId: connection.id,
                instanceLabel: connection.label,
              })),
              totalRecords: q.totalRecords,
            };
          } catch {
            return { records: [] as QueueItem[], totalRecords: 0 };
          }
        }),
      );
      return {
        records: perInstance.flatMap((p) => p.records),
        totalRecords: perInstance.reduce((sum, p) => sum + p.totalRecords, 0),
      };
    };

    const [sonarrClients, radarrClients, lidarrClients] = await Promise.all([
      getSonarrClients().catch(() => []),
      getRadarrClients().catch(() => []),
      getLidarrClients().catch(() => []),
    ]);

    const [sonarr, radarr, lidarr] = await Promise.all([
      fanOut(sonarrClients, 'sonarr'),
      fanOut(radarrClients, 'radarr'),
      fanOut(lidarrClients, 'lidarr'),
    ]);

    const mergedRecords = [...sonarr.records, ...radarr.records, ...lidarr.records];
    const totalRecords = sonarr.totalRecords + radarr.totalRecords + lidarr.totalRecords;

    return NextResponse.json({ records: mergedRecords, totalRecords });
  } catch (error) {
    console.error('Failed to fetch queue:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/queue');
