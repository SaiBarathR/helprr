import { NextRequest, NextResponse } from 'next/server';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { prisma } from '@/lib/db';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { requireUserCapability } from '@/lib/auth';
import {
  customHeadersEnabled,
  isNonEmptyString,
  isServiceType,
  normalizeServiceUrl,
  parseCustomHeaders,
  REENTER_SECRET_MESSAGE,
  resolveApiKeyForService,
  resolveCustomHeadersForService,
  serializeConnection,
} from '@/lib/service-connection-secrets';
import { withApiLogging } from '@/lib/api-logger';
import { isRefusedRedirect, REDIRECT_REFUSED_MESSAGE } from '@/lib/redirect-guard';
import { clearConnectionMemo, ensureDefaultForType, isArrType } from '@/lib/arr-instances';
import { findServiceByType } from '@/lib/settings/service-config';
import { withDefaultScheme } from '@/lib/service-url';
import { changedFieldNames, recordSecurityEvent, serviceTargetLabel } from '@/lib/security-audit';
import { confirmAdminStepUp } from '@/lib/server/confirm-password';
import { revokeJellyfinLinkedSessions } from '@/lib/jellyfin-linked-sessions';

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
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  try {
    const connections = await prisma.serviceConnection.findMany({
      orderBy: { type: 'asc' },
    });

    return NextResponse.json(connections.map(serializeConnection));
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
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

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
    const url = withDefaultScheme(urlValue).replace(/\/+$/, '');
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
    const apiKeyToStore = await resolveApiKeyForService(type, apiKey, url, idValue);

    // Feature-gated: when disabled — or when the client doesn't send the field —
    // customHeaders is undefined, which leaves any stored value untouched. An
    // explicit {} (all rows removed in the UI) clears them.
    const customHeaders = customHeadersEnabled() && body.customHeaders !== undefined
      ? await resolveCustomHeadersForService(type, parseCustomHeaders(body.customHeaders), url, idValue)
      : undefined;
    // A mask stands for a stored secret, and saving it under another URL would
    // have every later request carry that secret there.
    if (apiKeyToStore === null || customHeaders === null) {
      return NextResponse.json({ error: REENTER_SECRET_MESSAGE }, { status: 400 });
    }

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

    // "Sign in with Jellyfin" trusts whichever server this points at, so adding
    // Jellyfin or changing its address or key is for an admin who confirms it is
    // them, whatever capabilities a member holds. A new address signs out every
    // Jellyfin-linked account (below).
    const jellyfinAddressChanged = type === 'JELLYFIN'
      && (!existing || normalizeServiceUrl(existing.url) !== normalizeServiceUrl(url));
    const jellyfinGated = jellyfinAddressChanged || (type === 'JELLYFIN' && existing?.apiKey !== apiKeyToStore);
    if (jellyfinGated && auth.user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only an admin can add Jellyfin or change its address or API key.' },
        { status: 403 }
      );
    }

    const rawExternalUrl = body.externalUrl;
    let externalUrl = typeof rawExternalUrl === 'string' && rawExternalUrl.trim()
      ? rawExternalUrl.trim().replace(/\/+$/, '')
      : undefined;
    // Jellyfin's external URL builds the "Open in Jellyfin" links everyone
    // follows, so only an admin sets it. A member's re-save may carry the stored
    // value, which is then not written, so it cannot put back an older one.
    if (type === 'JELLYFIN' && externalUrl !== undefined && auth.user.role !== 'admin') {
      if (externalUrl !== existing?.externalUrl) {
        return NextResponse.json({ error: 'Only an admin can set Jellyfin\'s external URL.' }, { status: 403 });
      }
      externalUrl = undefined;
    }

    if (type === 'JELLYFIN') {
      const client = new JellyfinClient(url, apiKeyToStore, '', customHeaders);
      const [currentUser, hasAdminAccess] = await Promise.all([
        client.resolveCurrentUser(apiKeyToStore),
        client.hasAdminAccess(),
      ]);

      // A page from a wrong path is not a user, so it must not pass as one.
      if (!currentUser || typeof currentUser.Id !== 'string') {
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

      // Which Jellyfin user the connection reads as is everyone's view, so it is
      // an admin's choice too, like the address, the key and the external URL.
      if (auth.user.role !== 'admin' && existing && selectedUserId !== existing.username) {
        return NextResponse.json(
          { error: "Only an admin can change Jellyfin's default user." },
          { status: 403 }
        );
      }

      username = selectedUserId;
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

    // Stored headers this request did not carry were entered for the old
    // address, so a URL change drops them rather than sending them to the new one.
    const headersToStore = customHeaders === undefined && existing && normalizeServiceUrl(existing.url) !== url
      ? {}
      : customHeaders;

    // Checked last, after the server answered, so a code is not used up on a
    // connection that then fails its test.
    if (jellyfinGated) {
      const stepUp = await confirmAdminStepUp(request, auth.user, body, 'jellyfin-connection', 'Changing the Jellyfin connection');
      if (stepUp) return stepUp;
    }

    const updateData = { url, apiKey: apiKeyToStore, username, label, ...(externalUrl !== undefined && { externalUrl }), ...(headersToStore !== undefined && { customHeaders: headersToStore }) };
    const createData = { type, label, url, apiKey: apiKeyToStore, username, ...(externalUrl !== undefined && { externalUrl }), ...(customHeaders !== undefined && { customHeaders }) };
    let connection;
    let jellyfinSignOut: { sessions: number; accounts: number } | null = null;
    try {
      if (type === 'JELLYFIN') {
        // Applies only to the address and key it read, as whether it needed the
        // step-up depends on them; the sign-out commits with the new address.
        const saved = await prisma.$transaction(async (tx) => ({
          connection: existing
            ? await tx.serviceConnection.update({
                where: { id: existing.id, url: existing.url, apiKey: existing.apiKey },
                data: updateData,
              })
            : await tx.serviceConnection.create({ data: createData }),
          signOut: jellyfinAddressChanged ? await revokeJellyfinLinkedSessions(tx, auth.session.id) : null,
        }));
        connection = saved.connection;
        jellyfinSignOut = saved.signOut;
      } else {
        connection = existing
          ? await prisma.serviceConnection.update({ where: { id: existing.id }, data: updateData })
          : await prisma.serviceConnection.create({ data: createData });
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return NextResponse.json({ error: `An instance named "${label}" already exists for this service` }, { status: 409 });
      }
      if ((err as { code?: string }).code === 'P2025') {
        return NextResponse.json({ error: 'This connection changed while saving. Reload and try again.' }, { status: 409 });
      }
      throw err;
    }

    const fields = existing
      ? changedFieldNames(existing, connection, ['url', 'apiKey', 'username', 'label', 'externalUrl'])
      : ['url', 'apiKey', ...(username ? ['username'] : []), ...(externalUrl ? ['externalUrl'] : [])];
    // No headers is stored as either null or {}.
    const headersOf = (value: unknown) =>
      value && typeof value === 'object' && Object.keys(value).length > 0 ? JSON.stringify(value) : null;
    if (headersOf(existing?.customHeaders) !== headersOf(connection.customHeaders)) {
      fields.push('customHeaders');
    }
    if (!existing || fields.length > 0) {
      await recordSecurityEvent(request, {
        actor: auth.user,
        action: existing ? 'SERVICE_UPDATED' : 'SERVICE_CREATED',
        targetType: 'service',
        targetId: connection.id,
        targetLabel: serviceTargetLabel(type, connection.label),
        fields,
      });
    }
    if (jellyfinSignOut && jellyfinSignOut.sessions > 0) {
      // Every Jellyfin-linked account signs in again after a new Jellyfin address.
      await recordSecurityEvent(request, {
        actor: auth.user,
        action: 'SESSION_REVOKED',
        targetType: 'service',
        targetId: connection.id,
        targetLabel: serviceTargetLabel(type, connection.label),
        fields: ['url', `accounts: ${jellyfinSignOut.accounts}`],
        count: jellyfinSignOut.sessions,
      });
    }

    await ensureDefaultForType(type);
    clearConnectionMemo();
    // As the [id] routes do: an added or re-pointed instance changes the
    // combined library, which would otherwise keep its old content for the TTL,
    // and a re-pointed one has another server's quality profile and tag names.
    if (isArrType(type)) await invalidateReferenceLabels(type.toLowerCase(), connection.id);

    return NextResponse.json(serializeConnection(connection));
  } catch (error) {
    const responseStatus = (error as { response?: { status?: number } })?.response?.status;
    if (typeof responseStatus === 'number' && responseStatus >= 400 && responseStatus < 500) {
      const errorMessage = attemptedType === 'JELLYFIN' && responseStatus === 401
        ? 'Invalid Jellyfin API key or Jellyfin rejected token auth'
        : attemptedType !== 'JELLYFIN'
          ? getUpstream4xxMessage(error)
          : 'Failed to save service connection';
      // A 401 here is the service turning the key down, not this app's session
      // ending, which is what the client takes a 401 from its own API to mean.
      return NextResponse.json(
        { error: errorMessage },
        { status: responseStatus === 401 ? 400 : responseStatus }
      );
    }

    console.error('Failed to save service connection:', getErrorInfo(error));
    if (isRefusedRedirect(error)) {
      // Not 502: a reverse proxy such as Cloudflare Tunnel replaces that with its own page.
      return NextResponse.json({ error: REDIRECT_REFUSED_MESSAGE }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed to save service connection' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/services');
export const POST = withApiLogging(postHandler, 'api/services', { logBodies: false });
