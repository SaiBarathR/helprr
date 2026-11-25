// qBittorrent, every instance: torrents added, completed and removed since
// the last poll, ones that errored or stalled too long; the downloads badge.
import type { ServiceConnection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getQBittorrentClients } from '@/lib/service-helpers';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import { PollNotificationCollector, type NotificationEventInput, type PollNotificationContext } from '@/lib/notification-grouping';
import { qbittorrentSyncFor } from '@/lib/qbittorrent-sync';
import { DEFAULT_TORRENT_STALLED_ALERT_MINS, formatStalledFor } from '@/lib/torrent-stalled-alert';
import { getPollingState, instanceTitle, notifyAndLog, wantedNotices, type CycleContext } from './shared';
import { torrentProblems, type TorrentProblemMarks } from './torrent-problems';

type TorrentEntry = { hash: string; progress: number; name: string } & TorrentProblemMarks;

export async function pollQBittorrent(context: CycleContext) {
  let instances;
  try {
    instances = await getQBittorrentClients();
  } catch (error) {
    noteJobFailure(error);
    logger.debug('Skipping qBittorrent poll because clients are unavailable', { error }, { scope: 'polling' });
    return;
  }
  if (instances.length === 0) return;

  const settings = await context.getSettings();
  // Each instance keeps its own state and pushes; one that fails is skipped
  // this cycle and leaves the others alone. The badge counts every instance
  // that answered.
  const counts = await Promise.all(instances.map(async ({ connection, client }) => {
    try {
      return await pollInstance(connection, client, instances.length, settings);
    } catch (error) {
      noteJobFailure(error);
      logger.warn('qBittorrent poll failed', { instanceId: connection.id, error }, { scope: 'polling' });
      return null;
    }
  }));
  const answered = counts.filter((count): count is { total: number; attention: number } => count !== null);
  // None answered: keep the last badge rather than show nothing in flight.
  if (answered.length === 0) return;
  await writeBadgeSlice('downloads', 'qbittorrent', {
    total: answered.reduce((sum, count) => sum + count.total, 0),
    attention: answered.reduce((sum, count) => sum + count.attention, 0),
  });
}

