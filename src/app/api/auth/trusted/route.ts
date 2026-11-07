import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
import {
  getClientIp,
  enforceLoginRateLimit,
  clearLoginAttempts,
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
const NO_NAME = 'Your sign-in proxy sent no username. Check its settings.';

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
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

  const providedSecret = request.headers.get(config.secretHeader);
  if (providedSecret === null) {
    // Reached Helprr some other way, such as its own port on the home network.
    // Before the IP bucket, so loading the login page that way spends no sign-in attempts.
    return (await recordMalformedLoginRequest()) ?? json({ error: NOT_FROM_PROXY }, 401);
  }

  const ip = getClientIp(request);
  const limited = await enforceLoginRateLimit(ip);
  if (limited) return limited;
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  const rawName = request.headers.get(config.userHeader) ?? '';
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

  const username = normalizeLocalUsername(rawName);
  if (!username) return json({ error: NO_NAME }, 403);

  // From here the proxy has vouched for the name, so nobody is guessing: the
  // per-name backoff (a password-guessing defense) neither applies nor grows.
  // The name must match exactly, as at password sign-in: a case-insensitive
  // match would let a proxy's "Admin" in as Helprr's "admin". A disabled or
  // pending account is refused, and nothing is ever created.
  const nameError = localUsernameValidationError(username);
  const user = nameError
    ? null
    : await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, role: true, status: true },
    });
  if (!user || user.status !== 'active') {
    // An overlong name is kept masked, like a typed one.
    await recordFailedSignIn(request, nameError
      ? { username, method: 'trusted-header-no-account', user: null }
      : { username, method: 'trusted-header-no-account', nameIsAccount: true });
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
  const token = await createSession({ userId: user.id, role: user.role, userAgent, ip, trustedUsername: user.username });
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
