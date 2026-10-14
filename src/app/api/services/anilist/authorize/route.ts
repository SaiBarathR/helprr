import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { ANILIST_GRAPHQL_URL, buildAuthorizeUrl } from '@/lib/anilist-oauth';
import { withApiLogging } from '@/lib/api-logger';
import { resolvePublicAppOrigin } from '@/lib/request-utils';
import {
  isNonEmptyString,
  resolveApiKeyForService,
} from '@/lib/service-connection-secrets';

const STATE_COOKIE_NAME = 'helprr-anilist-oauth-state';
const STATE_COOKIE_MAX_AGE = 5 * 60; // 5 minutes

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.instances');
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { clientId, clientSecret } = body as Record<string, unknown>;
  if (!isNonEmptyString(clientId) || !isNonEmptyString(clientSecret)) {
    return NextResponse.json(
      { error: 'clientId and clientSecret are required' },
      { status: 400 }
    );
  }

  // Checked before anything is saved, so a bad APP_ORIGIN leaves no half-set-up connection.
  const origin = resolvePublicAppOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { error: 'APP_ORIGIN must be configured as a valid HTTPS origin in production' },
      { status: 500 }
    );
  }

  const trimmedClientId = clientId.trim();
  const resolvedSecret = await resolveApiKeyForService('ANILIST', clientSecret.trim(), ANILIST_GRAPHQL_URL);
  if (resolvedSecret === null) {
    return NextResponse.json({ error: 'Enter the client secret again' }, { status: 400 });
  }

  const existingAniList = await prisma.serviceConnection.findFirst({ where: { type: 'ANILIST' } });
  if (existingAniList) {
    await prisma.serviceConnection.update({
      where: { id: existingAniList.id },
      data: {
        url: ANILIST_GRAPHQL_URL,
        apiKey: resolvedSecret,
        externalUrl: trimmedClientId,
      },
    });
  } else {
    await prisma.serviceConnection.create({
      data: {
        type: 'ANILIST',
        label: 'AniList',
        url: ANILIST_GRAPHQL_URL,
        apiKey: resolvedSecret,
        externalUrl: trimmedClientId,
      },
    });
  }

  const state = randomBytes(24).toString('hex');
  const redirectUri = `${origin}/api/services/anilist/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    clientId: trimmedClientId,
    redirectUri,
    state,
  });

  const response = NextResponse.json({ authorizeUrl });
  response.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return response;
}

export const POST = withApiLogging(postHandler, 'api/services/anilist/authorize', { logBodies: false });
