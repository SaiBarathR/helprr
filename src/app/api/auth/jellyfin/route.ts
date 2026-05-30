import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { getClientIp, enforceLoginRateLimit, clearLoginAttempts } from '@/lib/login-rate-limit';
import { withApiLogging } from '@/lib/api-logger';
import { isHttpsRequest } from '@/lib/request-utils';

const INVALID_CREDENTIALS = 'Invalid Jellyfin username or password';
// Distinct steering message: Jellyfin is unreachable/changed, so the user
// should fall back to their Helprr password. This route lives in its own file
// precisely so a Jellyfin outage can never take down /api/auth/login.
const JELLYFIN_UNAVAILABLE = 'Jellyfin sign-in is unavailable right now. Use your Helprr password instead.';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);

  const limited = await enforceLoginRateLimit(ip);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const username = (body as { username?: unknown })?.username;
  const password = (body as { password?: unknown })?.password;

  if (typeof username !== 'string' || username.trim() === '') {
    return NextResponse.json({ error: 'Username is required' }, { status: 400 });
  }
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const connection = await prisma.serviceConnection.findUnique({
    where: { type: 'JELLYFIN' },
    select: { url: true },
  });
  if (!connection?.url) {
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  const auth = await JellyfinClient.authenticateByName(connection.url, username.trim(), password);
  if (!auth.ok) {
    if (auth.reason === 'invalid_credentials') {
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
    }
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  // Identity is owned by Helprr: a valid Jellyfin login only counts if the admin
  // has pre-created a Helprr account linked to this Jellyfin user. No auto-provision.
  const user = await prisma.user.findFirst({
    where: { jellyfinUserId: auth.userId, status: 'active' },
    select: { id: true, role: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: 'This Jellyfin account is not linked to a Helprr profile. Ask your admin to add you.' },
      { status: 403 }
    );
  }

  if (ip !== undefined) {
    try {
      await clearLoginAttempts(ip);
    } catch (error) {
      console.error('[Auth] Failed to clear login attempts:', error);
      return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
    }
  }

  // Cache the AccessToken (non-authoritative — Helprr never re-validates against
  // it for auth). Best-effort: a write failure must not fail an otherwise-good login.
  prisma.user
    .update({ where: { id: user.id }, data: { jellyfinToken: auth.accessToken } })
    .catch((err) => console.error('[Auth] Failed to cache Jellyfin token:', err));

  const userAgent = request.headers.get('user-agent');
  const token = await createSession({ userId: user.id, role: user.role, userAgent, ip });

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });

  return response;
}

export const POST = withApiLogging(postHandler, 'api/auth/jellyfin', { logBodies: false });
