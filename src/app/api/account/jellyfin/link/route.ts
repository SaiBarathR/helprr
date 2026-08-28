import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { JellyfinClient } from '@/lib/jellyfin-client';
import { storeJellyfinToken, invalidateJellyfinToken } from '@/lib/jellyfin-token';
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
import { readLoginCredentials } from '@/lib/server/login-input';

/**
 * Connect the signed-in member's own Jellyfin account.
 *
 * Playback runs on the member's Jellyfin token, not the admin API key: Jellyfin
 * resolves a session's user from the token alone, so an API-key session is
 * attributed to nobody. There is no impersonation endpoint, so the member has
 * to authenticate here once. Signing in through "Sign in with Jellyfin" does
 * the same thing as a side effect; this route serves everyone else.
 */
const INVALID_CREDENTIALS = 'Invalid Jellyfin username or password';
const JELLYFIN_UNAVAILABLE = 'Jellyfin is unavailable right now. Try again in a moment.';
const WRONG_ACCOUNT =
  'Those credentials are for a different Jellyfin account than the one linked to your profile.';
const ALREADY_CLAIMED = 'That Jellyfin account is already connected to another Helprr profile.';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const malformedBackstop = await enforceMalformedLoginBackstop();
  if (malformedBackstop) return malformedBackstop;

  const input = await readLoginCredentials(request);
  if (!input.ok) {
    return (await recordMalformedLoginRequest()) ?? input.response;
  }
  const { username, password } = input.credentials;
  const ip = getClientIp(request);

  // Same rate-limit keys as /api/auth/jellyfin and /api/auth/login, so this
  // route can't be used to work around the caps those enforce.
  const limited = await enforceLoginRateLimit(ip);
  if (limited) return limited;
  const backoff = await enforceUsernameBackoff(username);
  if (backoff) return backoff;
  const globalBackstop = await enforceGlobalLoginBackstop();
  if (globalBackstop) return globalBackstop;

  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'JELLYFIN' },
    select: { url: true },
  });
  if (!connection?.url) {
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  const result = await JellyfinClient.authenticateByName(connection.url, username, password);
  if (!result.ok) {
    if (result.reason === 'invalid_credentials') {
      await recordUsernameFailure(username, password);
      await recordGlobalLoginFailure();
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
    }
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  // The security boundary: valid Jellyfin credentials only connect the account
  // this profile is already linked to. Without this a member could authenticate
  // as somebody else and then watch, resume, and record history as them.
  if (auth.user.jellyfinUserId && auth.user.jellyfinUserId !== result.userId) {
    return NextResponse.json({ error: WRONG_ACCOUNT }, { status: 409 });
  }

  if (!auth.user.jellyfinUserId) {
    // Auto-link: the Helprr account already exists and they just proved they own
    // this Jellyfin account, so this is not auto-provisioning. The unique index
    // is the real guard against two profiles claiming one Jellyfin identity.
    try {
      await prisma.user.update({
        where: { id: auth.user.id },
        data: { jellyfinUserId: result.userId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return NextResponse.json({ error: ALREADY_CLAIMED }, { status: 409 });
      }
      throw error;
    }
  }

  await storeJellyfinToken(auth.user.id, result.accessToken);

  await clearUsernameBackoff(username);
  if (ip !== undefined) {
    await clearLoginAttempts(ip).catch((error) =>
      console.error('[Account] Failed to clear login attempts:', error),
    );
  }

  return NextResponse.json({ connected: true, jellyfinUsername: result.userName });
}

async function deleteHandler(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // Only the cached token is dropped. The jellyfinUserId link is identity and
  // stays put, so reads keep resolving and reconnecting needs no admin.
  await invalidateJellyfinToken(auth.user.id);
  return NextResponse.json({ connected: false });
}

export const POST = withApiLogging(postHandler, 'api/account/jellyfin/link', { logBodies: false });
export const DELETE = withApiLogging(deleteHandler, 'api/account/jellyfin/link');
