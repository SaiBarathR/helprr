import { createHash } from 'crypto';
import { ManualDownloadMode, ManualDownloadStatus, ServiceType } from '@prisma/client';
import { isAxiosError } from 'axios';
import { prisma } from '@/lib/db';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { logger } from '@/lib/logger';
import { parseMagnetInfoHash } from '@/lib/magnet';

type Service = 'SONARR' | 'RADARR';

export type ManualDownloadPreflightInput = {
  mode: 'ARR_MANAGED';
  service: Service;
  instanceId: string;
  media: Record<string, unknown>;
  magnetUrl?: string;
};

type CreateInput = ManualDownloadPreflightInput & {
  torrentName?: string;
  createdByUserId?: string;
};

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeError(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data;
    if (Array.isArray(data)) {
      return data.map((item) => item && typeof item === 'object' && 'errorMessage' in item ? String(item.errorMessage) : '').filter(Boolean).join('; ') || 'Arr rejected the release';
    }
  }
  return error instanceof Error ? error.message : 'Manual download failed';
}

function serviceType(service: Service): ServiceType {
  return service === 'SONARR' ? ServiceType.SONARR : ServiceType.RADARR;
}

async function arrClient(service: Service, instanceId: string) {
  return service === 'SONARR' ? getSonarrClient(instanceId) : getRadarrClient(instanceId);
}

export async function preflightManualDownload(input: ManualDownloadPreflightInput) {
  if (!input.instanceId) throw new Error('An Arr instance is required');
  const client = await arrClient(input.service, input.instanceId);
  const [clients, profiles, roots] = await Promise.all([
    client.getDownloadClients(), client.getQualityProfiles(), client.getRootFolders(),
  ]);
  const torrentClients = clients.filter((item) => item.enable && item.protocol === 'torrent');
  if (!torrentClients.length) throw new Error('The selected Arr instance has no enabled torrent download client');

  const profileId = positiveInt(input.media.qualityProfileId);
  const rootPath = typeof input.media.rootFolderPath === 'string' ? input.media.rootFolderPath : '';
  if (!profileId || !profiles.some((profile) => profile.id === profileId)) throw new Error('The quality profile does not belong to the selected instance');
  if (!rootPath || !roots.some((root) => root.path === rootPath)) throw new Error('The root folder does not belong to the selected instance');

  const externalId = input.service === 'SONARR' ? positiveInt(input.media.tvdbId) : positiveInt(input.media.tmdbId);
  if (!externalId) throw new Error(input.service === 'SONARR' ? 'A valid TVDB id is required' : 'A valid TMDB id is required');
  const existing = input.service === 'SONARR'
    ? (await getSonarrClient(input.instanceId)).getSeries().then((items) => items.find((item) => item.tvdbId === externalId))
    : (await getRadarrClient(input.instanceId)).getMovies().then((items) => items.find((item) => item.tmdbId === externalId));
  if (await existing) throw Object.assign(new Error('The selected title already exists in this instance'), { code: 'MEDIA_EXISTS' });

  if (!input.magnetUrl) throw new Error('Arr-managed downloads require a magnet URL');
  parseMagnetInfoHash(input.magnetUrl);
  if (!getMagnetReleaseTitle(input.magnetUrl)) {
    throw new Error('The magnet must include a display name (dn) so Arr can identify the movie, episode, or season pack');
  }
  return {
    service: input.service,
    instanceId: input.instanceId,
    mode: 'ARR_MANAGED' as const,
    externalId,
    downloadClients: torrentClients.map((item) => ({ id: item.id, name: item.name, priority: item.priority })),
    arrSelectsClient: input.mode === 'ARR_MANAGED',
  };
}

export function getMagnetReleaseTitle(magnetUrl: string): string | null {
  const queryStart = magnetUrl.indexOf('?');
  if (queryStart < 0) return null;
  const title = new URLSearchParams(magnetUrl.slice(queryStart + 1)).get('dn')?.trim();
  return title || null;
}

export function buildArrReleasePushPayload(input: {
  service: Service;
  arrItemId: number;
  magnetUrl: string;
  infoHash: string;
  publishDate: string;
}) {
  const title = getMagnetReleaseTitle(input.magnetUrl);
  if (!title) throw new Error('The magnet must include a display name (dn)');
  return {
    title,
    protocol: 'torrent' as const,
    publishDate: input.publishDate,
    magnetUrl: input.magnetUrl,
    infoHash: input.infoHash,
    indexer: 'Helprr manual download',
    shouldOverride: true,
    ...(input.service === 'SONARR' ? { seriesId: input.arrItemId } : { movieId: input.arrItemId }),
  };
}

