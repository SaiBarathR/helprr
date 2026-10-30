import type { ProwlarrApplication } from '@/lib/prowlarr-client';

export interface ProwlarrApplicationSummary {
  id: number;
  name: string;
  implementationName: string;
  syncLevel: string;
  enable: boolean;
}

export interface UnsyncedConnection {
  type: string;
  label: string;
}

interface ArrConnection {
  type: string;
  url: string;
  label?: string | null;
}

const IMPLEMENTATION_BY_TYPE: Record<string, string> = { SONARR: 'Sonarr', RADARR: 'Radarr', LIDARR: 'Lidarr' };

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

function applicationBaseUrl(application: ProwlarrApplication): string | null {
  const field = application.fields?.find((candidate) => candidate.name === 'baseUrl');
  return typeof field?.value === 'string' ? field.value : null;
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
    return leftConnections.map((connection) => ({ type, label: connection.label || implementation }));
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
  };
}
