import type { ServiceType } from '@prisma/client';
import type { Capability } from '@/lib/capabilities';

/**
 * View capability required before exposing data derived from a configured
 * service connection. Keep this server-only module as the single source of
 * truth for connection-derived reads.
 */
export const SERVICE_VIEW_CAPABILITY: Readonly<Record<ServiceType, Capability>> = {
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
