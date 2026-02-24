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
  return ['SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB'].includes(
    value
  );
}

export async function resolveApiKeyForService(
  type: ServiceType,
  providedApiKey: string
): Promise<string> {
  const existing = await prisma.serviceConnection.findUnique({ where: { type } });
  if (!existing) return providedApiKey;

  // If UI sends a masked API key from the connections API, keep the stored secret.
  if (providedApiKey === maskApiKey(existing.apiKey)) {
    return existing.apiKey;
  }

  return providedApiKey;
}
