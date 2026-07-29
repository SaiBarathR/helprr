import type { ServiceType } from '@prisma/client';
import type { Capability } from '@/lib/capabilities';
import { can, type PermissionUser } from '@/lib/permissions';

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

const SERVICE_WIDGET_CAPABILITIES: Readonly<Record<ServiceType, readonly Capability[]>> = {
  SONARR: ['series.view', 'activity.view'],
  RADARR: ['movies.view', 'activity.view'],
  LIDARR: ['music.view'],
  QBITTORRENT: ['torrents.view', 'cleanup.view'],
  PROWLARR: ['prowlarr.view'],
  JELLYFIN: ['jellyfin.view', 'jellyfin.control', 'jellyfin.sessions', 'jellyfin.stats'],
  TMDB: ['discover.view', 'recommendations.view'],
  ANILIST: ['anime.view'],
  SEERR: ['requests.view', 'requests.approve'],
};

export function filterVisibleServiceTypes(
  user: PermissionUser,
  serviceTypes: readonly ServiceType[],
): ServiceType[] {
  if (can(user, 'settings.instances')) return [...serviceTypes];
  return serviceTypes.filter((type) =>
    SERVICE_WIDGET_CAPABILITIES[type].some((capability) => can(user, capability))
  );
}
