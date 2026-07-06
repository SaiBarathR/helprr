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
} from '@/lib/login-rate-limit';
import { withApiLogging } from '@/lib/api-logger';
import { isHttpsRequest } from '@/lib/request-utils';

// Generic so a probe can't tell "no such user" from "wrong password".
const INVALID_CREDENTIALS = 'Invalid username or password';

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

  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }
  if (typeof username !== 'string' || username.trim() === '') {
    return NextResponse.json({ error: 'Username is required' }, { status: 400 });
  }

  // Layer 2: per-username backoff (always on, even without a trusted proxy IP).
  const backoff = await enforceUsernameBackoff(username);
  if (backoff) return backoff;

  // Layer 3: global failed-attempt backstop — caps brute force spread across
  // many usernames, which layers 1 (needs a trusted proxy) and 2 (per-username)
  // don't aggregate.
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  const user = await prisma.user.findFirst({
    where: { username: username.trim(), status: 'active' },
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
