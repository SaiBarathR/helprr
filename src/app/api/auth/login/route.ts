import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, verifyUserPassword, COOKIE_NAME, SESSION_DURATION } from '@/lib/auth';
import { getDummyPasswordHash, verifyPasswordHash } from '@/lib/password';
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

// Generic so a probe can't tell "no such user" from "wrong password".
const INVALID_CREDENTIALS = 'Invalid username or password';

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
    select: { id: true, role: true, passwordHash: true },
  });

  if (!user) {
    // Spend the same scrypt work on a throwaway hash so an unknown username
    // can't be distinguished from a wrong password by response latency.
    await verifyPasswordHash(password, await getDummyPasswordHash());
    await recordUsernameFailure(username, password);
    await recordGlobalLoginFailure();
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  if (!(await verifyUserPassword(user, password))) {
    await recordUsernameFailure(username, password);
    await recordGlobalLoginFailure();
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
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

export const POST = withApiLogging(postHandler, 'api/auth/login', { logBodies: false });
