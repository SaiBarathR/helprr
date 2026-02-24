import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isNonEmptyString, isServiceType, maskApiKey, resolveApiKeyForService } from '@/lib/service-connection-secrets';

function getErrorInfo(error: unknown): { message?: string; code?: string | number; responseStatus?: number } {
  return {
    message: (error as { message?: string })?.message,
    code: (error as { code?: string | number })?.code,
    responseStatus: (error as { response?: { status?: number } })?.response?.status,
  };
}

export async function GET(): Promise<NextResponse> {
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
    console.error('Failed to fetch service connections:', getErrorInfo(error));
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
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json(
          { error: 'Invalid JSON' },
          { status: 400 }
        );
      }
      throw error;
    }

    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
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
        { error: 'type, url, and apiKey/password are required' },
        { status: 400 }
      );
    }

    if (!isServiceType(typeValue)) {
      return NextResponse.json(
        { error: 'Invalid service type' },
        { status: 400 }
      );
    }

    const type = typeValue;
    const url = urlValue.trim().replace(/\/+$/, '');
    const apiKey = apiKeyValue.trim();
    const normalizedUsername = typeof usernameValue === 'string'
      ? usernameValue.trim()
      : '';
    const username = type === 'QBITTORRENT'
      ? (normalizedUsername || 'admin')
      : type === 'JELLYFIN'
        ? (normalizedUsername || null)
        : null;

    const apiKeyToStore = await resolveApiKeyForService(type, apiKey);

    const connection = await prisma.serviceConnection.upsert({
      where: { type },
      update: {
        url,
        apiKey: apiKeyToStore,
        username,
      },
      create: {
        type,
        url,
        apiKey: apiKeyToStore,
        username,
      },
    });

    return NextResponse.json({
      ...connection,
      apiKey: maskApiKey(connection.apiKey),
    });
  } catch (error) {
    console.error('Failed to save service connection:', getErrorInfo(error));
    return NextResponse.json(
      { error: 'Failed to save service connection' },
      { status: 500 }
    );
  }
}
