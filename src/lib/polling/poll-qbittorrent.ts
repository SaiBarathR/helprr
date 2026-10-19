// qBittorrent: torrents added, completed and removed since the last poll; the downloads badge.
import { prisma } from '@/lib/db';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { ConfigurationError } from '@/lib/config-error';
import { getDefaultConnection } from '@/lib/arr-instances';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import { PollNotificationCollector } from '@/lib/notification-grouping';
import { getPollingState, notifyAndLog, type CycleContext } from './shared';

export async function pollQBittorrent(context: CycleContext) {
  let client;
  try {
    client = await getQBittorrentClient();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) noteJobFailure(error);
    logger.debug('Skipping qBittorrent poll because client is unavailable', { error }, { scope: 'polling' });
    return;
  }

  const connection = await getDefaultConnection('QBITTORRENT');
  if (!connection) return;

  const { state, firstRun } = await getPollingState(connection.id);

  const groupingEnabled = (await context.getSettings()).notificationGroupingEnabled;
  const collector = new PollNotificationCollector();

  const torrents = await client.getTorrents();
  const currentMap = new Map(torrents.map((t) => [t.hash, t]));

  // Previous state: array of {hash, progress, name}
  const prevEntries = (state.lastQueueIds as { hash: string; progress: number; name: string }[]) || [];
  const prevMap = new Map(prevEntries.map((e) => [e.hash, e]));
  logger.debug('qBittorrent torrents polled', {
    torrentCount: torrents.length,
    previousTorrentCount: prevEntries.length,
    newTorrentCount: torrents.filter((torrent) => !prevMap.has(torrent.hash)).length,
    deletedTorrentCount: prevEntries.filter((entry) => !currentMap.has(entry.hash)).length,
  }, { scope: 'polling' });

  // Detect new torrents (added)
  for (const torrent of torrents) {
    const prev = prevMap.get(torrent.hash);
    if (!prev && !firstRun) {
      collector.add({
        eventType: 'torrentAdded',
        title: 'Torrent Added',
        body: torrent.name,
        metadata: { source: 'qbittorrent', hash: torrent.hash, redirect: '/torrents' },
        url: '/torrents',
      }, { service: 'qbittorrent', reason: 'torrent-added', hash: torrent.hash });
    }

    // Detect completed (progress went from <1 to 1)
    if (torrent.progress >= 1 && prev && prev.progress < 1) {
      collector.add({
        eventType: 'torrentCompleted',
        title: 'Download Complete',
        body: torrent.name,
        metadata: { source: 'qbittorrent', hash: torrent.hash, redirect: '/torrents' },
        url: '/torrents',
      }, { service: 'qbittorrent', reason: 'torrent-completed', hash: torrent.hash });
    }
  }

  // Detect deleted (was in previous state but gone now)
  for (const prev of prevEntries) {
    if (!currentMap.has(prev.hash)) {
      collector.add({
        eventType: 'torrentDeleted',
        title: 'Torrent Removed',
        body: prev.name,
        metadata: { source: 'qbittorrent', hash: prev.hash, redirect: '/torrents' },
        url: '/torrents',
      }, { service: 'qbittorrent', reason: 'torrent-deleted', hash: prev.hash });
    }
  }

  // Nav badge: total = downloads still in flight (progress < 1); attention =
  // the in-flight subset that's stalled or errored (so attention <= total).
  const inFlightTorrents = torrents.filter((t) => t.progress < 1);
  await writeBadgeSlice('downloads', 'qbittorrent', {
    total: inFlightTorrents.length,
    attention: inFlightTorrents.filter(
      (t) => t.state === 'error' || t.state === 'missingFiles' || t.state === 'stalledDL',
    ).length,
  });

  await collector.flush({ enabled: groupingEnabled, notify: notifyAndLog });

  // Update state
  await prisma.pollingState.update({
    where: { serviceConnectionId: connection.id },
    data: {
      lastQueueIds: torrents.map((t) => ({ hash: t.hash, progress: t.progress, name: t.name })),
    },
  });
  logger.debug('qBittorrent polling state updated', {
    torrentCount: torrents.length,
  }, { scope: 'polling' });
}
