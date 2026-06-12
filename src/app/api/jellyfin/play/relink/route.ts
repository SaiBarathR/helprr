import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { JellyfinClient } from '@/lib/jellyfin-client';
import {
  enforceUsernameBackoff,
  recordUsernameFailure,
  clearUsernameBackoff,
} from '@/lib/login-rate-limit';

const JELLYFIN_UNAVAILABLE = 'Jellyfin is unreachable right now. Try again later.';

// Recovery path for a missing/stale playback token: re-authenticate the
// caller's own linked Jellyfin account with their JF password and cache the
// fresh AccessToken. Helprr-password users (who never used "Sign in with
// Jellyfin") get their first token this way.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.play');
  if (!auth.ok) return auth.response;

  if (!auth.user.jellyfinUserId) {
    return NextResponse.json(
      { error: 'No Jellyfin account is linked to this profile. Ask your admin to link one.' },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const password = (body as { password?: unknown })?.password;
  if (typeof password !== 'string' || password === '') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const connection = await prisma.serviceConnection.findFirst({ where: { type: 'JELLYFIN' } });
  if (!connection) {
    return NextResponse.json({ error: 'Jellyfin is not configured' }, { status: 503 });
  }

  // Resolve the JF username from the linked userId server-side (admin client) —
  // the browser never supplies it, so a member can only relink their own account.
  let jellyfinUsername: string;
  try {
    const adminClient = new JellyfinClient(connection.url, connection.apiKey);
    jellyfinUsername = (await adminClient.getUserById(auth.user.jellyfinUserId)).Name;
  } catch {
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  // Same backoff keys as the login endpoints, so relink can't be alternated with
  // them to dodge the brute-force cap on a Jellyfin password.
  const backoff = await enforceUsernameBackoff(jellyfinUsername);
  if (backoff) return backoff;

  const result = await JellyfinClient.authenticateByName(connection.url, jellyfinUsername, password);
  if (!result.ok) {
    if (result.reason === 'invalid_credentials') {
      await recordUsernameFailure(jellyfinUsername, password);
      return NextResponse.json({ error: 'Invalid Jellyfin password' }, { status: 401 });
    }
    return NextResponse.json({ error: JELLYFIN_UNAVAILABLE }, { status: 502 });
  }

  // Shouldn't happen (the username was resolved from the linked id) — fail closed
  // rather than cache a token that belongs to a different Jellyfin user.
  if (result.userId !== auth.user.jellyfinUserId) {
    return NextResponse.json({ error: 'Jellyfin account mismatch' }, { status: 409 });
  }

  await clearUsernameBackoff(jellyfinUsername);
  await prisma.user.update({
    where: { id: auth.user.id },
    data: { jellyfinToken: result.accessToken },
  });

  return NextResponse.json({ success: true });
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/play/relink', { logBodies: false });
