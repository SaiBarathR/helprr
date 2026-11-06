import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { COOKIE_NAME, requireUser, verifyUserPassword } from '@/lib/auth';
import { effectiveCapabilities } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { LOCAL_PASSWORD_MAX_BYTES } from '@/lib/password-policy';
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
import { isHttpsRequest } from '@/lib/request-utils';
import { recordFailedSignIn, recordSecurityEvent } from '@/lib/security-audit';
import { deleteUserUnlessLastAdmin, lockActiveAdminGuard } from '@/lib/user-deletion';

const DELETE_BODY_MAX_BYTES = 8 * 1024;

// Returns the current user's identity + fully-resolved capability map. The client
// permission provider uses this for UX gating only — the real boundary is the
// per-route requireCapability checks.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const [seerrCount, tmdbCount] = await Promise.all([
    prisma.serviceConnection.count({ where: { type: 'SEERR' } }),
    prisma.serviceConnection.count({ where: { type: 'TMDB' } }),
  ]);
  return NextResponse.json({
    id: u.id,
    name: u.displayName,
    username: u.username,
    role: u.role,
    template: u.template,
    capabilities: effectiveCapabilities(u),
    seerrConfigured: seerrCount > 0,
    tmdbConfigured: tmdbCount > 0,
    seerrUserId: u.seerrUserId,
  });
}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

const ACCOUNT_CHANGED = 'Your account changed while deleting. Reload and try again.';

/**
 * Delete the signed-in user's own account. The user comes from the session
 * only; an id in the body is ignored. A local account confirms with its current
 * password, checked behind the same throttles as sign-in (and counting toward
 * them), like a password change. A Jellyfin-only account has no Helprr password,
 * so it confirms by typing its username. The last active admin is refused.
 * The delete is the one Settings -> Users makes, so it cascades the same way;
 * the cookie is cleared, and the session went with the account.
 */
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, session } = auth;

  // JSON only: a cross-site form post can't send this content type, and a
  // cross-site fetch that does needs a preflight Helprr never grants.
  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, DELETE_BODY_MAX_BYTES);
  } catch (error) {
    const response = boundedBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('Invalid request body');
  }
  const { currentPassword, confirmUsername } = body as { currentPassword?: unknown; confirmUsername?: unknown };

  if (user.passwordHash) {
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      return badRequest('Current password is required');
    }
    if (Buffer.byteLength(currentPassword, 'utf8') > LOCAL_PASSWORD_MAX_BYTES) {
      return badRequest(`Password must be at most ${LOCAL_PASSWORD_MAX_BYTES} bytes`);
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
      // A guess at the password from a signed-in session counts as a failed sign-in.
      await recordFailedSignIn(request, { username: user.username, method: 'password', user, actor: user });
      // 403, not 401: the client sends every 401 to /login, and the session is fine.
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
    }
    await clearUsernameBackoff(user.username);
  } else if (typeof confirmUsername !== 'string' || confirmUsername.trim() !== user.username) {
    return NextResponse.json({ error: 'Type your username to confirm' }, { status: 403 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The admin guard lock before the user row, the order Settings -> Users takes them.
      if (user.role === 'admin') await lockActiveAdminGuard(tx);
      // Lock the row, and only if it is still the account just confirmed, as
      // signed in through a live session: a password change, disable, role
      // change or revoke that landed first wins, and none can land after.
      const locked = await tx.user.updateMany({
        where: {
          id: user.id,
          status: 'active',
          role: user.role,
          passwordHash: user.passwordHash,
          sessions: { some: { id: session.id, revokedAt: null } },
        },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0) return 'changed' as const;
      return (await deleteUserUnlessLastAdmin(tx, user)) ? 'deleted' as const : 'last-admin' as const;
    });
    if (result === 'changed') {
      return NextResponse.json({ error: ACCOUNT_CHANGED }, { status: 409 });
    }
    if (result === 'last-admin') {
      return NextResponse.json(
        { error: 'You are the last active admin. Make someone else an admin first.' },
        { status: 409 }
      );
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    // P2034: Postgres ended this transaction as a deadlock/write conflict. Nothing was written.
    if (code === 'P2034') {
      return NextResponse.json({ error: ACCOUNT_CHANGED }, { status: 409 });
    }
    // Name and code only: a Prisma message can echo the arguments, which here include a hash.
    const reason = error instanceof Error
      ? `${error.name}${typeof code === 'string' ? ` ${code}` : ''}`
      : 'unknown error';
    console.error(`[Auth] Account deletion failed for user ${user.id}: ${reason}`);
    return NextResponse.json({ error: 'Failed to delete your account' }, { status: 500 });
  }

  await recordSecurityEvent(request, {
    actor: user,
    action: 'USER_DELETED',
    targetType: 'user',
    targetId: user.id,
    // The actor is the target: the row reads "member · by member".
    targetLabel: user.username,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: isHttpsRequest(request, process.env.TRUST_FORWARDED_PROTO === 'true'),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export const GET = withApiLogging(getHandler, 'api/me');
export const DELETE = withApiLogging(deleteHandler, 'api/me', { logBodies: false });
