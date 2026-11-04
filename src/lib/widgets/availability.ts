import type { WidgetDefinition, WidgetService } from './types';

export function hasRequiredWidgetServices(
  definition: Pick<WidgetDefinition, 'requiredServices' | 'requiredServiceMode'>,
  configuredServices: ReadonlySet<WidgetService>,
): boolean {
  const required = definition.requiredServices;
  if (!required?.length) return true;
  return definition.requiredServiceMode === 'any'
    ? required.some((service) => configuredServices.has(service))
    : required.every((service) => configuredServices.has(service));
}

const SERVICE_LABELS: Record<WidgetService, string> = {
  SONARR: 'Sonarr',
  RADARR: 'Radarr',
  LIDARR: 'Lidarr',
  QBITTORRENT: 'qBittorrent',
  PROWLARR: 'Prowlarr',
  JELLYFIN: 'Jellyfin',
  TMDB: 'TMDB',
  ANILIST: 'AniList',
  SEERR: 'Seerr',
  TWITCH: 'Twitch',
  YOUTUBE: 'YouTube',
};

// Where someone with settings.instances connects each service. Twitch and YouTube
// have their own setup pages, but those need another capability, so their cards on
// the Instances page are the way in.
const SERVICE_SETUP_PATHS: Record<WidgetService, string> = {
  SONARR: '/settings/instances/sonarr',
  RADARR: '/settings/instances/radarr',
  LIDARR: '/settings/instances/lidarr',
  QBITTORRENT: '/settings/instances/qbittorrent',
  PROWLARR: '/settings/instances/prowlarr',
  JELLYFIN: '/settings/instances/jellyfin',
  TMDB: '/settings/instances/tmdb',
  ANILIST: '/settings/instances',
  SEERR: '/settings/instances/seerr',
  TWITCH: '/settings/instances',
  YOUTUBE: '/settings/instances',
};

export function describeRequiredWidgetServices(
  definition: Pick<WidgetDefinition, 'requiredServices' | 'requiredServiceMode'>,
): string {
  const required = definition.requiredServices ?? [];
  return required
    .map((service) => SERVICE_LABELS[service])
    .join(definition.requiredServiceMode === 'any' ? ' or ' : ' and ');
}

/**
 * The page to connect the first missing service a widget needs, or null when none
 * is missing. In 'any' mode an empty widget has none of its services, so this is the
 * first one listed, though any of them would do.
 */
export function widgetServiceSetupPath(
  definition: Pick<WidgetDefinition, 'requiredServices' | 'requiredServiceMode'>,
  configuredServices: ReadonlySet<WidgetService>,
): string | null {
  const missing = (definition.requiredServices ?? []).find((service) => !configuredServices.has(service));
  return missing ? SERVICE_SETUP_PATHS[missing] : null;
}
