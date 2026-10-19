import type { Capability } from '@/lib/capabilities';
import { MAX_TORRENT_BYTES, parseMagnet, parseTorrentFile, ReleaseSourceError, type ReleaseSource } from './release-source';
import type { AddOptions, ManualDownloadService, PreflightInput } from './preflight';

/**
 * Reading a manual-download request from the browser: multipart form data with
 * a `request` JSON field, and a `torrent` file field for a .torrent upload.
 * Everything is checked here; nothing from the browser is passed on unchecked.
 */

export class ManualDownloadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualDownloadRequestError';
  }
}

/** What each service's manual download needs on top of torrents.add and activity.manage. */
export const SERVICE_ADD_CAPABILITY: Record<ManualDownloadService, Capability> = {
  RADARR: 'movies.add',
  SONARR: 'series.add',
};

const positiveInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function readAdd(service: ManualDownloadService, value: unknown): AddOptions | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') throw new ManualDownloadRequestError('Invalid add options.');
  const add = value as Record<string, unknown>;
  if (!positiveInt(add.qualityProfileId)) throw new ManualDownloadRequestError('Choose a quality profile.');
  if (typeof add.rootFolderPath !== 'string' || !add.rootFolderPath.trim()) throw new ManualDownloadRequestError('Choose a root folder.');
  const tags = add.tags ?? [];
  if (!Array.isArray(tags) || !tags.every(positiveInt)) throw new ManualDownloadRequestError('Invalid tags.');
  const options: AddOptions = { qualityProfileId: add.qualityProfileId, rootFolderPath: add.rootFolderPath, tags: tags as number[] };
  if (service === 'RADARR') {
    const availability = add.minimumAvailability ?? 'released';
    if (availability !== 'announced' && availability !== 'inCinemas' && availability !== 'released') throw new ManualDownloadRequestError('Invalid minimum availability.');
    options.minimumAvailability = availability;
  } else {
    const seriesType = add.seriesType ?? 'standard';
    if (seriesType !== 'standard' && seriesType !== 'daily' && seriesType !== 'anime') throw new ManualDownloadRequestError('Invalid series type.');
    options.seriesType = seriesType;
    options.seasonFolder = add.seasonFolder !== false;
  }
  return options;
}

export interface ManualDownloadRequest {
  input: PreflightInput;
  /** The submitting client's idempotency key (create only). */
  clientRequestId?: string;
}

export async function readManualDownloadRequest(form: FormData): Promise<ManualDownloadRequest> {
  const raw = form.get('request');
  if (typeof raw !== 'string') throw new ManualDownloadRequestError('Missing request.');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ManualDownloadRequestError('Invalid request.');
  }
  const service = body.service;
  if (service !== 'RADARR' && service !== 'SONARR') throw new ManualDownloadRequestError('Choose Radarr or Sonarr.');
  if (typeof body.instanceId !== 'string' || !body.instanceId) throw new ManualDownloadRequestError('Choose an instance.');
  if (!positiveInt(body.externalId)) throw new ManualDownloadRequestError('Choose a title.');
  if (body.downloadClientId !== undefined && !positiveInt(body.downloadClientId)) throw new ManualDownloadRequestError('Invalid download client.');
  if (body.releaseTitle !== undefined && typeof body.releaseTitle !== 'string') throw new ManualDownloadRequestError('Invalid release name.');
  if (body.clientRequestId !== undefined && (typeof body.clientRequestId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.clientRequestId))) {
    throw new ManualDownloadRequestError('Invalid request id.');
  }

  let source: ReleaseSource;
  try {
    const torrent = form.get('torrent');
    if (torrent instanceof File) {
      if (torrent.size > MAX_TORRENT_BYTES) throw new ReleaseSourceError('That .torrent file is too large.');
      source = parseTorrentFile(Buffer.from(await torrent.arrayBuffer()));
    } else if (typeof body.magnetUrl === 'string') {
      source = parseMagnet(body.magnetUrl);
    } else {
      throw new ManualDownloadRequestError('Paste a magnet link or choose a .torrent file.');
    }
  } catch (error) {
    if (error instanceof ReleaseSourceError) throw new ManualDownloadRequestError(error.message);
    throw error;
  }

  return {
    input: {
      service,
      instanceId: body.instanceId,
      externalId: body.externalId as number,
      source,
      releaseTitle: typeof body.releaseTitle === 'string' ? body.releaseTitle : source.name,
      downloadClientId: body.downloadClientId as number | undefined,
      add: readAdd(service, body.add),
      monitorTarget: body.monitorTarget === true,
    },
    clientRequestId: body.clientRequestId as string | undefined,
  };
}
