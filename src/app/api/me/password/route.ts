import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser, verifyUserPassword } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { LOCAL_PASSWORD_MAX_BYTES, localPasswordValidationError } from '@/lib/password-policy';
import {
  getClientIp,
  enforceLoginRateLimit,
  enforceUsernameBackoff,
  recordUsernameFailure,
  clearUsernameBackoff,
  enforceGlobalLoginBackstop,
  recordGlobalLoginFailure,
} from '@/lib/login-rate-limit';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { withApiLogging } from '@/lib/api-logger';

const BODY_MAX_BYTES = 8 * 1024;

class SessionEndedError extends Error {}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * Change the signed-in user's own password. The current password is checked
 * behind the same throttles as sign-in (and counts toward them), so a stolen
 * session cookie can't be used to guess it. Every other session of the user is
 * revoked; this one stays signed in.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, session } = auth;

  // JSON only: a cross-site form post can't send this content type, and a
  // cross-site fetch that does needs a preflight Helprr never grants.
  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('Invalid request body');
  }
  const { currentPassword, newPassword } = body as { currentPassword?: unknown; newPassword?: unknown };
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return badRequest('Current password is required');
  }
  if (Buffer.byteLength(currentPassword, 'utf8') > LOCAL_PASSWORD_MAX_BYTES) {
    return badRequest(`Password must be at most ${LOCAL_PASSWORD_MAX_BYTES} bytes`);
  }
  if (typeof newPassword !== 'string') {
    return badRequest('New password is required');
  }
  const newPasswordError = localPasswordValidationError(newPassword);
  if (newPasswordError) return badRequest(newPasswordError);

  if (!user.passwordHash) {
    return NextResponse.json(
      { error: 'This account signs in with Jellyfin and has no Helprr password to change' },
      { status: 409 }
    );
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
    // 403, not 401: the client sends every 401 to /login, and the session is fine.
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
  }
  await clearUsernameBackoff(user.username);

  const verifiedHash = user.passwordHash;
  const passwordHash = await hashPassword(newPassword);
  try {
    // User row first, then sessions: the same lock order as Settings -> Users,
    // so two concurrent changes queue instead of deadlocking.
    const result = await prisma.$transaction(async (tx) => {
      // Only replace the hash just verified, so a change made meanwhile is never overwritten.
      const updated = await tx.user.updateMany({
        where: { id: user.id, status: 'active', passwordHash: verifiedHash },
        data: { passwordHash },
      });
      if (updated.count === 0) return { ok: false as const };
      // A revoke of this session that landed first wins: roll the new hash back.
      const live = await tx.session.updateMany({
        where: { id: session.id, userId: user.id, revokedAt: null },
        data: { lastSeenAt: new Date() },
      });
      if (live.count === 0) throw new SessionEndedError();
      const revoked = await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: session.id } },
        data: { revokedAt: new Date() },
      });
      return { ok: true as const, revoked: revoked.count };
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Your account changed while saving. Reload and try again.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ revokedSessions: result.revoked });
  } catch (error) {
    if (error instanceof SessionEndedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Name and code only: a Prisma message can echo the arguments, which here include a hash.
    const code = (error as { code?: unknown } | null)?.code;
    const reason = error instanceof Error
      ? `${error.name}${typeof code === 'string' ? ` ${code}` : ''}`
      : 'unknown error';
    console.error(`[Auth] Password change failed for user ${user.id}: ${reason}`);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/me/password', { logBodies: false });
