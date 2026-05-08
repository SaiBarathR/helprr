import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ANILIST_GRAPHQL_URL, buildAuthorizeUrl } from '@/lib/anilist-oauth';
import {
  isNonEmptyString,
  resolveApiKeyForService,
} from '@/lib/service-connection-secrets';

const STATE_COOKIE_NAME = 'helprr-anilist-oauth-state';
const STATE_COOKIE_MAX_AGE = 5 * 60; // 5 minutes

function originFromRequest(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

function trustedOrigin(request: NextRequest): string | null {
  if (process.env.NODE_ENV !== 'production') return originFromRequest(request);
  const configured = process.env.APP_ORIGIN;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

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

  const trimmedClientId = clientId.trim();
  const resolvedSecret = await resolveApiKeyForService('ANILIST', clientSecret.trim());

  await prisma.serviceConnection.upsert({
    where: { type: 'ANILIST' },
    update: {
      url: ANILIST_GRAPHQL_URL,
      apiKey: resolvedSecret,
      externalUrl: trimmedClientId,
    },
    create: {
      type: 'ANILIST',
      url: ANILIST_GRAPHQL_URL,
      apiKey: resolvedSecret,
      externalUrl: trimmedClientId,
    },
  });

  const origin = trustedOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { error: 'APP_ORIGIN must be configured as a valid HTTPS origin in production' },
      { status: 500 }
    );
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
