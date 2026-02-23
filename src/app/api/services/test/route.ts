import { NextRequest, NextResponse } from 'next/server';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';
import { prisma } from '@/lib/db';

const SERVICE_TYPES = ['SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB'] as const;
type ServiceType = typeof SERVICE_TYPES[number];

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

async function resolveApiKeyForTest(type: ServiceType, providedApiKey: string): Promise<string> {
  const existing = await prisma.serviceConnection.findUnique({ where: { type } });
  if (!existing) return providedApiKey;

  // If the UI sent back the masked value from GET /api/services, use the stored secret.
  if (providedApiKey === maskApiKey(existing.apiKey)) {
    return existing.apiKey;
  }

  return providedApiKey;
}

/**
 * Handle POST requests to check connectivity and retrieve version information from supported services.
 *
 * Expects the request body to be JSON with fields: `type` (one of `"SONARR"|"RADARR"|"QBITTORRENT"|"PROWLARR"|"JELLYFIN"|"TMDB"`),
 * `url` (service base URL), `apiKey` (API key or password), and optional `username` (used for qBittorrent).
 *
 * @param request - Incoming NextRequest whose JSON body contains the service check parameters
 * @returns An object with `success` boolean and, on success, `version` (string); on failure, `error` (string)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, url, apiKey, username } = body;

    if (!type || !url || !apiKey) {
      return NextResponse.json(
        { success: false, error: 'type, url, and apiKey/password are required' },
        { status: 400 }
      );
    }

    if (!SERVICE_TYPES.includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid service type' },
        { status: 400 }
      );
    }

    const resolvedApiKey = await resolveApiKeyForTest(type, apiKey);
    const cleanUrl = url.replace(/\/+$/, '');

    switch (type) {
      case 'SONARR': {
        const client = new SonarrClient(cleanUrl, resolvedApiKey);
        const status = await client.getSystemStatus();
        return NextResponse.json({
          success: true,
          version: status.version,
        });
      }

      case 'RADARR': {
        const client = new RadarrClient(cleanUrl, resolvedApiKey);
        const status = await client.getSystemStatus();
        return NextResponse.json({
          success: true,
          version: status.version,
        });
      }

      case 'QBITTORRENT': {
        const client = new QBittorrentClient(cleanUrl, resolvedApiKey, username || 'admin');
        const version = await client.getVersion();
        return NextResponse.json({
          success: true,
          version,
        });
      }

      case 'PROWLARR': {
        const client = new ProwlarrClient(cleanUrl, resolvedApiKey);
        const status = await client.getSystemStatus();
        return NextResponse.json({
          success: true,
          version: status.version,
        });
      }

      case 'JELLYFIN': {
        const authResult = await JellyfinClient.authenticate(cleanUrl, username || '', resolvedApiKey);
        const token = authResult.AccessToken;
        const userId = authResult.User.Id;
        const client = new JellyfinClient(cleanUrl, token, userId);
        const sysInfo = await client.getSystemInfo();
        return NextResponse.json({
          success: true,
          version: sysInfo.Version,
          serverName: sysInfo.ServerName,
          token,
          userId,
        });
      }

      case 'TMDB': {
        const client = new TmdbClient(cleanUrl, resolvedApiKey);
        await client.validateConnection();
        return NextResponse.json({
          success: true,
          version: 'API reachable',
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid service type' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Service connection test failed:', error);
    return NextResponse.json(
      { success: false, error: 'Connection test failed' },
      { status: 502 }
    );
  }
}
