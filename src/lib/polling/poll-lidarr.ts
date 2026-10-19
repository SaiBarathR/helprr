// Lidarr, every instance: queue arrivals and problems, history imports and health changes, as notifications; the activity badge.
import { prisma } from '@/lib/db';
import { getLidarrClients } from '@/lib/service-helpers';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { classifyQueueIssue } from '@/lib/queue-state';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { PollNotificationCollector } from '@/lib/notification-grouping';
import { fetchAllQueueRecords } from '@/lib/activity-queue';
import crypto from 'crypto';
import { importFailureBody, downloadFailureBody, buildTagMap, mediaFilterMeta, readQueueSnapshots, errorMessage, getPollingState, historyCursorFromState, fetchNewHistoryPages, advanceHistoryCursor, getMediaHrefFromIds, notifyAndLog, instanceTitle, type CycleContext, type QueueSnapshot } from './shared';

export async function pollLidarr(context: CycleContext) {
  context.registerInstanceSource('lidarr');
  let instances;
  try {
    instances = await getLidarrClients();
  } catch (error) {
    context.markInstanceSourceReady('lidarr');
    noteJobFailure(error);
    logger.debug('Skipping Lidarr poll because clients are unavailable', { error }, { scope: 'polling' });
    return;
  }
  if (instances.length === 0) {
    context.markInstanceSourceReady('lidarr');
    return;
  }

  const n = instances.length;
  let groupingEnabled: boolean;
  try {
    groupingEnabled = (await context.getSettings()).notificationGroupingEnabled;
  } catch (error) {
    context.markInstanceSourceReady('lidarr');
    throw error;
  }
  const instanceTasks = instances.map(({ connection, client }) => {
    const counts = { total: 0, attention: 0 };
    const instanceId = connection.id;
    // Per-instance so a failed instance can't bleed its buffered events into
    // the next instance's flush (and re-fire next cycle as duplicates).
    const collector = new PollNotificationCollector();
    const instanceLabel = connection.label;
    return context.runInstance('lidarr', async () => {
      const { state, firstRun } = await getPollingState(instanceId);

      const tagMap = await buildTagMap(client);
      const queue = await fetchAllQueueRecords(client);
      const prevMap = readQueueSnapshots(state.lastQueueIds);
      const currentSnapshots: QueueSnapshot[] = queue.records.map((r) => ({
        id: r.id,
        state: r.trackedDownloadState ?? '',
        status: r.trackedDownloadStatus ?? '',
      }));

      for (const item of queue.records) {
        const metadata = {
          source: 'lidarr' as const,
          instanceId,
          instanceLabel,
          id: item.id,
          artistId: item.artistId,
          albumId: item.albumId,
          ...mediaFilterMeta(item, tagMap),
        };
        const mediaHref = getMediaHrefFromIds(metadata);
        const queueHref = '/activity?tab=queue&source=lidarr';
        const failedTabHref = '/activity?tab=failed&source=lidarr';

        const prev = prevMap.get(item.id);
        const currentIssue = classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus);
        const prevIssue =
          prev && prev !== 'legacy'
            ? classifyQueueIssue(prev.state, prev.status)
            : null;

        if (!prev) {
          if (firstRun) continue; // baseline: pre-existing item, not new
          if (currentIssue === 'import') {
            collector.add({
              eventType: 'importFailed',
              title: instanceTitle('Album Manual Import Required', instanceLabel, n),
              body: importFailureBody(item),
              metadata: { ...metadata, redirect: failedTabHref, state: item.trackedDownloadState },
              url: failedTabHref,
            }, { service: 'lidarr', instanceId, reason: 'queue-import-blocked-new', itemId: item.id });
          } else if (currentIssue === 'download') {
            collector.add({
              eventType: 'downloadFailed',
              title: instanceTitle('Album Download Failed', instanceLabel, n),
              body: downloadFailureBody(item),
              metadata: { ...metadata, redirect: queueHref, state: item.trackedDownloadState },
              url: queueHref,
            }, { service: 'lidarr', instanceId, reason: 'queue-download-failed-new', itemId: item.id });
          } else {
            const redirect = mediaHref ?? queueHref;
            collector.add({
              eventType: 'grabbed',
              title: instanceTitle('Album Download Started', instanceLabel, n),
              body: item.title,
              metadata: { ...metadata, redirect },
              url: redirect,
            }, { service: 'lidarr', instanceId, reason: 'queue-new-item', itemId: item.id });
          }
        } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
          if (currentIssue === 'import') {
            collector.add({
              eventType: 'importFailed',
              title: instanceTitle('Album Manual Import Required', instanceLabel, n),
              body: importFailureBody(item),
              metadata: { ...metadata, redirect: failedTabHref, state: item.trackedDownloadState },
              url: failedTabHref,
            }, { service: 'lidarr', instanceId, reason: 'queue-import-blocked-transition', itemId: item.id });
          } else if (currentIssue === 'download') {
            collector.add({
              eventType: 'downloadFailed',
              title: instanceTitle('Album Download Failed', instanceLabel, n),
              body: downloadFailureBody(item),
              metadata: { ...metadata, redirect: queueHref, state: item.trackedDownloadState },
              url: queueHref,
            }, { service: 'lidarr', instanceId, reason: 'queue-download-failed-transition', itemId: item.id });
          }
        }
      }

      // Keep badge counts isolated so concurrent workers aggregate deterministically.
      counts.total = queue.totalRecords;
      counts.attention = queue.records.filter(
        (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
      ).length;

      const historyCursorState = historyCursorFromState(state);
      const { allFetched: historyRecords, newRecords: newHistory } = await fetchNewHistoryPages(client, historyCursorState);

      for (const item of newHistory) {
        if (item.eventType === 'downloadImported' || item.eventType === 'trackFileImported') {
          const metadata = {
            source: 'lidarr' as const,
            instanceId,
            instanceLabel,
            id: item.id,
            artistId: item.artistId,
            albumId: item.albumId,
            ...mediaFilterMeta(item, tagMap),
          };
          const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';
          collector.add({
            eventType: 'imported',
            title: instanceTitle('Album Imported', instanceLabel, n),
            body: `${item.sourceTitle}`,
            metadata: { ...metadata, redirect },
            url: redirect,
          }, { service: 'lidarr', instanceId, reason: 'history-imported', historyId: item.id });
        }
      }

      // A new import means the library changed: bust the cached library here
      // so freshness doesn't depend on a browser polling the command status
      // to completion. warmCaches re-populates fresh data next cycle.
      if (newHistory.some((item) => item.eventType === 'downloadImported' || item.eventType === 'trackFileImported')) {
        await invalidateTaggedLibrary('lidarr', instanceId);
      }

      const health = await client.getHealth();
      const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
      if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
        await notifyAndLog({
          eventType: 'healthWarning',
          title: instanceTitle('Lidarr Health Warning', instanceLabel, n),
          body: health.map((h) => h.message).join('; ').slice(0, 200),
          url: '/settings',
        }, { service: 'lidarr', instanceId, reason: 'health-changed', healthCount: health.length });
      }

      await collector.flush({ enabled: groupingEnabled, notify: notifyAndLog });

      const cursor = advanceHistoryCursor(newHistory, historyRecords, historyCursorState);
      await prisma.pollingState.update({
        where: { serviceConnectionId: instanceId },
        data: {
          lastQueueIds: currentSnapshots as unknown as object,
          lastHistoryDate: cursor.lastHistoryDate,
          lastHistoryId: cursor.lastHistoryId,
          lastHistorySeenIds: cursor.lastHistorySeenIds,
          lastHealthHash: healthHash,
        },
      });
      logger.debug('Lidarr polling state updated', {
        instanceId,
        queueCount: currentSnapshots.length,
      }, { scope: 'polling' });
      return counts;
    }).catch((error) => {
      noteJobFailure(error);
      logger.warn('Lidarr instance poll failed', { instanceId, error: errorMessage(error) }, { scope: 'polling' });
      return counts;
    });
  });
  context.markInstanceSourceReady('lidarr');
  const instanceCounts = await Promise.all(instanceTasks);

  await writeBadgeSlice('activity', 'lidarr', {
    total: instanceCounts.reduce((sum, counts) => sum + counts.total, 0),
    attention: instanceCounts.reduce((sum, counts) => sum + counts.attention, 0),
  });
}
