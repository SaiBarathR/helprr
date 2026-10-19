// Jellyfin: playback that started since the last poll.
import { prisma } from '@/lib/db';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getDefaultConnection } from '@/lib/arr-instances';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { notifyAndLog } from './shared';

export async function pollJellyfin() {
  const connection = await getDefaultConnection('JELLYFIN');
  if (!connection) return;

  // Jellyfin is set up, so a client it cannot build (no user context) is a failure.
  let client;
  try {
    client = await getJellyfinClient();
  } catch (error) {
    noteJobFailure(error);
    logger.debug('Skipping Jellyfin poll because client is unavailable', { error }, { scope: 'polling' });
    return;
  }

  const state = await prisma.pollingState.upsert({
    where: { serviceConnectionId: connection.id },
    update: {},
    create: { serviceConnectionId: connection.id, lastQueueIds: [] },
  });

  // Session polling (new playback)
  try {
    const sessions = await client.getActiveSessions();
    const currentSessionIds = sessions.map((s) => s.Id);
    const prevSessionIds = (state.lastQueueIds as string[]) || [];

    const newSessions = sessions.filter((s) => !prevSessionIds.includes(s.Id));
    logger.debug('Jellyfin sessions polled', {
      sessionCount: sessions.length,
      previousSessionCount: prevSessionIds.length,
      newSessionCount: newSessions.length,
    }, { scope: 'polling' });

    const startedSessions = newSessions.filter((s) => s.NowPlayingItem);

    // Map the streaming Jellyfin users to Helprr accounts (batched, once per
    // cycle) so playback pushes are user-aware: the history row is stamped to
    // the streamer and they are not pushed about their own stream. Sessions
    // from unlinked Jellyfin users keep today's broadcast behavior.
    let ownerByJellyfinId = new Map<string, string>();
    let activeUserIds: string[] = [];
    if (startedSessions.length) {
      const jellyfinIds = Array.from(
        new Set(
          startedSessions
            .map((s) => s.UserId)
            .filter((id): id is string => !!id)
        )
      );
      if (jellyfinIds.length) {
        ownerByJellyfinId = new Map(
          (
            await prisma.user.findMany({
              where: { jellyfinUserId: { in: jellyfinIds } },
              select: { id: true, jellyfinUserId: true },
            })
          ).map((u) => [u.jellyfinUserId as string, u.id])
        );
      }
      if (ownerByJellyfinId.size) {
        activeUserIds = (
          await prisma.user.findMany({
            where: { status: 'active' },
            select: { id: true },
          })
        ).map((u) => u.id);
      }
    }

    for (const session of startedSessions) {
      const item = session.NowPlayingItem;
      if (item) {
        const title = item.SeriesName
          ? `${item.SeriesName} - ${item.Name}`
          : item.Name;
        const ownerId = session.UserId
          ? ownerByJellyfinId.get(session.UserId) ?? null
          : null;
        await notifyAndLog({
          eventType: 'jellyfinPlaybackStart',
          title: 'Playback Started',
          body: `${session.UserName} is watching ${title}`,
          metadata: {
            source: 'jellyfin',
            sessionId: session.Id,
            // Matched against each device's muted-users filter at delivery.
            jellyfinUserId: session.UserId,
            jellyfinUserName: session.UserName,
            redirect: '/jellyfin',
          },
          url: '/jellyfin',
          // Everyone but the streamer; an empty list (sole-user instance)
          // still suppresses the self-push while the history row is kept.
          userIds: ownerId ? activeUserIds.filter((id) => id !== ownerId) : undefined,
          ownerUserId: ownerId,
        }, { service: 'jellyfin', reason: 'playback-start', sessionId: session.Id });
      }
    }

    await prisma.pollingState.update({
      where: { serviceConnectionId: connection.id },
      data: {
        lastQueueIds: currentSessionIds,
      },
    });
    logger.debug('Jellyfin polling state updated', {
      sessionCount: currentSessionIds.length,
    }, { scope: 'polling' });
  } catch (e) {
    noteJobFailure(e);
    logger.warn('Jellyfin session poll failed', e, { scope: 'polling' });
  }
}
