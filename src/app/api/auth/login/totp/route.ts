import { NextRequest, NextResponse } from 'next/server';
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
import { clearSignedOutMarker } from '@/lib/signed-out-marker';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { LOGIN_BODY_MAX_BYTES } from '@/lib/server/login-input';
import { recordFailedSignIn, recordSecurityEvent } from '@/lib/security-audit';
import { randomUUID } from 'crypto';
import {
  claimMfaPendingToken,
  clearMfaAttempts,
  consumeSecondFactor,
  mfaLockedResponse,
  mfaPendingTokenMatches,
  readMfaPendingToken,
  secondFactorKind,
  startMfaAttempt,
} from '@/lib/totp';

const TOKEN_MAX_LENGTH = 2048;
const CODE_MAX_LENGTH = 64;
const EXPIRED = 'Your sign-in timed out. Enter your password again.';
const WRONG_CODE = 'That code didn’t work. Try again.';

function expired(): NextResponse {
  return NextResponse.json({ error: EXPIRED, mfaExpired: true }, { status: 401 });
}

/**
 * Second step of sign-in with two-step sign-in on: a pending token from
 * /api/auth/login or /api/auth/jellyfin plus an authenticator or recovery code,
 * exchanged for a session. Behind the same throttles as the first step, keyed
 * on the account, plus the code caps in totp.ts (a recovery code skips only
 * the hourly account cap); a wrong code counts as a failed sign-in.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const malformedBackstop = await enforceMalformedLoginBackstop();
  if (malformedBackstop) return malformedBackstop;

  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, LOGIN_BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return (await recordMalformedLoginRequest()) ?? response;
    throw error;
  }
  const { mfaToken, code } = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as {
    mfaToken?: unknown;
    code?: unknown;
  };
  if (
    typeof mfaToken !== 'string' || mfaToken.length === 0 || mfaToken.length > TOKEN_MAX_LENGTH
    || typeof code !== 'string' || code.trim().length === 0 || code.length > CODE_MAX_LENGTH
  ) {
    return (await recordMalformedLoginRequest()) ?? NextResponse.json({ error: 'Enter the code' }, { status: 400 });
  }

  const claims = await readMfaPendingToken(mfaToken);
  if (!claims) return (await recordMalformedLoginRequest()) ?? expired();

  const user = await prisma.user.findFirst({
    where: { id: claims.userId, status: 'active' },
    select: {
      id: true,
      username: true,
      role: true,
      passwordHash: true,
      jellyfinUserId: true,
      totpSecret: true,
      totpEnabledAt: true,
    },
  });
  // Disabled, deleted, password changed, or two-step sign-in turned off since.
  if (!user || !mfaPendingTokenMatches(claims, user)) return expired();

  const ip = getClientIp(request);
  const limited = await enforceLoginRateLimit(ip);
  if (limited) return limited;
  const backoff = await enforceUsernameBackoff(user.username);
  if (backoff) return backoff;
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  // Counted before the code is checked, so parallel guesses can't overshoot.
  let gate: Awaited<ReturnType<typeof startMfaAttempt>>;
  try {
    gate = await startMfaAttempt(user.id, secondFactorKind(code), claims);
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
  }
  if (!gate.ok) {
    // 'used': a retry after a lost response; 'spent': this token had its tries.
    return gate.reason === 'locked' ? mfaLockedResponse(gate.retryMs) : expired();
  }

  const factor = await consumeSecondFactor(user, code);
  if (!factor) {
    // A unique value: the password backoff ignores a repeated identical guess,
    // but the same six digits are a new guess every 30 seconds.
    await recordUsernameFailure(user.username, randomUUID());
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, { username: user.username, method: 'totp', user });
    return NextResponse.json({ error: WRONG_CODE }, { status: 401 });
  }

  // One sign-in per pending token, even with a second good code.
  let claimed: boolean;
  try {
    claimed = await claimMfaPendingToken(claims);
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
  }
  if (!claimed) return expired();

  await clearMfaAttempts(user.id);
  await clearUsernameBackoff(user.username);
  // A Jellyfin sign-in's failures count under the name typed there.
  if (claims.typedName && claims.typedName !== user.username) await clearUsernameBackoff(claims.typedName);
  if (ip !== undefined) {
    try {
      await clearLoginAttempts(ip);
    } catch (error) {
      console.error('[Auth] Failed to clear login attempts:', error);
      return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
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
    fields: [claims.method, factor],
  });
  if (factor === 'recovery-code') {
    await recordSecurityEvent(request, {
      actor: user,
      action: 'MFA_RECOVERY_CODE_USED',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.username,
      fields: ['sign-in'],
    });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/',
  });
  clearSignedOutMarker(response, request);

  return response;
}

export const POST = withApiLogging(postHandler, 'api/auth/login/totp', { logBodies: false });
