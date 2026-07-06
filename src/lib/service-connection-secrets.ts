import type { ServiceConnection, ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export function isServiceType(value: string): value is ServiceType {
  return ['SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB', 'ANILIST', 'SEERR', 'LIDARR'].includes(
    value
  );
}

// Allowlist of fields safe to send to the browser: apiKey is masked and OAuth
// tokens/metadata never leave the server (legacy AniList rows can hold
// plaintext tokens).
export function serializeConnection(conn: ServiceConnection) {
  return {
    id: conn.id,
    type: conn.type,
    label: conn.label,
    isDefault: conn.isDefault,
    url: conn.url,
    externalUrl: conn.externalUrl,
    username: conn.username,
    apiKey: maskApiKey(conn.apiKey),
    tokenExpiresAt: conn.tokenExpiresAt,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  };
}

export async function resolveApiKeyForService(
  type: ServiceType,
  providedApiKey: string,
  instanceId?: string
): Promise<string> {
  // instanceId is scoped to the requested type: an id belonging to another
  // service type must not resolve (and leak) that row's secret.
  const existing = instanceId
    ? await prisma.serviceConnection.findFirst({ where: { id: instanceId, type } })
    : (await prisma.serviceConnection.findFirst({ where: { type, isDefault: true } }))
      ?? (await prisma.serviceConnection.findFirst({ where: { type } }));
  if (!existing) return providedApiKey;

  // If the UI sends back a masked API key, keep the stored secret.
  if (providedApiKey === maskApiKey(existing.apiKey)) {
    return existing.apiKey;
  }
  return providedApiKey;
}
