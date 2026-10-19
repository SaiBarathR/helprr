// Sonarr, every instance: queue arrivals and problems, history imports and health changes, as notifications; the activity badge.
import { prisma } from '@/lib/db';
import { getSonarrClients } from '@/lib/service-helpers';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { classifyQueueIssue } from '@/lib/queue-state';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { PollNotificationCollector } from '@/lib/notification-grouping';
import { fetchAllQueueRecords } from '@/lib/activity-queue';
import { getMediaHrefFromIds } from '@/lib/media-href';
import crypto from 'crypto';
import { importFailureBody, downloadFailureBody, buildTagMap, mediaFilterMeta, readQueueSnapshots, errorMessage, getPollingState, historyCursorFromState, fetchNewHistoryPages, advanceHistoryCursor, notifyAndLog, instanceTitle, type CycleContext, type QueueSnapshot } from './shared';

export async function pollSonarr(context: CycleContext) {
  context.registerInstanceSource('sonarr');
  let instances;
  try {
    instances = await getSonarrClients();
  } catch (error) {
    context.markInstanceSourceReady('sonarr');
    noteJobFailure(error);
    logger.debug('Skipping Sonarr poll because clients are unavailable', { error }, { scope: 'polling' });
    return;
  }
  if (instances.length === 0) {
    context.markInstanceSourceReady('sonarr');
    return;
  }

  const n = instances.length;
  let groupingEnabled: boolean;
  try {
    groupingEnabled = (await context.getSettings()).notificationGroupingEnabled;
  } catch (error) {
    context.markInstanceSourceReady('sonarr');
    throw error;
  }
  const instanceTasks = instances.map(({ connection, client }) => {
    const counts = { total: 0, attention: 0 };
    const instanceId = connection.id;
    // Per-instance so a failed instance can't bleed its buffered events into
    // the next instance's flush (and re-fire next cycle as duplicates).
    const collector = new PollNotificationCollector();
    const instanceLabel = connection.label;
    return context.runInstance('sonarr', async () => {
      const { state, firstRun } = await getPollingState(instanceId);

      // Queue polling
      const tagMap = await buildTagMap(client);
      const queue = await fetchAllQueueRecords(client, true);
      const prevMap = readQueueSnapshots(state.lastQueueIds);
      const currentSnapshots: QueueSnapshot[] = queue.records.map((r) => ({
        id: r.id,
        state: r.trackedDownloadState ?? '',
        status: r.trackedDownloadStatus ?? '',
      }));
      let newQueueCount = 0;
      let importIssueCount = 0;
      let downloadFailedCount = 0;

      for (const item of queue.records) {
        const metadata = {
          source: 'sonarr' as const,
          instanceId,
          instanceLabel,
          id: item.id,
          seriesId: item.seriesId,
          seasonNumber: item.seasonNumber ?? item.episode?.seasonNumber,
          episodeId: item.episodeId ?? item.episode?.id,
          ...mediaFilterMeta(item, tagMap),
        };
        const mediaHref = getMediaHrefFromIds(metadata);
        const queueHref = '/activity?tab=queue&source=sonarr';
        const failedTabHref = '/activity?tab=failed&source=sonarr';

        const prev = prevMap.get(item.id);
        const currentIssue = classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus);
        const prevIssue =
          prev && prev !== 'legacy'
            ? classifyQueueIssue(prev.state, prev.status)
            : null;

        if (!prev) {
          // Item is new in the queue this cycle.
          newQueueCount++;
          if (firstRun) continue; // baseline: pre-existing item, not new
          if (currentIssue === 'import') {
            importIssueCount++;
            const redirect = failedTabHref;
            collector.add({
              eventType: 'importFailed',
              title: instanceTitle('Manual Import Required', instanceLabel, n),
              body: importFailureBody(item),
              metadata: { ...metadata, redirect, state: item.trackedDownloadState },
              url: redirect,
            }, { service: 'sonarr', instanceId, reason: 'queue-import-blocked-new', itemId: item.id });
          } else if (currentIssue === 'download') {
            downloadFailedCount++;
            const redirect = queueHref;
            collector.add({
              eventType: 'downloadFailed',
              title: instanceTitle('Download Failed', instanceLabel, n),
              body: downloadFailureBody(item),
              metadata: { ...metadata, redirect, state: item.trackedDownloadState },
              url: redirect,
            }, { service: 'sonarr', instanceId, reason: 'queue-download-failed-new', itemId: item.id });
          } else {
            const redirect = mediaHref ?? queueHref;
            collector.add({
              eventType: 'grabbed',
              title: instanceTitle('Download Started', instanceLabel, n),
              body: item.title,
              metadata: { ...metadata, redirect },
              url: redirect,
            }, { service: 'sonarr', instanceId, reason: 'queue-new-item', itemId: item.id });
          }
        } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
          // Transition into a problematic state — fire the matching notification.
          // Transitions back to normal are silent (success is announced by the
          // history "imported" event).
          if (currentIssue === 'import') {
            importIssueCount++;
            const redirect = failedTabHref;
            collector.add({
              eventType: 'importFailed',
              title: instanceTitle('Manual Import Required', instanceLabel, n),
              body: importFailureBody(item),
              metadata: { ...metadata, redirect, state: item.trackedDownloadState },
              url: redirect,
            }, { service: 'sonarr', instanceId, reason: 'queue-import-blocked-transition', itemId: item.id });
          } else if (currentIssue === 'download') {
            downloadFailedCount++;
            const redirect = queueHref;
            collector.add({
              eventType: 'downloadFailed',
              title: instanceTitle('Download Failed', instanceLabel, n),
              body: downloadFailureBody(item),
              metadata: { ...metadata, redirect, state: item.trackedDownloadState },
              url: redirect,
            }, { service: 'sonarr', instanceId, reason: 'queue-download-failed-transition', itemId: item.id });
          }
        }
      }

      logger.debug('Sonarr queue polled', {
        instanceId,
        queueCount: queue.records.length,
        previousQueueCount: prevMap.size,
        newQueueCount,
        importIssueCount,
        downloadFailedCount,
      }, { scope: 'polling' });

      // Keep badge counts isolated so concurrent workers aggregate deterministically.
      counts.total = queue.totalRecords;
      counts.attention = queue.records.filter(
        (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
      ).length;

      // History polling
      const historyCursorState = historyCursorFromState(state);
      const { allFetched: historyRecords, newRecords: newHistory } = await fetchNewHistoryPages(client, historyCursorState);
      logger.debug('Sonarr history polled', {
        instanceId,
        historyCount: historyRecords.length,
        lastHistoryDate: state.lastHistoryDate,
        newHistoryCount: newHistory.length,
      }, { scope: 'polling' });

      for (const item of newHistory) {
        if (item.eventType === 'downloadFolderImported' || item.eventType === 'episodeFileImported') {
          const metadata = {
            source: 'sonarr' as const,
            instanceId,
            instanceLabel,
            id: item.id,
            seriesId: item.seriesId,
            seasonNumber: item.episode?.seasonNumber,
            episodeId: item.episodeId ?? item.episode?.id,
            ...mediaFilterMeta(item, tagMap),
          };
          const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';

          collector.add({
            eventType: 'imported',
            title: instanceTitle('Episode Imported', instanceLabel, n),
            body: `${item.sourceTitle}`,
            metadata: { ...metadata, redirect },
            url: redirect,
          }, { service: 'sonarr', instanceId, reason: 'history-imported', historyId: item.id });
        }
      }

      // A new import means the library changed: bust the cached library here
      // so freshness doesn't depend on a browser polling the command status
      // to completion. warmCaches re-populates fresh data next cycle.
      if (newHistory.some((item) => item.eventType === 'downloadFolderImported' || item.eventType === 'episodeFileImported')) {
        await invalidateTaggedLibrary('sonarr', instanceId);
      }

      // Health check
      const health = await client.getHealth();
      const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
      logger.debug('Sonarr health polled', {
        instanceId,
        healthCount: health.length,
        changed: Boolean(state.lastHealthHash && healthHash !== state.lastHealthHash),
      }, { scope: 'polling' });
      if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
        await notifyAndLog({
          eventType: 'healthWarning',
          title: instanceTitle('Sonarr Health Warning', instanceLabel, n),
          body: health.map((h) => h.message).join('; ').slice(0, 200),
          url: '/settings',
        }, { service: 'sonarr', instanceId, reason: 'health-changed', healthCount: health.length });
      }

      // Collapse same-type bursts (e.g. a season pack) into one grouped
      // notification per (instance, eventType); below-threshold groups and
      // singletons send individually. No-op shape when grouping is disabled.
      await collector.flush({ enabled: groupingEnabled, notify: notifyAndLog });

      // Update state
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
      logger.debug('Sonarr polling state updated', {
        instanceId,
        queueCount: currentSnapshots.length,
        lastHistoryDate: cursor.lastHistoryDate,
        healthHash,
      }, { scope: 'polling' });
      return counts;
    }).catch((error) => {
      noteJobFailure(error);
      logger.warn('Sonarr instance poll failed', { instanceId, error: errorMessage(error) }, { scope: 'polling' });
      return counts;
    });
  });
  context.markInstanceSourceReady('sonarr');
  const instanceCounts = await Promise.all(instanceTasks);

  await writeBadgeSlice('activity', 'sonarr', {
    total: instanceCounts.reduce((sum, counts) => sum + counts.total, 0),
    attention: instanceCounts.reduce((sum, counts) => sum + counts.attention, 0),
  });
}
