import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import type { PlayTicket } from '@/types/jellyfin-playback';

// Hands the browser what it needs to stream from Jellyfin directly: the
// reachable server URL and the caller's own cached per-user token (never the
// admin API key). Staleness is detected client-side — Jellyfin 401s, the
// client drops its cached ticket and offers the relink dialog.
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.play');
  if (!auth.ok) return auth.response;

  const connection = await prisma.serviceConnection.findFirst({
    where: { type: 'JELLYFIN' },
    select: { url: true, externalUrl: true },
  });
  if (!connection) {
    return NextResponse.json({ error: 'Jellyfin is not configured' }, { status: 503 });
  }

  const { jellyfinUserId, jellyfinToken } = auth.user;
  if (!jellyfinUserId) {
    return NextResponse.json({ status: 'notLinked' } satisfies PlayTicket);
  }
  if (!jellyfinToken) {
    return NextResponse.json({ status: 'needsRelink' } satisfies PlayTicket);
  }

  return NextResponse.json({
    status: 'ok',
    serverUrl: (connection.externalUrl || connection.url).replace(/\/+$/, ''),
    userId: jellyfinUserId,
    token: jellyfinToken,
  } satisfies PlayTicket);
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/play/ticket', { logBodies: false });