export function buildManualDownloadRequestKey(input: {
  actorId?: string;
  instanceId: string;
  externalId: number;
  infoHash: string;
}) {
  return createHash('sha256')
    .update(`${input.actorId ?? 'system'}:${input.instanceId}:${input.externalId}:${input.infoHash.toLowerCase()}`)
    .digest('hex');
}

export function hasNewArrFileId(initialIds: unknown, currentIds: number[]) {
  const baseline = new Set(Array.isArray(initialIds) ? initialIds.filter((id): id is number => typeof id === 'number') : []);
  return currentIds.some((id) => !baseline.has(id));
}

function strictCreateFields(media: Record<string, unknown>) {
  return {
    qualityProfileId: positiveInt(media.qualityProfileId) ?? undefined,
    rootFolderPath: typeof media.rootFolderPath === 'string' ? media.rootFolderPath : undefined,
    monitored: media.monitored !== false,
    tags: Array.isArray(media.tags) ? media.tags.filter((id): id is number => Number.isInteger(id)) : [],
  };
}

export async function createManualDownloadMapping(input: CreateInput) {
  if (!prisma.manualDownloadMapping) throw new Error('Manual download mappings are not loaded. Apply migrations and restart Helprr.');
  const hash = parseMagnetInfoHash(input.magnetUrl!).normalizedHexHash;
  const externalId = input.service === 'SONARR' ? positiveInt(input.media.tvdbId) : positiveInt(input.media.tmdbId);
  if (!externalId) throw new Error(input.service === 'SONARR' ? 'A valid TVDB id is required' : 'A valid TMDB id is required');
  // Stable across response loss/retries, but does not persist the magnet or its
  // tracker parameters. A user may link the same release to another instance.
  const requestKey = buildManualDownloadRequestKey({ actorId: input.createdByUserId, instanceId: input.instanceId, externalId, infoHash: hash });
  const duplicate = await prisma.manualDownloadMapping.findUnique({ where: { requestKey } });
  if (duplicate && duplicate.status !== ManualDownloadStatus.FAILED) return duplicate;
  if (duplicate) await prisma.manualDownloadMapping.delete({ where: { id: duplicate.id } });
  const plan = await preflightManualDownload(input);
  const mode = ManualDownloadMode.ARR_MANAGED;

  const common = strictCreateFields(input.media);
  let created: { id: number; title: string };
  let initialFileIds: number[] = [];
  if (input.service === 'RADARR') {
    const client = await getRadarrClient(input.instanceId);
    const lookup = (await client.lookupMovie(`tmdb:${plan.externalId}`)).find((item) => item.tmdbId === plan.externalId);
    if (!lookup) throw new Error('Radarr could not resolve the selected movie');
    created = await client.addMovie({ ...lookup, ...common, tmdbId: plan.externalId, minimumAvailability: typeof input.media.minimumAvailability === 'string' ? input.media.minimumAvailability : 'released', addOptions: { searchForMovie: false, monitor: 'movieOnly' } } as Parameters<typeof client.addMovie>[0]);
    initialFileIds = (await client.getMovieFiles(created.id)).map((file) => file.id);
    await invalidateTaggedLibrary('radarr', input.instanceId);
  } else {
    const client = await getSonarrClient(input.instanceId);
    const lookup = (await client.lookupSeries(`tvdb:${plan.externalId}`)).find((item) => item.tvdbId === plan.externalId);
    if (!lookup) throw new Error('Sonarr could not resolve the selected series');
    created = await client.addSeries({ ...lookup, ...common, tvdbId: plan.externalId, monitor: typeof input.media.monitor === 'string' ? input.media.monitor : 'all', seasonFolder: input.media.seasonFolder !== false, seriesType: typeof input.media.seriesType === 'string' ? input.media.seriesType : 'standard', addOptions: { monitor: typeof input.media.monitor === 'string' ? input.media.monitor : 'all', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false } } as Parameters<typeof client.addSeries>[0]);
    initialFileIds = (await client.getEpisodeFiles(created.id)).map((file) => file.id);
    await invalidateTaggedLibrary('sonarr', input.instanceId);
  }

  const mapping = await prisma.manualDownloadMapping.create({ data: {
    mode, requestKey, torrentHash: hash, torrentName: getMagnetReleaseTitle(input.magnetUrl!)!,
    service: serviceType(input.service), instanceId: input.instanceId, externalId: plan.externalId,
    arrItemId: created.id, arrTitle: created.title, status: ManualDownloadStatus.SUBMITTING_RELEASE,
    initialFileIds, createdByUserId: input.createdByUserId,
  } });
  const attempt = await prisma.manualDownloadAttempt.create({
    data: { mappingId: mapping.id, attempt: 1, outcome: 'SUBMITTING' },
  });
  try {
    const client = await arrClient(input.service, input.instanceId);
    const decisions = await client.pushRelease(buildArrReleasePushPayload({
      service: input.service, arrItemId: created.id, magnetUrl: input.magnetUrl!,
      infoHash: hash, publishDate: new Date().toISOString(),
    }));
    const decision = decisions[0];
    if (!decision || decision.rejected || !decision.downloadAllowed) throw new Error(decision?.rejections?.join('; ') || 'Arr did not accept the release');
    await prisma.manualDownloadAttempt.update({
      where: { id: attempt.id }, data: { outcome: 'ACCEPTED', finishedAt: new Date() },
    });
    return prisma.manualDownloadMapping.update({ where: { id: mapping.id }, data: { status: ManualDownloadStatus.QUEUED, attemptCount: 1 } });
  } catch (error) {
    const message = safeError(error);
    let compensated = false;
    try {
      if (input.service === 'SONARR') await (await getSonarrClient(input.instanceId)).deleteSeries(created.id, false);
      else await (await getRadarrClient(input.instanceId)).deleteMovie(created.id, false);
      compensated = true;
    } catch (compensationError) {
      logger.error('Failed to compensate rejected Arr-managed release', { mappingId: mapping.id, error: safeError(compensationError) }, { scope: 'manual-download' });
    }
    await prisma.manualDownloadMapping.update({ where: { id: mapping.id }, data: { status: ManualDownloadStatus.FAILED, lastError: compensated ? `${message}. The newly-created library item was removed.` : `${message}. The newly-created empty library item could not be removed automatically.` } });
    await prisma.manualDownloadAttempt.update({
      where: { id: attempt.id }, data: { outcome: 'FAILED', error: message, finishedAt: new Date() },
    });
    throw new Error(compensated ? `${message}. Nothing was downloaded and the new library item was removed.` : `${message}. Nothing was downloaded; remove the newly-created empty library item manually.`);
  }
}

