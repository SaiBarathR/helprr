import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { verifyUserPassword } from '@/lib/auth';
import { LOCAL_PASSWORD_MAX_BYTES } from '@/lib/password-policy';
import {
  getClientIp,
  enforceLoginRateLimit,
  enforceUsernameBackoff,
  recordUsernameFailure,
  enforceGlobalLoginBackstop,
  recordGlobalLoginFailure,
} from '@/lib/login-rate-limit';
import { recordFailedSignIn } from '@/lib/security-audit';

/**
 * Check the signed-in user's current password behind the same throttles as
 * sign-in, counting a wrong one as a failed sign-in (as a password change
 * does). Null when it is right. The caller clears the username backoff once
 * everything it asks for has passed.
 */
export async function confirmCurrentPassword(
  request: NextRequest,
  user: Pick<User, 'id' | 'username' | 'passwordHash'>,
  currentPassword: unknown,
): Promise<NextResponse | null> {
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
  }
  if (Buffer.byteLength(currentPassword, 'utf8') > LOCAL_PASSWORD_MAX_BYTES) {
    return NextResponse.json({ error: `Password must be at most ${LOCAL_PASSWORD_MAX_BYTES} bytes` }, { status: 400 });
  }

  const limited = await enforceLoginRateLimit(getClientIp(request));
  if (limited) return limited;
  const backoff = await enforceUsernameBackoff(user.username);
  if (backoff) return backoff;
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  if (!(await verifyUserPassword(user, currentPassword))) {
    await recordUsernameFailure(user.username, currentPassword);
    await recordGlobalLoginFailure();
    await recordFailedSignIn(request, { username: user.username, method: 'password', user, actor: user });
    // 403, not 401: the client sends every 401 to /login, and the session is fine.
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
  }
  return null;
}
