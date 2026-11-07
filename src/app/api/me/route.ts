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
import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { getJellyfinClientContext } from '@/lib/service-helpers';
import { storeJellyfinToken } from '@/lib/jellyfin-token';

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
const JELLYFIN_UNAVAILABLE = 'Jellyfin is unavailable right now, so your password could not be checked. Try again in a moment.';

interface LinkedJellyfinUser {
  id: string;
  name: string;
  url: string;
}

/** The linked Jellyfin user's name, looked up by id with the admin connection; null if Jellyfin can't say. */
async function linkedJellyfinUser(jellyfinUserId: string): Promise<LinkedJellyfinUser | null> {
  try {
    const { client, connection } = await getJellyfinClientContext();
    const name = (await client.getUser(jellyfinUserId)).Name;
    return name ? { id: jellyfinUserId, name, url: connection.url } : null;
  } catch {
    return null;
  }
}

/**
 * Whether Jellyfin takes this password for the linked Jellyfin user. The name
 * was looked up by id, so the password is only ever checked as that user, and a
 * sign-in that lands on any other Jellyfin account does not count.
 */
async function verifyJellyfinPassword(
  userId: string,
  jellyfin: LinkedJellyfinUser,
  password: string,
): Promise<boolean | 'unavailable'> {
  const result = await JellyfinClient.authenticateByName(jellyfin.url, jellyfin.name, password);
  if (!result.ok) return result.reason === 'invalid_credentials' ? false : 'unavailable';
  if (result.userId !== jellyfin.id) return false;
  // Signing in replaced the playback token Helprr kept for this device; keep the
  // new one, so a delete refused after this check leaves playback working. It
  // goes with the row when the delete succeeds.
  await storeJellyfinToken(userId, result.accessToken)
    .catch(() => console.error(`[Auth] Failed to keep the Jellyfin token for user ${userId}`));
  return true;
}

/**
 * Delete the signed-in user's own account. The user comes from the session
 * only; an id in the body is ignored. A local account confirms with its current
 * password, checked behind the same throttles as sign-in (and counting toward
 * them), like a password change. A Jellyfin-only account has no Helprr password,
 * so it confirms with its Jellyfin password, checked against Jellyfin as the
 * Jellyfin user linked to the profile, behind the same throttles. The last
 * active admin is refused.
 * The delete is the one Settings -> Users makes, so it cascades the same way;
 * the cookie is cleared, and the session went with the account.
 */
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, session } = auth;
  // The install's recovery admin is re-created from APP_PASSWORD on every start,
  // so a self-delete would not stick; refuse it rather than pretend.
  if (user.id === BOOTSTRAP_ADMIN_ID && process.env.APP_PASSWORD) {
    return NextResponse.json(
      { error: "This is the install's recovery admin (APP_PASSWORD); it is re-created on restart and can't be deleted here." },
      { status: 409 },
    );
  }

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
  const { currentPassword } = body as { currentPassword?: unknown };
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return badRequest('Current password is required');
  }
  if (Buffer.byteLength(currentPassword, 'utf8') > LOCAL_PASSWORD_MAX_BYTES) {
    return badRequest(`Password must be at most ${LOCAL_PASSWORD_MAX_BYTES} bytes`);
  }
  // No Helprr password and no Jellyfin link: nothing can confirm it is them.
  if (!user.passwordHash && !user.jellyfinUserId) {
    return NextResponse.json({ error: 'This account has no password to confirm with. Ask an admin to delete it.' }, { status: 409 });
  }

  const limited = await enforceLoginRateLimit(getClientIp(request));
  if (limited) return limited;
  const backoff = await enforceUsernameBackoff(user.username);
  if (backoff) return backoff;
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  let jellyfin: LinkedJellyfinUser | null = null;
  if (!user.passwordHash) {
    jellyfin = await linkedJellyfinUser(user.jellyfinUserId!);
    if (!jellyfin) return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
    // Also the Jellyfin name's bucket, which Jellyfin sign-in counts in, so
    // guesses here and there share one limit.
    const jellyfinBackoff = await enforceUsernameBackoff(jellyfin.name);
    if (jellyfinBackoff) return jellyfinBackoff;
  }
  // Names whose backoff this check counts toward (one when they share a bucket).
  const backoffNames = [...new Set([user.username, ...(jellyfin ? [jellyfin.name] : [])]
    .map((name) => name.trim().toLowerCase()))];

  const confirmed = jellyfin
    ? await verifyJellyfinPassword(user.id, jellyfin, currentPassword)
    : await verifyUserPassword(user, currentPassword);
  if (confirmed === 'unavailable') {
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }
  if (!confirmed) {
    for (const name of backoffNames) await recordUsernameFailure(name, currentPassword);
    await recordGlobalLoginFailure();
    // A guess at the password from a signed-in session counts as a failed sign-in.
    await recordFailedSignIn(request, {
      username: user.username,
      method: user.passwordHash ? 'password' : 'jellyfin',
      user,
      actor: user,
    });
    // 403, not 401: the client sends every 401 to /login, and the session is fine.
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
  }
  for (const name of backoffNames) await clearUsernameBackoff(name);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The admin guard lock before the user row, the order Settings -> Users takes them.
      if (user.role === 'admin') await lockActiveAdminGuard(tx);
      // Lock the row, and only if it is still the account just confirmed, as
      // signed in through a live session: a password change, Jellyfin relink,
      // disable, role change or revoke that landed first wins, and none can land after.
      const locked = await tx.user.updateMany({
        where: {
          id: user.id,
          status: 'active',
          role: user.role,
          passwordHash: user.passwordHash,
          jellyfinUserId: user.jellyfinUserId,
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
