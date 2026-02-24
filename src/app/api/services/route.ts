import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isServiceType, maskApiKey, resolveApiKeyForService } from '@/lib/service-connection-secrets';

export async function GET() {
  try {
    const connections = await prisma.serviceConnection.findMany({
      orderBy: { type: 'asc' },
    });

    const masked = connections.map((conn) => ({
      ...conn,
      apiKey: maskApiKey(conn.apiKey),
    }));

    return NextResponse.json(masked);
  } catch (error) {
    console.error('Failed to fetch service connections:', error);
    return NextResponse.json(
      { error: 'Failed to fetch service connections' },
      { status: 500 }
    );
  }
}

/**
 * Create or update a service connection from the request body and return the stored connection with its `apiKey` masked.
 *
 * Validates that `type`, `url`, and `apiKey` are present and that `type` is one of `SONARR`, `RADARR`, `QBITTORRENT`, `PROWLARR`, `JELLYFIN`, or `TMDB`.
 * For `QBITTORRENT`, `username` is set to the provided value or defaults to `"admin"`. Trailing slashes are removed from `url`.
 *
 * @returns The saved service connection object with `apiKey` obscured, or an error object `{ error: string }` when validation or saving fails (returned with an appropriate HTTP status).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, url, apiKey, username } = body;

    if (!type || !url || !apiKey) {
      return NextResponse.json(
        { error: 'type, url, and apiKey/password are required' },
        { status: 400 }
      );
    }

    if (typeof type !== 'string' || !isServiceType(type)) {
      return NextResponse.json(
        { error: 'Invalid service type' },
        { status: 400 }
      );
    }

    const apiKeyToStore = await resolveApiKeyForService(type, apiKey);

    const connection = await prisma.serviceConnection.upsert({
      where: { type },
      update: {
        url: url.replace(/\/+$/, ''),
        apiKey: apiKeyToStore,
        username: type === 'QBITTORRENT' ? (username || 'admin') : type === 'JELLYFIN' ? username : null,
      },
      create: {
        type,
        url: url.replace(/\/+$/, ''),
        apiKey: apiKeyToStore,
        username: type === 'QBITTORRENT' ? (username || 'admin') : type === 'JELLYFIN' ? username : null,
      },
    });

    return NextResponse.json({
      ...connection,
      apiKey: maskApiKey(connection.apiKey),
    });
  } catch (error) {
    console.error('Failed to save service connection:', error);
    return NextResponse.json(
      { error: 'Failed to save service connection' },
      { status: 500 }
    );
  }
}
