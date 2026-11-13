import { NextResponse } from 'next/server';
import { listConnections } from '@/lib/arr-instances';
import { getLidarrClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { can, type PermissionUser } from '@/lib/permissions';
import type { ActivityHistorySource } from '@/lib/activity-history';
import type { LidarrClient } from '@/lib/lidarr-client';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';

const SERVICE = { sonarr: 'SONARR', radarr: 'RADARR', lidarr: 'LIDARR' } as const;
const APP_NAME = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr' } as const;

export interface ActivityArrTarget {
  source: ActivityHistorySource;
  service: (typeof SERVICE)[ActivityHistorySource];
  appName: string;
  instanceId: string;
  client: SonarrClient | RadarrClient | LidarrClient;
}

/**
 * Lidarr's downloads, history and imports are music: Activity shows them, and
 * lets them be acted on, only for a user who may see the music library.
 */
export function activitySourceForbidden(user: PermissionUser, source: ActivityHistorySource): NextResponse | null {
  if (source !== 'lidarr' || can(user, 'music.view')) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * The Sonarr/Radarr/Lidarr instance a queue or history action names. Queue and
 * history ids are per instance, so `instanceId` must be one of that service's
 * connections: it never falls back to the default instance.
 */
export async function resolveActivityArrTarget(
  user: PermissionUser,
  source: unknown,
  instanceId: unknown,
): Promise<{ ok: true; target: ActivityArrTarget } | { ok: false; response: NextResponse }> {
  if (source !== 'sonarr' && source !== 'radarr' && source !== 'lidarr') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'source must be "sonarr", "radarr" or "lidarr"' }, { status: 400 }),
    };
  }
  const forbidden = activitySourceForbidden(user, source);
  if (forbidden) return { ok: false, response: forbidden };
  if (typeof instanceId !== 'string' || !instanceId || instanceId.length > 128) {
    return { ok: false, response: NextResponse.json({ error: 'instanceId is required' }, { status: 400 }) };
  }
  const service = SERVICE[source];
  const connections = await listConnections(service);
  if (!connections.some((connection) => connection.id === instanceId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Unknown ${APP_NAME[source]} instance` }, { status: 400 }),
    };
  }
  const client = source === 'sonarr'
    ? await getSonarrClient(instanceId)
    : source === 'radarr'
      ? await getRadarrClient(instanceId)
      : await getLidarrClient(instanceId);
  return { ok: true, target: { source, service, appName: APP_NAME[source], instanceId, client } };
}

const INT32_MAX = 2_147_483_647;

/** A route `[id]` segment as a queue or history id: digits only, within the *arrs' int range. */
export function parseArrId(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return id <= INT32_MAX ? id : null;
}

/** A request body that is a JSON object, or null. */
export function asJsonObject(body: { ok: true; body: unknown } | { ok: false }): Record<string, unknown> | null {
  return body.ok && typeof body.body === 'object' && body.body !== null && !Array.isArray(body.body)
    ? body.body as Record<string, unknown>
    : null;
}
