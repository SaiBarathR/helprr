import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { getJellyfinClientContext } from '@/lib/service-helpers';
import { invalidateQueuedCleanup } from '@/lib/youtube/cleanup';
import { getYoutubeSettings } from '@/lib/youtube/settings';

/** The state of automatic cleanup, and the people whose watching could count. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const settings = await getYoutubeSettings();
  const users = await getJellyfinClientContext()
    .then(({ client }) => client.getUsers())
    .then((list) => list.map((user) => ({ id: user.Id, name: user.Name })))
    .catch(() => null);
  return NextResponse.json({
    enabled: settings.autoCleanupEnabled,
    viewerId: settings.cleanupJellyfinUserId,
    status: settings.cleanupStatus,
    ranAt: settings.cleanupRanAt,
    users,
  });
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { enabled?: unknown; viewerId?: unknown } | null;
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled is required' }, { status: 400 });

  await getYoutubeSettings();
  if (!body.enabled) {
    await prisma.youtubeSettings.update({ where: { id: 'singleton' }, data: { autoCleanupEnabled: false, cleanupStatus: null } });
    await invalidateQueuedCleanup();
    return NextResponse.json({ ok: true });
  }

  // Turning it on names the viewer and the connection, and both are proven first.
  if (typeof body.viewerId !== 'string' || !body.viewerId) {
    return NextResponse.json({ error: 'Choose whose watched videos count' }, { status: 400 });
  }
  try {
    const { client, connection, connectionFingerprint } = await getJellyfinClientContext();
    const viewer = await client.getUser(body.viewerId);
    if (viewer.Id !== body.viewerId) throw new Error('not that user');
    await prisma.youtubeSettings.update({
      where: { id: 'singleton' },
      data: {
        autoCleanupEnabled: true,
        cleanupJellyfinUserId: viewer.Id,
        cleanupConnectionId: connection.id,
        cleanupConnectionFingerprint: connectionFingerprint,
        cleanupStatus: null,
        cleanupRanAt: null,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Could not confirm that user in Jellyfin' }, { status: 502 });
  }
  await invalidateQueuedCleanup();
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/youtube/cleanup');
export const PUT = withApiLogging(putHandler, 'api/youtube/cleanup');
