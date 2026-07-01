import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { requireAuth, requireCapability } from '@/lib/auth';
import { isNonEmptyString, isServiceType, maskApiKey, resolveApiKeyForService } from '@/lib/service-connection-secrets';
import { withApiLogging } from '@/lib/api-logger';
import { clearConnectionMemo, ensureDefaultForType, isArrType } from '@/lib/arr-instances';
import { findServiceByType } from '@/lib/settings/service-config';

function getErrorInfo(error: unknown): { message?: string; code?: string | number; responseStatus?: number } {
  return {
    message: (error as { message?: string })?.message,
    code: (error as { code?: string | number })?.code,
    responseStatus: (error as { response?: { status?: number } })?.response?.status,
  };
}

function getUpstream4xxMessage(error: unknown): string {
  const response = (error as { response?: { data?: unknown; statusText?: string } })?.response;
  const responseData = response?.data;

  if (typeof responseData === 'string' && responseData.trim()) {
    return responseData.trim();
  }

  if (responseData && typeof responseData === 'object') {
    const message = (responseData as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }

    const errorText = (responseData as { error?: unknown }).error;
    if (typeof errorText === 'string' && errorText.trim()) {
      return errorText.trim();
    }
  }

  if (typeof response?.statusText === 'string' && response.statusText.trim()) {
    return response.statusText.trim();
  }

  return 'Failed to save service connection';
}

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.instances');
  if (capError) return capError;

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
 * For `QBITTORRENT`, `username` is set to the provided value or defaults to `"admin"`.
 * For `JELLYFIN`, an admin API key is required and `username` stores the selected Jellyfin userId for user-scoped data.
 * Trailing slashes are removed from `url`.
 *
 * @returns The saved service connection object with `apiKey` obscured, or an error object `{ error: string }` when validation or saving fails (returned with an appropriate HTTP status).
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.instances');
  if (capError) return capError;

  let attemptedType: string | null = null;

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
        { error: 'type, url, and apiKey are required' },
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
    attemptedType = type;
    const url = urlValue.trim().replace(/\/+$/, '');
    const apiKey = apiKeyValue.trim();
    const normalizedUsername = typeof usernameValue === 'string'
      ? usernameValue.trim()
      : '';

    let username = type === 'QBITTORRENT'
      ? (normalizedUsername || 'admin')
      : type === 'JELLYFIN'
        ? (normalizedUsername || null)
        : null;

    const idValue = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
    const apiKeyToStore = await resolveApiKeyForService(type, apiKey, idValue);

    if (type === 'JELLYFIN') {
      const client = new JellyfinClient(url, apiKeyToStore);
      const [currentUser, hasAdminAccess] = await Promise.all([
        client.resolveCurrentUser(apiKeyToStore),
        client.hasAdminAccess(),
      ]);

      if (!currentUser) {
        return NextResponse.json(
          { error: 'Unable to resolve Jellyfin user for this API key.' },
          { status: 400 }
        );
      }

      if (!hasAdminAccess) {
        return NextResponse.json(
          { error: 'Admin Jellyfin API key required' },
          { status: 403 }
        );
      }

      const selectedUserId = normalizedUsername || currentUser.Id;

      try {
        const users = await client.getUsers();
        if (users.length > 0 && !users.some((u) => u.Id === selectedUserId)) {
          return NextResponse.json(
            { error: 'Selected Jellyfin user was not found.' },
            { status: 400 }
          );
        }
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status !== 400 && status !== 401 && status !== 403 && status !== 404) {
          throw error;
        }
      }

      username = selectedUserId;
    }

    const rawExternalUrl = body.externalUrl;
    const externalUrl = typeof rawExternalUrl === 'string' && rawExternalUrl.trim()
      ? rawExternalUrl.trim().replace(/\/+$/, '')
      : undefined;

    // Resolve the target row:
    //  - id present        → edit that exact instance
    //  - arr type, no id    → CREATE a new instance (multi-instance)
    //  - non-arr, no id     → upsert the single instance of that type
    const existing = idValue
      ? await prisma.serviceConnection.findUnique({ where: { id: idValue } })
      : isArrType(type)
        ? null
        : await prisma.serviceConnection.findFirst({ where: { type } });

    if (idValue && (!existing || existing.type !== type)) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    // Label: arr instances require a user-supplied name; single-instance types
    // default to the service's display label.
    const rawLabel = typeof body.label === 'string' ? body.label.trim() : '';
    const label = isArrType(type)
      ? (rawLabel || existing?.label || '')
      : (existing?.label || rawLabel || findServiceByType(type)?.label || type);
    if (isArrType(type) && !label) {
      return NextResponse.json({ error: 'A name is required for this instance' }, { status: 400 });
    }

    let connection;
    try {
      connection = existing
        ? await prisma.serviceConnection.update({
            where: { id: existing.id },
            data: { url, apiKey: apiKeyToStore, username, label, ...(externalUrl !== undefined && { externalUrl }) },
          })
        : await prisma.serviceConnection.create({
            data: { type, label, url, apiKey: apiKeyToStore, username, ...(externalUrl !== undefined && { externalUrl }) },
          });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return NextResponse.json({ error: `An instance named "${label}" already exists for this service` }, { status: 409 });
      }
      throw err;
    }

    await ensureDefaultForType(type);
    clearConnectionMemo();

    return NextResponse.json({
      ...connection,
      apiKey: maskApiKey(connection.apiKey),
    });
  } catch (error) {
    const responseStatus = (error as { response?: { status?: number } })?.response?.status;
    if (typeof responseStatus === 'number' && responseStatus >= 400 && responseStatus < 500) {
      const errorMessage = attemptedType === 'JELLYFIN' && responseStatus === 401
        ? 'Invalid Jellyfin API key or Jellyfin rejected token auth'
        : attemptedType !== 'JELLYFIN'
          ? getUpstream4xxMessage(error)
          : 'Failed to save service connection';
      return NextResponse.json(
        { error: errorMessage },
        { status: responseStatus }
      );
    }

    console.error('Failed to save service connection:', getErrorInfo(error));
    return NextResponse.json(
      { error: 'Failed to save service connection' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/services');
export const POST = withApiLogging(postHandler, 'api/services', { logBodies: false });
