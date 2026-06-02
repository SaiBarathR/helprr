import { NextResponse } from 'next/server';
import type { ServiceConnection, ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { LidarrClient } from '@/lib/lidarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';
import { SeerrClient } from '@/lib/seerr-client';
import { withApiLogging } from '@/lib/api-logger';

interface ServiceHealthStatus {
  type: ServiceType;
  name: string;
  ok: boolean;
}

const SERVICE_LABELS: Record<ServiceType, string> = {
  SONARR: 'Sonarr',
  RADARR: 'Radarr',
  LIDARR: 'Lidarr',
  QBITTORRENT: 'qBittorrent',
  PROWLARR: 'Prowlarr',
  JELLYFIN: 'Jellyfin',
  TMDB: 'TMDB',
  ANILIST: 'AniList',
  SEERR: 'Seerr',
};

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

async function checkServiceHealth(connection: ServiceConnection): Promise<void> {
  switch (connection.type) {
    case 'SONARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('Sonarr URL is not configured');
      const client = new SonarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'RADARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('Radarr URL is not configured');
      const client = new RadarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'LIDARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('Lidarr URL is not configured');
      const client = new LidarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'QBITTORRENT': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('qBittorrent URL is not configured');
      const client = new QBittorrentClient(baseUrl, connection.apiKey, connection.username || 'admin');
      await client.getVersion();
      return;
    }
    case 'PROWLARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('Prowlarr URL is not configured');
      const client = new ProwlarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'JELLYFIN': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('Jellyfin URL is not configured');
      const client = new JellyfinClient(baseUrl, connection.apiKey, connection.username || '');
      await client.getSystemInfo();
      return;
    }
    case 'TMDB': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('TMDB URL is not configured');
      const client = new TmdbClient(baseUrl, connection.apiKey);
      await client.validateConnection();
      return;
    }
    case 'ANILIST': {
      // OAuth-based; consider healthy if an access token is stored and not obviously expired.
      if (!connection.accessToken) throw new Error('AniList not authorized');
      if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() < Date.now()) {
        throw new Error('AniList token expired');
      }
      return;
    }
    case 'SEERR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new Error('Seerr URL is not configured');
      const client = new SeerrClient(baseUrl, connection.apiKey);
      await client.verify();
      return;
    }
    default:
      return;
  }
}

async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const connections = (
      await prisma.serviceConnection.findMany({ orderBy: { type: 'asc' } })
    ).filter((connection) => can(auth.user, SERVICE_VIEW_CAP[connection.type]));

    const statuses = await Promise.all(
      connections.map(async (connection): Promise<ServiceHealthStatus> => {
        try {
          await checkServiceHealth(connection);
          return {
            type: connection.type,
            name: SERVICE_LABELS[connection.type] || connection.type,
            ok: true,
          };
        } catch {
          return {
            type: connection.type,
            name: SERVICE_LABELS[connection.type] || connection.type,
            ok: false,
          };
        }
      })
    );

    return NextResponse.json(statuses);
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch service health' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/services/health');
