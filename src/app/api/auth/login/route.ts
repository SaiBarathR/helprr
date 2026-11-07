import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, verifyUserPassword, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
import {
  getDummyPasswordHash,
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPasswordHash,
} from '@/lib/password';
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
import { readLoginCredentials } from '@/lib/server/login-input';
import { recordFailedSignIn, recordSecurityEvent } from '@/lib/security-audit';
import { createMfaPendingToken, isTotpEnabled } from '@/lib/totp';

// Generic so a probe can't tell "no such user" from "wrong password".
const INVALID_CREDENTIALS = 'Invalid username or password';

/**
 * Store a current-policy hash after a hash with older scrypt parameters has
 * just been verified. Only replaces the exact hash that was verified, so a
 * password change made meanwhile is never overwritten. Best effort: login
 * succeeds whether or not the write does. Returns the hash stored, or null.
 */
async function upgradePasswordHash(userId: string, verifiedHash: string, password: string): Promise<string | null> {
  try {
    const passwordHash = await hashPassword(password);
    const updated = await prisma.user.updateMany({
      where: { id: userId, passwordHash: verifiedHash },
      data: { passwordHash },
    });
    return updated.count === 1 ? passwordHash : null;
  } catch (error) {
    // Name and code only: a Prisma validation message can echo the arguments,
    // which here are password hashes.
    const code = (error as { code?: unknown } | null)?.code;
    const reason = error instanceof Error
      ? `${error.name}${typeof code === 'string' ? ` ${code}` : ''}`
      : 'unknown error';
    console.error(`[Auth] Password hash upgrade failed for user ${userId}: ${reason}`);
    return null;
  }
}

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

  // Layer 2: per-username backoff (always on, even without a trusted proxy IP).
  const backoff = await enforceUsernameBackoff(username);
  if (backoff) return backoff;

  // Layer 3: global failed-attempt backstop — caps brute force spread across
  // many usernames, which layers 1 (needs a trusted proxy) and 2 (per-username)
  // don't aggregate.
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  const user = await prisma.user.findFirst({
    where: { username, status: 'active' },
    select: { id: true, username: true, role: true, passwordHash: true, jellyfinUserId: true, totpEnabledAt: true },
  });

  if (!user) {
    // Spend the same scrypt work on a throwaway hash so an unknown username
    // can't be distinguished from a wrong password by response latency.
    await verifyPasswordHash(password, await getDummyPasswordHash());
    await recordUsernameFailure(username, password);
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, { username, method: 'password', user: null });
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  if (!(await verifyUserPassword(user, password))) {
    await recordUsernameFailure(username, password);
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, { username, method: 'password', user });
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  // With two-step sign-in on, the throttles are cleared only once the code
  // passes too, so knowing the password never resets them between code guesses.
  const mfa = isTotpEnabled(user);
  if (!mfa) await clearUsernameBackoff(username);

  let passwordHash = user.passwordHash;
  if (user.passwordHash && passwordHashNeedsUpgrade(user.passwordHash)) {
    passwordHash = (await upgradePasswordHash(user.id, user.passwordHash, password)) ?? passwordHash;
  }

  if (mfa) {
    // Not a session: /api/auth/login/totp exchanges it, with a code, for one.
    const mfaToken = await createMfaPendingToken({ ...user, passwordHash }, 'password');
    return NextResponse.json({ mfaRequired: true, mfaToken }, { headers: { 'Cache-Control': 'no-store' } });
  }

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
    fields: ['password'],
  });

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

export const POST = withApiLogging(postHandler, 'api/auth/login', { logBodies: false });
