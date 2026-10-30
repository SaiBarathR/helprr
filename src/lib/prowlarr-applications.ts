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

function portOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  } catch {
    return null;
  }
}

function applicationBaseUrl(application: ProwlarrApplication): string | null {
  const field = application.fields?.find((candidate) => candidate.name === 'baseUrl');
  return typeof field?.value === 'string' ? field.value : null;
}

/**
 * Helprr's arr connections that no Prowlarr app points at, which Prowlarr itself
 * cannot notice. Matched by app type and port, not host: Helprr and Prowlarr
 * often reach the same arr by different names (a LAN address, a Docker name).
 * Only the result leaves the server; app fields hold each arr's API key.
 */
export function findUnsyncedConnections(
  connections: ArrConnection[],
  applications: ProwlarrApplication[],
): UnsyncedConnection[] {
  return connections
    .filter((connection) => connection.type in IMPLEMENTATION_BY_TYPE)
    .filter((connection) => {
      const port = portOf(connection.url);
      return !applications.some((application) => {
        const baseUrl = applicationBaseUrl(application);
        return application.implementation === IMPLEMENTATION_BY_TYPE[connection.type]
          && baseUrl !== null
          && portOf(baseUrl) === port;
      });
    })
    .map((connection) => ({
      type: connection.type,
      label: connection.label || IMPLEMENTATION_BY_TYPE[connection.type],
    }));
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
