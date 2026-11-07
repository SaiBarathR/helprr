import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { createSession, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
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
import { recordFailedSignIn, recordSecurityEvent } from '@/lib/security-audit';
import { getTrustedAuthConfig, trustedAuthSecretMatches } from '@/lib/trusted-auth';
import { localUsernameValidationError, normalizeLocalUsername } from '@/lib/username-policy';

// Trusted-header sign-in (see trusted-auth.ts and the HTTPS guide). The login
// page asks GET whether it is on, then POSTs once. Two-step sign-in is not
// asked for here: the proxy's own sign-in is the second factor.

const NO_STORE = { 'Cache-Control': 'no-store' };
// Missing and wrong secret look the same, so a probe learns nothing; the login
// page treats this as "not through the proxy" and shows the normal form.
const NOT_FROM_PROXY = 'This request did not come through the sign-in proxy';
const NO_ACCOUNT = 'Your sign-in proxy named no active Helprr account. Ask whoever runs Helprr to add you.';

const USER_SELECT = { id: true, username: true, role: true, status: true } as const;

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * The account the proxy named: an exact username first, else the one account
 * whose name matches ignoring case. Two names differing only in case make the
 * folded match ambiguous, so neither is used. A disabled or pending account is
 * never signed in, and nothing is ever created.
 */
async function findNamedUser(username: string) {
  const exact = await prisma.user.findUnique({ where: { username }, select: USER_SELECT });
  if (exact) return exact.status === 'active' ? exact : null;
  const folded = await prisma.user.findMany({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: USER_SELECT,
    take: 2,
  });
  return folded.length === 1 && folded[0].status === 'active' ? folded[0] : null;
}

async function getHandler(): Promise<NextResponse> {
  return json({ enabled: getTrustedAuthConfig() !== null });
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const config = getTrustedAuthConfig();
  if (!config) return json({ error: 'Not found' }, 404);

  const malformedBackstop = await enforceMalformedLoginBackstop();
  if (malformedBackstop) return malformedBackstop;

  // CSRF: a JSON content type cannot be sent cross-origin without a CORS
  // preflight, which Helprr never grants, and browsers that say where a request
  // came from must say this origin.
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const fetchSite = request.headers.get('sec-fetch-site');
  if (contentType !== 'application/json' || (fetchSite !== null && fetchSite !== 'same-origin')) {
    return (await recordMalformedLoginRequest()) ?? json({ error: 'Forbidden' }, 403);
  }

  const ip = getClientIp(request);
  const limited = await enforceLoginRateLimit(ip);
  if (limited) return limited;
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  const providedSecret = request.headers.get(config.secretHeader);
  const rawName = request.headers.get(config.userHeader) ?? '';
  if (providedSecret === null) {
    // Reached Helprr some other way, such as its own port on the home network.
    return (await recordMalformedLoginRequest()) ?? json({ error: NOT_FROM_PROXY }, 401);
  }
  if (!trustedAuthSecretMatches(config, providedSecret)) {
    // Someone sent the header without knowing the secret: count it like a wrong password.
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, {
      username: normalizeLocalUsername(rawName),
      method: 'trusted-header-secret',
      user: null,
    });
    return json({ error: NOT_FROM_PROXY }, 401);
  }

  if (localUsernameValidationError(rawName)) {
    return json({ error: NO_ACCOUNT }, 403);
  }
  const username = normalizeLocalUsername(rawName);

  const backoff = await enforceUsernameBackoff(username);
  if (backoff) return backoff;

  const user = await findNamedUser(username);
  if (!user) {
    // The proxy vouched for the name, so this is not guessing: only that name backs off.
    await recordUsernameFailure(username, randomUUID());
    await recordFailedSignIn(request, { username, method: 'trusted-header-no-account', nameIsAccount: true });
    return json({ error: NO_ACCOUNT }, 403);
  }

  await clearUsernameBackoff(username);
  if (ip !== undefined) {
    try {
      await clearLoginAttempts(ip);
    } catch (error) {
      console.error('[Auth] Failed to clear login attempts:', error);
      return json({ error: 'Login service unavailable' }, 503);
    }
  }

  const userAgent = request.headers.get('user-agent');
  const token = await createSession({ userId: user.id, role: user.role, userAgent, ip });
  await recordSecurityEvent(request, {
    actor: user,
    action: 'LOGIN_SUCCEEDED',
    targetType: 'user',
    targetId: user.id,
    targetLabel: user.username,
    fields: ['trusted-header'],
  });

  const response = json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });
  return response;
}

export const GET = withApiLogging(getHandler, 'api/auth/trusted');
export const POST = withApiLogging(postHandler, 'api/auth/trusted', { logBodies: false });
