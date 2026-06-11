import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import {
  exchangeCodeForToken,
  loadAniListConnection,
  persistTokenResponse,
  setAniListConnectionMetadata,
} from '@/lib/anilist-oauth';
import { fetchViewer } from '@/lib/anilist-mutations';
import { withApiLogging } from '@/lib/api-logger';

const STATE_COOKIE_NAME = 'helprr-anilist-oauth-state';

function originFromRequest(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

function settingsRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/settings', originFromRequest(request));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE_NAME);
  return response;
}

function trustedOrigin(request: NextRequest): string {
  if (process.env.NODE_ENV !== 'production') return originFromRequest(request);
  const configured = process.env.APP_ORIGIN;
  if (!configured) return originFromRequest(request);
  try {
    return new URL(configured).origin;
  } catch {
    return originFromRequest(request);
  }
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const oauthError = request.nextUrl.searchParams.get('error');

  if (oauthError) {
    return settingsRedirect(request, { anilist: 'error', reason: 'denied' });
  }

  const expectedState = request.cookies.get(STATE_COOKIE_NAME)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return settingsRedirect(request, { anilist: 'error', reason: 'state_mismatch' });
  }

  if (!code) {
    return settingsRedirect(request, { anilist: 'error', reason: 'missing_code' });
  }

  const conn = await loadAniListConnection();
  if (!conn) {
    return settingsRedirect(request, { anilist: 'error', reason: 'not_configured' });
  }

  const redirectUri = `${trustedOrigin(request)}/api/services/anilist/callback`;
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

    return settingsRedirect(request, {
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
    return settingsRedirect(request, { anilist: 'error', reason: 'exchange_failed' });
  }
}

export const GET = withApiLogging(getHandler, 'api/services/anilist/callback', { logBodies: false });
