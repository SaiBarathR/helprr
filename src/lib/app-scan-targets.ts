import type { ServiceType } from '@prisma/client';

/**
 * Where "Find apps on this network" may look: a fixed list, never user input. Shared by
 * the scan (src/lib/app-scan.ts) and the instance form, which fills in only an address
 * the scan itself could have found. No server-only imports, so client code can use it.
 */
export type ScanType = Extract<ServiceType, 'SONARR' | 'RADARR' | 'LIDARR' | 'PROWLARR' | 'QBITTORRENT' | 'JELLYFIN' | 'SEERR'>;

export const SCAN_APPS: { type: ScanType; port: number; names: string[] }[] = [
  { type: 'SONARR', port: 8989, names: ['sonarr'] },
  { type: 'RADARR', port: 7878, names: ['radarr'] },
  { type: 'LIDARR', port: 8686, names: ['lidarr'] },
  { type: 'PROWLARR', port: 9696, names: ['prowlarr'] },
  { type: 'QBITTORRENT', port: 8080, names: ['qbittorrent'] },
  { type: 'JELLYFIN', port: 8096, names: ['jellyfin'] },
  { type: 'SEERR', port: 5055, names: ['seerr', 'jellyseerr', 'overseerr'] },
];

export interface ScanTarget {
  type: ScanType;
  url: string;
}

export function isPrivateIpv4(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Every address a scan may contact: the fixed list, plus a private gateway address. */
export function scanTargets(gateway: string | null): ScanTarget[] {
  const extraHosts = ['host.docker.internal', ...(gateway && isPrivateIpv4(gateway) ? [gateway] : [])];
  return SCAN_APPS.flatMap((app) => [...app.names, ...extraHosts].map((host) => ({ type: app.type, url: `http://${host}:${app.port}` })));
}

/**
 * Could the scan have found this address for this service? A link that fills in the
 * instance form must name one, so a crafted link cannot fill in someone else's address.
 */
export function isScanAddress(type: string, url: string): boolean {
  const app = SCAN_APPS.find((candidate) => candidate.type === type);
  const match = /^http:\/\/([a-z0-9.-]+):(\d+)$/i.exec(url);
  if (!app || !match || Number(match[2]) !== app.port) return false;
  const host = match[1].toLowerCase();
  return app.names.includes(host) || host === 'host.docker.internal' || isPrivateIpv4(host);
}
