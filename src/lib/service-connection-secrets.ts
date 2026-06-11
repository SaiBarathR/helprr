import type { ServiceType } from '@prisma/client';
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

export async function resolveApiKeyForService(
  type: ServiceType,
  providedApiKey: string,
  instanceId?: string
): Promise<string> {
  const existing = instanceId
    ? await prisma.serviceConnection.findUnique({ where: { id: instanceId } })
    : (await prisma.serviceConnection.findFirst({ where: { type, isDefault: true } }))
      ?? (await prisma.serviceConnection.findFirst({ where: { type } }));
  if (!existing) return providedApiKey;

  // If the UI sends back a masked API key, keep the stored secret.
  if (providedApiKey === maskApiKey(existing.apiKey)) {
    return existing.apiKey;
  }
  return providedApiKey;
}
