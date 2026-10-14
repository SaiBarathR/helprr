import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import {
  exchangeCodeForToken,
  loadAniListConnection,
  persistTokenResponse,
  setAniListConnectionMetadata,
} from '@/lib/anilist-oauth';
import { fetchViewer } from '@/lib/anilist-mutations';
import { withApiLogging } from '@/lib/api-logger';
import { resolvePublicAppOrigin } from '@/lib/request-utils';

const STATE_COOKIE_NAME = 'helprr-anilist-oauth-state';

const ORIGIN_NOT_CONFIGURED = 'APP_ORIGIN must be configured as a valid HTTPS origin in production';

function settingsRedirect(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL('/settings', origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE_NAME);
  return response;
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // Same capability as starting the flow: the callback replaces (or, on a
  // failed exchange, clears) the one shared AniList connection, and its state
  // check alone cannot stop a member who sets their own state cookie.
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  // Every redirect and the token exchange use the configured origin, never one
  // built from Host or X-Forwarded-* headers.
  const origin = resolvePublicAppOrigin(request);
  if (!origin) {
    const response = NextResponse.json({ error: ORIGIN_NOT_CONFIGURED }, { status: 500 });
    response.cookies.delete(STATE_COOKIE_NAME);
    return response;
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const oauthError = request.nextUrl.searchParams.get('error');

  if (oauthError) {
    return settingsRedirect(origin, { anilist: 'error', reason: 'denied' });
  }

  const expectedState = request.cookies.get(STATE_COOKIE_NAME)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return settingsRedirect(origin, { anilist: 'error', reason: 'state_mismatch' });
  }

  if (!code) {
    return settingsRedirect(origin, { anilist: 'error', reason: 'missing_code' });
  }

  const conn = await loadAniListConnection();
  if (!conn) {
    return settingsRedirect(origin, { anilist: 'error', reason: 'not_configured' });
  }

  const redirectUri = `${origin}/api/services/anilist/callback`;
  let viewerUnavailable = false;

  try {
    const token = await exchangeCodeForToken({
      clientId: conn.clientId,
      clientSecret: conn.clientSecret,
      redirectUri,
      code,
    });
    await persistTokenResponse(token);

    try {
      const viewer = await fetchViewer();
      await setAniListConnectionMetadata({
        username: viewer.name ?? null,
        anilistUserId: viewer.id,
        avatar: viewer.avatar?.large ?? viewer.avatar?.medium ?? undefined,
        siteUrl: viewer.siteUrl ?? undefined,
        scoreFormat: viewer.mediaListOptions?.scoreFormat ?? undefined,
      });
    } catch (viewerError) {
      console.error('AniList viewer fetch failed after token exchange', viewerError);
      viewerUnavailable = true;
    }

    return settingsRedirect(origin, {
      anilist: 'connected',
      ...(viewerUnavailable ? { reason: 'viewer_unavailable' } : {}),
    });
  } catch (error) {
    console.error('AniList token exchange failed', error);
    // Clear any tokens that may exist from a previous attempt
    await prisma.serviceConnection.updateMany({
      where: { type: 'ANILIST' },
      data: { accessToken: null, refreshToken: null, tokenExpiresAt: null, metadata: {}, username: null },
    }).catch(() => undefined);
    return settingsRedirect(origin, { anilist: 'error', reason: 'exchange_failed' });
  }
}

export const GET = withApiLogging(getHandler, 'api/services/anilist/callback', { logBodies: false });
