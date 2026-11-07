import type { Capability } from '@/lib/capabilities';

// What a personal API token may read. A scope is a read capability; a token
// can be given only scopes its owner holds, and each request uses only those
// the owner still holds then. Import-safe from client and server.
export interface ApiTokenScopeDef {
  readonly scope: Capability;
  readonly label: string;
}

export const API_TOKEN_SCOPES: readonly ApiTokenScopeDef[] = [
  { scope: 'activity.view', label: 'Download queue (size and items)' },
  { scope: 'torrents.view', label: 'Downloading count and speeds' },
  { scope: 'movies.view', label: 'Free space on Radarr disks' },
  { scope: 'series.view', label: 'Free space on Sonarr disks' },
  { scope: 'music.view', label: 'Free space on Lidarr disks' },
  { scope: 'calendar.view', label: 'Next releases' },
  { scope: 'jellyfin.sessions', label: 'Active Jellyfin streams' },
  { scope: 'notifications.view', label: 'Unread alerts' },
];

const SCOPE_SET: ReadonlySet<string> = new Set(API_TOKEN_SCOPES.map((def) => def.scope));

export function isApiTokenScope(value: unknown): value is Capability {
  return typeof value === 'string' && SCOPE_SET.has(value);
}