/** One qBittorrent's poll; its downloads badge counts. */
async function pollInstance(
  connection: ServiceConnection,
  client: QBittorrentClient,
  instanceCount: number,
  settings: Awaited<ReturnType<CycleContext['getSettings']>>,
): Promise<{ total: number; attention: number }> {
  const { state, firstRun } = await getPollingState(connection.id);

  const groupingEnabled = settings.notificationGroupingEnabled;
  const stalledAfterMins = settings.torrentStalledAlertMins ?? DEFAULT_TORRENT_STALLED_ALERT_MINS;
  const now = Date.now();
  const collector = new PollNotificationCollector();
  // Every push names its qBittorrent, so its link opens that instance's
  // Torrents and a group never mixes two instances.
  const instanceId = connection.id;
  const instanceLabel = connection.label;
  const instanceQuery = `instance=${encodeURIComponent(instanceId)}`;
  const listUrl = `/torrents?${instanceQuery}`;
  const title = (base: string) => instanceTitle(base, instanceLabel, instanceCount);

  // The torrents page's merged sync/maindata state: a read shortly after the
  // page's reuses it, and any read is only what changed since the last one.
  const { torrents } = await qbittorrentSyncFor(client).read();
  const currentMap = new Map(torrents.map((t) => [t.hash, t]));

  // Previous state: array of {hash, progress, name} and the problem marks
  const prevEntries = (state.lastQueueIds as TorrentEntry[]) || [];
  const prevMap = new Map(prevEntries.map((e) => [e.hash, e]));
  logger.debug('qBittorrent torrents polled', {
    instanceId,
    torrentCount: torrents.length,
    previousTorrentCount: prevEntries.length,
    newTorrentCount: torrents.filter((torrent) => !prevMap.has(torrent.hash)).length,
    deletedTorrentCount: prevEntries.filter((entry) => !currentMap.has(entry.hash)).length,
  }, { scope: 'polling' });

  const nextEntries: TorrentEntry[] = [];
  const problemNotices: { event: NotificationEventInput; context: PollNotificationContext }[] = [];
  // Detect new torrents (added)
  for (const torrent of torrents) {
    const prev = prevMap.get(torrent.hash);
    const problems = torrentProblems(torrent.state, prev, {
      now,
      stalledAfterMs: stalledAfterMins * 60_000,
      firstRun,
    });
    nextEntries.push({ hash: torrent.hash, progress: torrent.progress, name: torrent.name, ...problems.marks });
    if (!prev && !firstRun) {
      collector.add({
        eventType: 'torrentAdded',
        title: title('Torrent Added'),
        body: torrent.name,
        metadata: { source: 'qbittorrent', instanceId, instanceLabel, hash: torrent.hash, redirect: listUrl },
        url: listUrl,
      }, { service: 'qbittorrent', instanceId, reason: 'torrent-added', hash: torrent.hash });
    }

    // Detect completed (progress went from <1 to 1)
    if (torrent.progress >= 1 && prev && prev.progress < 1) {
      collector.add({
        eventType: 'torrentCompleted',
        title: title('Download Complete'),
        body: torrent.name,
        metadata: { source: 'qbittorrent', instanceId, instanceLabel, hash: torrent.hash, redirect: listUrl },
        url: listUrl,
      }, { service: 'qbittorrent', instanceId, reason: 'torrent-completed', hash: torrent.hash });
    }

    // Opens the torrent's own page: for an error or missing files its
    // location, for a stall its trackers (what they answer is why).
    if (problems.errored) {
      const missing = torrent.state === 'missingFiles';
      const url = `/torrents/${encodeURIComponent(torrent.hash)}/settings?${instanceQuery}`;
      problemNotices.push({
        event: {
          eventType: 'torrentErrored',
          title: title(missing ? 'Torrent Files Missing' : 'Torrent Errored'),
          body: torrent.name,
          metadata: { source: 'qbittorrent', instanceId, instanceLabel, hash: torrent.hash, state: torrent.state, redirect: url },
          url,
        },
        context: { service: 'qbittorrent', instanceId, reason: missing ? 'torrent-missing-files' : 'torrent-errored', hash: torrent.hash },
      });
    }
    if (problems.stalled) {
      const what = torrent.state === 'stalledDL' ? 'No data' : 'No metadata';
      const url = `/torrents/${encodeURIComponent(torrent.hash)}/trackers?name=${encodeURIComponent(torrent.name)}&${instanceQuery}`;
      problemNotices.push({
        event: {
          eventType: 'torrentStalled',
          title: title('Torrent Stalled'),
          body: `${torrent.name} · ${what} for ${formatStalledFor(stalledAfterMins)}`,
          metadata: { source: 'qbittorrent', instanceId, instanceLabel, hash: torrent.hash, state: torrent.state, redirect: url },
          url,
        },
        context: { service: 'qbittorrent', instanceId, reason: 'torrent-stalled', hash: torrent.hash },
      });
    }
  }
  // Opt-in: not sent at all while nobody takes them (so no row in the admins'
  // notification list); the marks above are saved either way.
  for (const notice of await wantedNotices(problemNotices)) collector.add(notice.event, notice.context);

  // Detect deleted (was in previous state but gone now)
  for (const prev of prevEntries) {
    if (!currentMap.has(prev.hash)) {
      collector.add({
        eventType: 'torrentDeleted',
        title: title('Torrent Removed'),
        body: prev.name,
        metadata: { source: 'qbittorrent', instanceId, instanceLabel, hash: prev.hash, redirect: listUrl },
        url: listUrl,
      }, { service: 'qbittorrent', instanceId, reason: 'torrent-deleted', hash: prev.hash });
    }
  }

  await collector.flush({ enabled: groupingEnabled, notify: notifyAndLog });

  // Update state
  await prisma.pollingState.update({
    where: { serviceConnectionId: connection.id },
    data: {
      lastQueueIds: nextEntries,
    },
  });
  logger.debug('qBittorrent polling state updated', {
    instanceId,
    torrentCount: torrents.length,
  }, { scope: 'polling' });

  // Nav badge: total = downloads still in flight (progress < 1); attention =
  // the in-flight subset that's stalled or errored (so attention <= total).
  const inFlightTorrents = torrents.filter((t) => t.progress < 1);
  return {
    total: inFlightTorrents.length,
    attention: inFlightTorrents.filter(
      (t) => t.state === 'error' || t.state === 'missingFiles' || t.state === 'stalledDL',
    ).length,
  };
}
