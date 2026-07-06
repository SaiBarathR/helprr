import type { ServiceConnection, ServiceType } from '@prisma/client';
import { ConfigurationError } from '@/lib/config-error';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { LidarrClient } from '@/lib/lidarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';
import { SeerrClient } from '@/lib/seerr-client';

export const SERVICE_LABELS: Record<ServiceType, string> = {
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

// Reachability probe for a single connection — the lightest call per service
// type that confirms it's up and authenticated. Throws on failure. Used by both
// the /api/services/health board and the polling reachability watcher.
async function checkConnection(connection: ServiceConnection): Promise<void> {
  switch (connection.type) {
    case 'SONARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new ConfigurationError('Sonarr URL is not configured');
      const client = new SonarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'RADARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new ConfigurationError('Radarr URL is not configured');
      const client = new RadarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'LIDARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new ConfigurationError('Lidarr URL is not configured');
      const client = new LidarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'QBITTORRENT': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new ConfigurationError('qBittorrent URL is not configured');
      const client = new QBittorrentClient(baseUrl, connection.apiKey, connection.username || 'admin');
      await client.getVersion();
      return;
    }
    case 'PROWLARR': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new ConfigurationError('Prowlarr URL is not configured');
      const client = new ProwlarrClient(baseUrl, connection.apiKey);
      await client.getSystemStatus();
      return;
    }
    case 'JELLYFIN': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new ConfigurationError('Jellyfin URL is not configured');
      const client = new JellyfinClient(baseUrl, connection.apiKey, connection.username || '');
      await client.getSystemInfo();
      return;
    }
    case 'TMDB': {
      const baseUrl = connection.url?.replace(/\/+$/, '');
      if (!baseUrl) throw new ConfigurationError('TMDB URL is not configured');
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
      if (!baseUrl) throw new ConfigurationError('Seerr URL is not configured');
      const client = new SeerrClient(baseUrl, connection.apiKey);
      await client.verify();
      return;
    }
    default: {
      // Exhaustiveness: adding a ServiceType without a probe here is a compile
      // error, and at runtime an unknown type is reported unhealthy rather than
      // silently healthy.
      const _exhaustive: never = connection.type;
      throw new Error(`Unhandled service type: ${String(_exhaustive)}`);
    }
  }
}

// Non-throwing wrapper: returns { ok, error? } so callers can render/notify
// without their own try/catch.
export async function probeServiceHealth(
  connection: ServiceConnection,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await checkConnection(connection);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
