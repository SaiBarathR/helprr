import { NextRequest, NextResponse } from 'next/server';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { ProwlarrClient } from '@/lib/prowlarr-client';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { TmdbClient } from '@/lib/tmdb-client';
import { isServiceType, resolveApiKeyForService } from '@/lib/service-connection-secrets';
import type { ServiceType } from '@prisma/client';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json(
          { success: false, error: 'Invalid JSON' },
          { status: 400 }
        );
      }
      throw error;
    }

    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request body' },
        { status: 400 }
      );
    }
    const body = rawBody as Record<string, unknown>;
    const typeValue = body.type;
    const urlValue = body.url;
    const apiKeyValue = body.apiKey;
    const usernameValue = body.username;

    if (!isNonEmptyString(typeValue) || !isNonEmptyString(urlValue) || !isNonEmptyString(apiKeyValue)) {
      return NextResponse.json(
        { success: false, error: 'type, url, and apiKey/password are required' },
        { status: 400 }
      );
    }

    if (!isServiceType(typeValue)) {
      return NextResponse.json(
        { success: false, error: 'Invalid service type' },
        { status: 400 }
      );
    }

    const type: ServiceType = typeValue;
    const url = urlValue.trim();
    const apiKey = apiKeyValue.trim();
    const username = typeof usernameValue === 'string'
      ? (usernameValue.trim() || undefined)
      : undefined;

    const resolvedApiKey = await resolveApiKeyForService(type, apiKey);
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
    const message = (error as { message?: string })?.message;
    const code = (error as { code?: string | number })?.code;
    const responseStatus = (error as { response?: { status?: number } })?.response?.status;
    console.error('Service connection test failed:', {
      message,
      code,
      responseStatus,
    });
    return NextResponse.json(
      { success: false, error: 'Connection test failed' },
      { status: 502 }
    );
  }
}