export async function reconcileManualDownloads() {
  const mappings = await prisma.manualDownloadMapping.findMany({ where: { status: { in: [ManualDownloadStatus.QUEUED, ManualDownloadStatus.DOWNLOADING, ManualDownloadStatus.IMPORT_PENDING] } } });
  for (const mapping of mappings) {
    if (mapping.mode !== ManualDownloadMode.ARR_MANAGED) continue;
    try {
      const client = mapping.service === ServiceType.SONARR ? await getSonarrClient(mapping.instanceId) : await getRadarrClient(mapping.instanceId);
      const [queue, history] = await Promise.all([
        client.getQueue(1, 1000),
        client.getHistory(1, 50, 'date', 'descending', mapping.torrentHash ? { downloadId: mapping.torrentHash } : undefined),
      ]);
      const item = queue.records.find((row) => row.downloadId?.toLowerCase() === mapping.torrentHash?.toLowerCase());
      const currentIds = mapping.service === ServiceType.SONARR ? (await getSonarrClient(mapping.instanceId)).getEpisodeFiles(mapping.arrItemId).then((files) => files.map((file) => file.id)) : (await getRadarrClient(mapping.instanceId)).getMovieFiles(mapping.arrItemId).then((files) => files.map((file) => file.id));
      const imported = hasNewArrFileId(mapping.initialFileIds, await currentIds);
      const failedHistory = history.records.find((record) => /fail/i.test(record.eventType));
      const historyError = failedHistory
        ? failedHistory.data.message || failedHistory.data.reason || `Arr reported ${failedHistory.eventType}`
        : null;
      await prisma.manualDownloadMapping.update({
        where: { id: mapping.id },
        data: imported
          ? { status: ManualDownloadStatus.IMPORTED, completedAt: new Date(), arrQueueId: null, lastError: null }
          : item
            ? { status: item.sizeleft > 0 ? ManualDownloadStatus.DOWNLOADING : ManualDownloadStatus.IMPORT_PENDING, arrDownloadId: item.downloadId, arrQueueId: item.id, lastError: item.errorMessage || null }
            : historyError
              ? { status: ManualDownloadStatus.BLOCKED, arrQueueId: null, lastError: historyError }
              : { status: ManualDownloadStatus.QUEUED },
      });
    } catch (error) {
      logger.warn('Arr-managed download reconciliation failed', { mappingId: mapping.id, error: safeError(error) }, { scope: 'polling' });
    }
  }
}
