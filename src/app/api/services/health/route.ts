import { NextResponse } from 'next/server';
import type { ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';
import { probeServiceHealth, SERVICE_LABELS } from '@/lib/service-health';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';

const HEALTH_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
} as const;

interface ServiceHealthStatus {
  instanceId: string;
  type: ServiceType;
  name: string;
  // The instance label (e.g. "HD", "4K") — distinguishes multiple instances of
  // the same service type. Equal to `name` for single-instance services.
  label: string;
  ok: boolean;
  error?: string;
}

// The view capability that gates each service's health. Members only see the
// services they're allowed to view; admins short-circuit can() and see all.
// qBittorrent/Prowlarr are admin-only (privacy), so members never learn they exist.
const SERVICE_VIEW_CAP: Record<ServiceType, Capability> = {
  SONARR: 'series.view',
  RADARR: 'movies.view',
  LIDARR: 'music.view',
  QBITTORRENT: 'torrents.view',
  PROWLARR: 'prowlarr.view',
  JELLYFIN: 'jellyfin.view',
  TMDB: 'discover.view',
  ANILIST: 'anime.view',
  SEERR: 'requests.view',
};

async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    // Cache the FULL probe array (every service), then filter per user after the read so
    // the expensive probes are shared across users without leaking which services a member
    // isn't allowed to see.
    let statuses = await getCachedJson<ServiceHealthStatus[]>('health', '');
    if (!statuses) {
      const connections = await prisma.serviceConnection.findMany({ orderBy: { type: 'asc' } });
      statuses = await Promise.all(
        connections.map(async (connection): Promise<ServiceHealthStatus> => {
          const result = await probeServiceHealth(connection);
          return {
            instanceId: connection.id,
            type: connection.type,
            name: SERVICE_LABELS[connection.type] || connection.type,
            label: connection.label || SERVICE_LABELS[connection.type] || connection.type,
            ok: result.ok,
            ...(result.error ? { error: result.error } : {}),
          };
        })
      );
      await setCachedJson('health', '', statuses, 60);
    }

    const visible = statuses.filter((status) => can(auth.user, SERVICE_VIEW_CAP[status.type]));
    return NextResponse.json(visible, { headers: HEALTH_CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch service health' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/services/health');
