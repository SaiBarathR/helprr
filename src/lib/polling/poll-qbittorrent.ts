// qBittorrent: torrents added, completed and removed since the last poll, ones
// that errored or stalled too long; the downloads badge.
import { prisma } from '@/lib/db';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { ConfigurationError } from '@/lib/config-error';
import { getDefaultConnection } from '@/lib/arr-instances';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import { PollNotificationCollector, type NotificationEventInput, type PollNotificationContext } from '@/lib/notification-grouping';
import { DEFAULT_TORRENT_STALLED_ALERT_MINS, formatStalledFor } from '@/lib/torrent-stalled-alert';
import { getPollingState, notifyAndLog, wantedNotices, type CycleContext } from './shared';
import { torrentProblems, type TorrentProblemMarks } from './torrent-problems';

type TorrentEntry = { hash: string; progress: number; name: string } & TorrentProblemMarks;

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

  const settings = await context.getSettings();
  const groupingEnabled = settings.notificationGroupingEnabled;
  const stalledAfterMins = settings.torrentStalledAlertMins ?? DEFAULT_TORRENT_STALLED_ALERT_MINS;
  const now = Date.now();
  const collector = new PollNotificationCollector();

  const torrents = await client.getTorrents();
  const currentMap = new Map(torrents.map((t) => [t.hash, t]));

  // Previous state: array of {hash, progress, name} and the problem marks
  const prevEntries = (state.lastQueueIds as TorrentEntry[]) || [];
  const prevMap = new Map(prevEntries.map((e) => [e.hash, e]));
  logger.debug('qBittorrent torrents polled', {
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

    // Opens the torrent's own page: for an error or missing files its
    // location, for a stall its trackers (what they answer is why).
    if (problems.errored) {
      const missing = torrent.state === 'missingFiles';
      const url = `/torrents/${encodeURIComponent(torrent.hash)}/settings`;
      problemNotices.push({
        event: {
          eventType: 'torrentErrored',
          title: missing ? 'Torrent Files Missing' : 'Torrent Errored',
          body: torrent.name,
          metadata: { source: 'qbittorrent', hash: torrent.hash, state: torrent.state, redirect: url },
          url,
        },
        context: { service: 'qbittorrent', reason: missing ? 'torrent-missing-files' : 'torrent-errored', hash: torrent.hash },
      });
    }
    if (problems.stalled) {
      const what = torrent.state === 'stalledDL' ? 'No data' : 'No metadata';
      const url = `/torrents/${encodeURIComponent(torrent.hash)}/trackers?name=${encodeURIComponent(torrent.name)}`;
      problemNotices.push({
        event: {
          eventType: 'torrentStalled',
          title: 'Torrent Stalled',
          body: `${torrent.name} · ${what} for ${formatStalledFor(stalledAfterMins)}`,
          metadata: { source: 'qbittorrent', hash: torrent.hash, state: torrent.state, redirect: url },
          url,
        },
        context: { service: 'qbittorrent', reason: 'torrent-stalled', hash: torrent.hash },
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
      lastQueueIds: nextEntries,
    },
  });
  logger.debug('qBittorrent polling state updated', {
    torrentCount: torrents.length,
  }, { scope: 'polling' });
}
