import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
import { JellyfinClient } from '@/lib/jellyfin-client';
import {
  getClientIp,
  enforceLoginRateLimit,
  clearLoginAttempts,
  enforceUsernameBackoff,
  recordUsernameFailure,
  clearUsernameBackoff,
  enforceGlobalLoginBackstop,
  recordGlobalLoginFailure,
  enforceMalformedLoginBackstop,
  recordMalformedLoginRequest,
} from '@/lib/login-rate-limit';
import { withApiLogging } from '@/lib/api-logger';
import { isHttpsRequest } from '@/lib/request-utils';
import { readLoginCredentials } from '@/lib/server/login-input';
import { storeJellyfinToken } from '@/lib/jellyfin-token';
import { recordFailedSignIn, recordSecurityEvent } from '@/lib/security-audit';
import { createMfaPendingToken, isTotpEnabled } from '@/lib/totp';

const INVALID_CREDENTIALS = 'Invalid Jellyfin username or password';
// Distinct steering message: Jellyfin is unreachable/changed, so the user
// should fall back to their Helprr password. This route lives in its own file
// precisely so a Jellyfin outage can never take down /api/auth/login.
const JELLYFIN_UNAVAILABLE = 'Jellyfin sign-in is unavailable right now. Use your Helprr password instead.';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const malformedBackstop = await enforceMalformedLoginBackstop();
  if (malformedBackstop) return malformedBackstop;

  const input = await readLoginCredentials(request);
  if (!input.ok) {
    return (await recordMalformedLoginRequest()) ?? input.response;
  }
  const { username, password } = input.credentials;
  const ip = getClientIp(request);

  const limited = await enforceLoginRateLimit(ip);
  if (limited) return limited;

  // Layer 2: per-username backoff (shared key with /api/auth/login so an attacker
  // can't alternate endpoints to dodge the cap).
  const backoff = await enforceUsernameBackoff(username);
  if (backoff) return backoff;

  // Layer 3: global failed-attempt backstop (shared key with /api/auth/login).
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'JELLYFIN' },
    select: { url: true },
  });
  if (!connection?.url) {
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  const auth = await JellyfinClient.authenticateByName(connection.url, username, password);
  if (!auth.ok) {
    if (auth.reason === 'invalid_credentials') {
      // Only a wrong password counts toward backoff — a Jellyfin outage (502) is
      // not a guess and must not throttle the user out.
      await recordUsernameFailure(username, password);
      await recordGlobalLoginFailure();
      await recordFailedSignIn(request, { username, method: 'jellyfin' });
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
    }
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  // Identity is owned by Helprr: a valid Jellyfin login only counts if the admin
  // has pre-created a Helprr account linked to this Jellyfin user. No auto-provision.
  const user = await prisma.user.findFirst({
    where: { jellyfinUserId: auth.userId, status: 'active' },
    select: { id: true, username: true, role: true, passwordHash: true, jellyfinUserId: true, totpEnabledAt: true },
  });
  if (!user) {
    // A real Jellyfin login Helprr refused: not a guess, so no backoff, but still an attempt.
    await recordFailedSignIn(request, { username, method: 'jellyfin-unlinked', nameIsAccount: true });
    return NextResponse.json(
      { error: 'This Jellyfin account is not linked to a Helprr profile. Ask your admin to add you.' },
      { status: 403 }
    );
  }

  if (isTotpEnabled(user)) {
    // Two-step sign-in applies here too. The throttles stay until the code
    // passes. The Jellyfin token is still kept: it is the member's own Jellyfin
    // credential, minted just now with their Jellyfin password, and never signs
    // anyone in to Helprr (see below).
    storeJellyfinToken(user.id, auth.accessToken)
      .catch((err) => console.error('[Auth] Failed to cache Jellyfin token:', err));
    const mfaToken = await createMfaPendingToken(user, 'jellyfin', username);
    return NextResponse.json({ mfaRequired: true, mfaToken }, { headers: { 'Cache-Control': 'no-store' } });
  }

  await clearUsernameBackoff(username);

  if (ip !== undefined) {
    try {
      await clearLoginAttempts(ip);
    } catch (error) {
      console.error('[Auth] Failed to clear login attempts:', error);
      return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
    }
  }

  // Store the AccessToken encrypted. It is never an *auth* credential — Helprr
  // owns identity and never re-validates a session against it — but it is the
  // credential playback runs on, so signing in here is also what connects the
  // member's Jellyfin account. Best-effort: a write failure must not fail an
  // otherwise-good login; the member just gets asked to connect on the watch screen.
  storeJellyfinToken(user.id, auth.accessToken)
    .catch((err) => console.error('[Auth] Failed to cache Jellyfin token:', err));

  const userAgent = request.headers.get('user-agent');
  const token = await createSession({ userId: user.id, role: user.role, userAgent, ip });
  await recordSecurityEvent(request, {
    actor: user,
    action: 'LOGIN_SUCCEEDED',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.username,
    fields: ['jellyfin'],
  });

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
