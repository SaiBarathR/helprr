// Jellyfin: playback that started since the last poll.
import { prisma } from '@/lib/db';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getDefaultConnection } from '@/lib/arr-instances';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { notifyAndLog } from './shared';

// A resume, reconnect or second device opens a new Jellyfin session for the
// same playback. Push again for a user and item only after the item has not
// been seen playing for this long.
const PLAYBACK_REPEAT_COOLDOWN_MS = 45 * 60 * 1000;

// Jellyfin has no history cursor, so its {"userId:itemId": lastSeenPlayingMs} map
// lives in pollingState.lastHistorySeenIds. lastQueueIds stays the plain
// session-id list, which is what older versions read after a rollback.
function readRecentPlayback(raw: unknown): Record<string, number> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, number>) : {};
}

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
    const now = Date.now();
    const playbackKey = (s: (typeof sessions)[number]) =>
      s.UserId && s.NowPlayingItem?.Id ? `${s.UserId}:${s.NowPlayingItem.Id}` : null;

    // Drop expired entries so the saved state stays small.
    const recentPlayback: Record<string, number> = {};
    for (const [key, seenAt] of Object.entries(readRecentPlayback(state.lastHistorySeenIds))) {
      if (typeof seenAt === 'number' && seenAt <= now && now - seenAt < PLAYBACK_REPEAT_COOLDOWN_MS) recentPlayback[key] = seenAt;
    }

    const newSessions = sessions.filter((s) => !prevSessionIds.includes(s.Id));
    logger.debug('Jellyfin sessions polled', {
      sessionCount: sessions.length,
      previousSessionCount: prevSessionIds.length,
      newSessionCount: newSessions.length,
    }, { scope: 'polling' });

    const startedSessions = newSessions.filter((s) => {
      if (!s.NowPlayingItem) return false;
      const key = playbackKey(s);
      if (!key) return true;
      if (key in recentPlayback) return false;
      recentPlayback[key] = now; // a second new session for it this cycle stays quiet
      return true;
    });
    // Everything still playing counts as seen now, so a long playback that
    // reconnects later is not treated as a new start.
    for (const s of sessions) {
      const key = playbackKey(s);
      if (key) recentPlayback[key] = now;
    }

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
        // Songs, audiobooks and radio channels report MediaType 'Audio'.
        const isAudio = item.MediaType === 'Audio' || item.Type === 'Audio' || item.Type === 'AudioBook';
        const verb = isAudio ? 'is listening to' : 'is watching';
        const ownerId = session.UserId
          ? ownerByJellyfinId.get(session.UserId) ?? null
          : null;
        await notifyAndLog({
          eventType: 'jellyfinPlaybackStart',
          title: 'Playback Started',
          body: `${session.UserName} ${verb} ${title}`,
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
        lastHistorySeenIds: recentPlayback,
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
