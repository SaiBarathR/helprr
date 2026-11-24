import type {
  ProwlarrApplication,
  ProwlarrApplicationTemplate,
  ProwlarrNewApplication,
  ProwlarrSyncLevel,
} from '@/lib/prowlarr-client';

/** Prowlarr's sync levels, in its own order. */
export const PROWLARR_SYNC_LEVELS = ['disabled', 'addOnly', 'fullSync'] as const satisfies readonly ProwlarrSyncLevel[];

export interface ProwlarrApplicationSummary {
  id: number;
  name: string;
  implementationName: string;
  syncLevel: string;
  enable: boolean;
  tags: number[];
}

export interface UnsyncedConnection {
  /** The Helprr connection, so an admin can add it to Prowlarr. */
  id: string;
  type: string;
  label: string;
}

interface ArrConnection {
  id: string;
  type: string;
  url: string;
  label?: string | null;
}

export const IMPLEMENTATION_BY_TYPE: Record<string, string> = { SONARR: 'Sonarr', RADARR: 'Radarr', LIDARR: 'Lidarr' };

interface Endpoint {
  full: string;
  /** Null when the port says nothing about the instance: a default port, or a path behind a proxy. */
  distinctivePort: string | null;
}

function endpointOf(url: string | null): Endpoint | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return {
      full: `${parsed.hostname}:${parsed.port}${path}`,
      distinctivePort: parsed.port && !path ? parsed.port : null,
    };
  } catch {
    return null;
  }
}

function applicationField(application: ProwlarrApplication, name: string): string | null {
  const field = application.fields?.find((candidate) => candidate.name === name);
  return typeof field?.value === 'string' ? field.value : null;
}

function applicationBaseUrl(application: ProwlarrApplication): string | null {
  return applicationField(application, 'baseUrl');
}

/**
 * Helprr's arr connections that may have no Prowlarr app, which Prowlarr itself
 * cannot notice. Helprr and Prowlarr often reach one arr by different names (a
 * LAN address, a Docker name), so an address alone proves nothing. Apps and
 * connections are paired by exact address, then by a distinctive port; a warning
 * needs more connections left over than apps left to explain them. Leftover
 * connections can't be told apart, so all of them are named. Only this result
 * leaves the server; app fields hold each arr's API key.
 */
export function findUnsyncedConnections(
  connections: ArrConnection[],
  applications: ProwlarrApplication[],
): UnsyncedConnection[] {
  return Object.entries(IMPLEMENTATION_BY_TYPE).flatMap(([type, implementation]) => {
    let leftConnections = connections.filter((connection) => connection.type === type);
    const leftApps = applications
      .filter((application) => application.implementation === implementation)
      .map((application) => endpointOf(applicationBaseUrl(application)));

    const pairBy = (key: (endpoint: Endpoint) => string | null) => {
      leftConnections = leftConnections.filter((connection) => {
        const endpoint = endpointOf(connection.url);
        const value = endpoint && key(endpoint);
        if (!value) return true;
        const match = leftApps.findIndex((app) => app && key(app) === value);
        if (match === -1) return true;
        leftApps.splice(match, 1);
        return false;
      });
    };
    pairBy((endpoint) => endpoint.full);
    pairBy((endpoint) => endpoint.distinctivePort);

    if (leftConnections.length <= leftApps.length) return [];
    return leftConnections.map((connection) => ({ id: connection.id, type, label: connection.label || implementation }));
  });
}

/** App fields hold the arr's API key, so only these properties are passed on. */
export function toApplicationSummary(application: ProwlarrApplication): ProwlarrApplicationSummary {
  return {
    id: application.id,
    name: application.name,
    implementationName: application.implementationName,
    syncLevel: application.syncLevel,
    enable: application.enable,
    tags: application.tags,
  };
}

/** Whether one of Prowlarr's apps for this arr type already points at this address. */
export function hasApplicationAt(applications: ProwlarrApplication[], implementation: string, url: string): boolean {
  const target = endpointOf(url)?.full;
  return !!target && applications.some((application) => (
    application.implementation === implementation && endpointOf(applicationBaseUrl(application))?.full === target
  ));
}

/**
 * The address an arr should use to reach Prowlarr. The other apps already reach
 * it, so the one most of them use is the best guess (under Docker it is often a
 * container name Helprr cannot see); with no apps, the address Helprr uses.
 */
export function guessProwlarrUrl(applications: ProwlarrApplication[], helprrProwlarrUrl: string): string {
  const counts = new Map<string, number>();
  for (const application of applications) {
    const url = applicationField(application, 'prowlarrUrl');
    if (url) counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  const [best] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return best ?? helprrProwlarrUrl.replace(/\/+$/, '');
}

/**
 * A new app from Prowlarr's own template for that arr, so its defaults (sync
 * categories and the rest) are Prowlarr's. Null when the template lacks a field
 * Helprr fills: a Prowlarr that changed its form gets nothing half-filled.
 */
export function buildNewApplication(
  template: ProwlarrApplicationTemplate,
  input: { name: string; syncLevel: ProwlarrSyncLevel; prowlarrUrl: string; baseUrl: string; apiKey: string },
): ProwlarrNewApplication | null {
  const values: Record<string, string> = { prowlarrUrl: input.prowlarrUrl, baseUrl: input.baseUrl, apiKey: input.apiKey };
  const names = new Set(template.fields.map((field) => field.name));
  if (!Object.keys(values).every((name) => names.has(name))) return null;
  return {
    name: input.name,
    implementation: template.implementation,
    implementationName: template.implementationName,
    configContract: template.configContract,
    syncLevel: input.syncLevel,
    tags: [],
    fields: template.fields.map((field) => ({ name: field.name, value: field.name in values ? values[field.name] : field.value })),
  };
}
