import { Prisma, type ManualDownload, type ManualDownloadFile, type ManualDownloadSource } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { runWithOperationAudit, systemAuditActor, type AuditActor } from '@/lib/file-audit';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { ManualImportItem } from '@/types';
import {
  addOptionIssues,
  addTitlePayload,
  arrClientFor,
  TERMINAL_STATUSES,
  type AddOptions,
  type ManualDownloadService,
  type PreflightIssue,
} from './preflight';
import { moveTo, withEvents, type ManualDownloadWithEvents } from './send';
import { applyMapping, arrPathCandidates, joinPath, splitPath, type ArrPathCandidate } from './path-mapping';

/**
 * The advanced fallback (QBIT_REVIEWED): the user picks the torrent's files
 * before anything downloads, qBittorrent downloads only those, and Arr imports
 * them through its manual import. Arr does the mapping: Helprr asks Arr what
 * each downloaded file is, imports on its own only when Arr is sure of every
 * file, and otherwise asks the user. Only the files chosen up front are ever
 * scanned or imported (the allowlist), and imports copy (hardlink), so the
 * torrent keeps seeding.
 */

export interface FallbackInput {
  service: ManualDownloadService;
  instanceId: string;
  externalId: number;
  /** The torrent, already in Helprr's qBittorrent and stopped. */
  infoHash: string;
  /** qBittorrent's indexes of the files to download; the others never download. */
  selectedFileIndexes: number[];
  source: ManualDownloadSource;
  add?: AddOptions;
}

export interface FallbackPlan {
  instance: { id: string; label: string } | null;
  target: { externalId: number; title: string; year: number; existingId: number | null } | null;
  torrent: { name: string; savePath: string; files: Array<{ index: number; path: string; size: number; selected: boolean }> } | null;
  /** Where Arr sees qBittorrent's download folder, checked against Arr's own listing. */
  arrSavePath: string | null;
  mapping: ArrPathCandidate['mapping'];
}

export interface FallbackCheck {
  ok: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  plan: FallbackPlan;
}

export class FallbackRefusedError extends Error {
  constructor(readonly result: FallbackCheck) {
    super(result.errors.map((issue) => issue.message).join(' '));
    this.name = 'FallbackRefusedError';
  }
}

const STOPPED = new Set(['pausedDL', 'stoppedDL', 'pausedUP', 'stoppedUP']);
const appOf = (service: ManualDownloadService) => (service === 'RADARR' ? 'Radarr' : 'Sonarr');

/** Whether Arr sees a folder, or a file of this size. A missing folder lists as empty, so look from its parent. */
export async function arrSees(client: RadarrClient | SonarrClient, path: string, size?: number): Promise<boolean> {
  const { folder, name } = splitPath(path.replace(/[\\/]+$/, ''));
  if (!folder || !name) return false;
  const listing = await client.listFolder(folder);
  return size === undefined
    ? listing.directories.some((entry) => entry.name === name)
    : listing.files.some((entry) => entry.name === name && entry.size === size);
}

/** Everything that must hold before the torrent starts, and what Helprr will do. */
export async function checkFallback(input: FallbackInput): Promise<FallbackCheck> {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];
  const error = (code: string, message: string) => errors.push({ code, message });
  const app = appOf(input.service);
  const plan: FallbackPlan = { instance: null, target: null, torrent: null, arrSavePath: null, mapping: null };
  const done = () => ({ ok: errors.length === 0, errors, warnings, plan });

  let connection;
  try {
    connection = await resolveConnection(input.service, input.instanceId);
  } catch {
    error('INSTANCE_NOT_FOUND', `That ${app} instance no longer exists.`);
    return done();
  }
  plan.instance = { id: connection.id, label: connection.label };

  let torrent;
  let files;
  try {
    const qbit = await getQBittorrentClient();
    [torrent] = await qbit.getTorrents(undefined, undefined, undefined, undefined, input.infoHash.toLowerCase());
    files = torrent ? await qbit.getTorrentFiles(torrent.hash) : [];
  } catch {
    error('QBITTORRENT_UNREACHABLE', 'qBittorrent did not answer. Check that it is running and try again.');
    return done();
  }
  if (!torrent) {
    error('TORRENT_NOT_FOUND', 'That torrent is not in qBittorrent any more. Add it again.');
    return done();
  }
  const selected = new Set(input.selectedFileIndexes);
  plan.torrent = {
    name: torrent.name,
    savePath: torrent.save_path,
    files: files.map((file) => ({ index: file.index, path: file.name, size: file.size, selected: selected.has(file.index) })),
  };
  if (files.length === 0) error('TORRENT_NO_METADATA', "qBittorrent does not have this torrent's file list yet. Wait a moment and try again.");
  else if (selected.size === 0) error('NO_FILES_SELECTED', 'Choose at least one file to download.');
  else if ([...selected].some((index) => !files.some((file) => file.index === index))) error('FILE_INDEX_INVALID', 'A chosen file is not in this torrent.');
  if (!STOPPED.has(torrent.state)) error('TORRENT_RUNNING', 'The torrent has already started. Files can only be chosen before it downloads.');

  const active = await prisma.manualDownload.findFirst({
    where: { instanceId: connection.id, infoHash: input.infoHash, status: { notIn: [...TERMINAL_STATUSES] } },
    select: { arrItemTitle: true },
  });
  if (active) error('ALREADY_ACTIVE', `This torrent is already linked to ${active.arrItemTitle} in ${connection.label}.`);

  const client = arrClientFor(input.service, connection);
  let found: { id?: number | null; title: string; year: number; tmdbId?: number; tvdbId?: number } | undefined;
  let clients;
  let mappings;
  try {
    const term = input.service === 'RADARR' ? `tmdb:${input.externalId}` : `tvdb:${input.externalId}`;
    const lookup = input.service === 'RADARR' ? (client as RadarrClient).lookupMovie(term) : (client as SonarrClient).lookupSeries(term);
    const [results, downloadClients, remoteMappings] = await Promise.all([lookup, client.getDownloadClients(), client.getRemotePathMappings()]);
    found = (results as Array<NonNullable<typeof found>>).find((result) => (input.service === 'RADARR' ? result.tmdbId : result.tvdbId) === input.externalId);
    clients = downloadClients;
    mappings = remoteMappings;
    if (found && !(found.id && found.id > 0) && input.add) {
      const [profiles, folders, tags] = await Promise.all([client.getQualityProfiles(), client.getRootFolders(), client.getTags()]);
      errors.push(...addOptionIssues(input.add, { profiles, folders, tags }, connection.label));
    }
  } catch {
    error('INSTANCE_UNREACHABLE', `${connection.label} did not answer. Check that ${app} is running and try again.`);
    return done();
  }
  if (!found) {
    error('TITLE_NOT_FOUND', `${app} could not find that title.`);
    return done();
  }
  const existingId = found.id && found.id > 0 ? found.id : null;
  plan.target = { externalId: input.externalId, title: found.title, year: found.year, existingId };
  if (!existingId && !input.add) error('ADD_OPTIONS_REQUIRED', `${found.title} is not in ${connection.label} yet: choose a quality profile and root folder.`);

  // A category Arr watches would let Arr import the torrent on its own, files and all.
  const categoryField = input.service === 'RADARR' ? 'movieCategory' : 'tvCategory';
  const watching = clients.filter((dc) => dc.enable && dc.protocol === 'torrent');
  const watched = watching.map((dc) => dc.fields?.find((field) => field.name === categoryField)?.value);
  if (torrent.category && watched.includes(torrent.category)) {
    error('TORRENT_IN_ARR_CATEGORY', `The torrent is in the "${torrent.category}" category, which ${app} watches, so ${app} would import it on its own. Remove the category in qBittorrent first.`);
  } else if (watched.some((category) => category === '' || category === undefined || category === null)) {
    warnings.push({ code: 'ARR_CLIENT_WITHOUT_CATEGORY', message: `A download client in ${connection.label} has no category, so ${app} watches every torrent there and may import this one on its own when it finishes.` });
  }

  // Arr must see the folder qBittorrent saves into, directly or through its remote path mappings.
  try {
    for (const candidate of arrPathCandidates(torrent.save_path, mappings)) {
      if (await arrSees(client, candidate.path)) {
        plan.arrSavePath = candidate.path;
        plan.mapping = candidate.mapping;
        break;
      }
    }
  } catch {
    error('INSTANCE_UNREACHABLE', `${connection.label} did not answer. Check that ${app} is running and try again.`);
    return done();
  }
  if (!plan.arrSavePath) {
    error('PATH_NOT_VISIBLE', `${app} cannot see qBittorrent's download folder (${torrent.save_path}). If ${app} runs in Docker or on another machine, add a remote path mapping for it in ${app} (Settings → Download Clients).`);
  }
  return done();
}

/**
 * Start the fallback: record the workflow and the exact files chosen, add the
 * title (searches off) when needed, then let qBittorrent download only the
 * chosen files. A repeated request (same user and clientRequestId) returns
 * the workflow it started.
 */
export async function startFallbackDownload(
  input: FallbackInput,
  clientRequestId: string,
  actor: AuditActor & { id: string },
): Promise<ManualDownloadWithEvents> {
  const repeat = await prisma.manualDownload.findUnique({
    where: { createdByUserId_clientRequestId: { createdByUserId: actor.id, clientRequestId } },
    select: { id: true },
  });
  if (repeat) return withEvents(repeat.id);

  const check = await checkFallback(input);
  if (!check.ok) throw new FallbackRefusedError(check);
  const { instance, target, torrent } = check.plan as Required<{ [K in keyof FallbackPlan]: NonNullable<FallbackPlan[K]> }>;

  let id: string;
  try {
    const recorded = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`manual-download:${instance.id}:${input.infoHash}`}))`;
      const active = await tx.manualDownload.findFirst({
        where: { instanceId: instance.id, infoHash: input.infoHash, status: { notIn: [...TERMINAL_STATUSES] } },
        select: { id: true, createdByUserId: true, clientRequestId: true },
      });
      if (active && active.createdByUserId === actor.id && active.clientRequestId === clientRequestId) return { id: active.id, repeat: true };
      if (active) {
        throw new FallbackRefusedError({ ...check, ok: false, errors: [{ code: 'ALREADY_ACTIVE', message: `This torrent is already linked in ${instance.label}.` }] });
      }
      const created = await tx.manualDownload.create({
        data: {
          mode: 'QBIT_REVIEWED',
          status: 'PREFLIGHT',
          service: input.service,
          instanceId: instance.id,
          instanceLabel: instance.label,
          externalId: target.externalId,
          arrItemId: target.existingId,
          arrItemTitle: target.title,
          releaseTitle: torrent.name,
          source: input.source,
          infoHash: input.infoHash,
          torrentName: torrent.name,
          downloadClientName: 'qBittorrent',
          baselineFileIds: [],
          pathMapping: { mapping: check.plan.mapping },
          clientRequestId,
          createdByUserId: actor.id,
          createdByUsername: actor.username,
          events: { create: { status: 'PREFLIGHT', message: 'Checked: ready to download the chosen files.' } },
          files: {
            create: torrent.files.map((file) => ({ fileIndex: file.index, path: file.path, size: BigInt(file.size), selected: file.selected })),
          },
        },
        select: { id: true },
      });
      return { id: created.id, repeat: false };
    });
    if (recorded.repeat) return withEvents(recorded.id);
    id = recorded.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.manualDownload.findUnique({
        where: { createdByUserId_clientRequestId: { createdByUserId: actor.id, clientRequestId } },
        select: { id: true },
      });
      if (winner) return withEvents(winner.id);
    }
    throw error;
  }

  const app = appOf(input.service);
  const client = arrClientFor(input.service, await resolveConnection(input.service, instance.id));
  let arrItemId = target.existingId;
  try {
    if (!arrItemId) {
      await moveTo(id, 'CREATING_MEDIA', `Adding ${target.title} to ${instance.label} with searches off.`);
      const payload = addTitlePayload(input.service, target, input.add!);
      const added = await runWithOperationAudit({
        user: actor, service: input.service, instanceId: instance.id, operation: 'CREATE_MEDIA',
        targetType: input.service === 'RADARR' ? 'movie' : 'series', targetId: null, targetTitle: target.title, itemCount: 1,
        details: { manualDownloadId: id, externalId: target.externalId },
      }, async (): Promise<{ id: number }> => (input.service === 'RADARR' ? (client as RadarrClient).addMovie(payload as never) : (client as SonarrClient).addSeries(payload as never)));
      arrItemId = added.id;
      await prisma.manualDownload.update({ where: { id }, data: { arrItemId, createdArrItem: true } });
      void invalidateTaggedLibrary(input.service === 'RADARR' ? 'radarr' : 'sonarr', instance.id).catch(() => {});
    }
  } catch (error) {
    await moveTo(id, 'FAILED', `${app} did not add ${target.title}: ${error instanceof Error ? error.message : String(error)}`);
    return withEvents(id);
  }

  try {
    const qbit = await getQBittorrentClient();
    const hash = input.infoHash.toLowerCase();
    const skipped = torrent.files.filter((file) => !file.selected).map((file) => file.index);
    const chosen = torrent.files.filter((file) => file.selected).map((file) => file.index);
    if (skipped.length > 0) await qbit.setFilePriority(hash, skipped, 0);
    await qbit.setFilePriority(hash, chosen, 1);
    await qbit.resumeTorrent(hash);
  } catch (error) {
    await moveTo(id, 'BLOCKED', `qBittorrent did not start the download: ${error instanceof Error ? error.message : String(error)}. Start it in qBittorrent, or cancel this download.`);
    return withEvents(id);
  }
  const count = torrent.files.filter((file) => file.selected).length;
  await moveTo(id, 'DOWNLOADING', `Downloading ${count} of ${torrent.files.length} file${torrent.files.length === 1 ? '' : 's'} in qBittorrent.`);
  return withEvents(id);
}

export type FallbackFile = ManualDownloadFile;
type Candidate = Pick<ManualImportItem, 'path' | 'quality' | 'languages' | 'releaseGroup' | 'indexerFlags' | 'releaseType' | 'rejections'> & {
  movie?: { id: number; title: string } | null;
  series?: { id: number; title: string } | null;
  episodes?: Array<{ id: number; seasonNumber: number; episodeNumber: number }>;
};

/** The part of Arr's candidate Helprr keeps, to show and to import from. */
function keep(item: ManualImportItem): Candidate {
  return {
    path: item.path,
    quality: item.quality,
    languages: item.languages,
    releaseGroup: item.releaseGroup,
    indexerFlags: item.indexerFlags,
    releaseType: item.releaseType,
    rejections: item.rejections,
    movie: item.movie ? { id: item.movie.id, title: item.movie.title } : null,
    series: item.series ? { id: item.series.id, title: item.series.title } : null,
    episodes: (item.episodes ?? []).map((episode) => ({ id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber })),
  };
}

const sameFile = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
const isSample = (candidate: Candidate) => candidate.rejections.some((rejection) => /sample/i.test(rejection.reason));

export interface ScanOutcome {
  /** Files that could not be found where Arr should see them. */
  missing: string[];
  /** Every chosen video file Arr maps to the target without objection (samples aside). */
  unambiguous: boolean;
  reasons: string[];
}

/**
 * The download finished: find each chosen file where Arr sees it, ask Arr's
 * manual import what each one is, and keep only the chosen files' answers.
 */
export async function scanFallback(
  download: ManualDownload & { files: ManualDownloadFile[] },
  client: RadarrClient | SonarrClient,
  savePath: string,
): Promise<ScanOutcome> {
  const mapping = ((download.pathMapping as { mapping?: ArrPathCandidate['mapping'] } | null)?.mapping) ?? null;
  const chosen = download.files.filter((file) => file.selected);
  const located = chosen.map((file) => ({ file, arrPath: applyMapping(joinPath(savePath, file.path), mapping) }));

  const missing: string[] = [];
  for (const { file, arrPath } of located) {
    if (!(await arrSees(client, arrPath, Number(file.size)))) missing.push(file.path);
  }
  if (missing.length > 0) return { missing, unambiguous: false, reasons: [] };

  // One scan of the torrent's own folder when every file sits in it; otherwise each file on its own.
  const roots = new Set(chosen.map((file) => file.path.split(/[\\/]/)[0]));
  const multiFile = download.files.length > 1 && roots.size === 1 && chosen.every((file) => /[\\/]/.test(file.path));
  const scans = multiFile
    ? [applyMapping(joinPath(savePath, [...roots][0]), mapping)]
    : located.map((entry) => entry.arrPath);
  const items: ManualImportItem[] = [];
  for (const folder of scans) {
    items.push(...await client.scanImportPath(folder));
  }

  const app = appOf(download.service as ManualDownloadService);
  const reasons: string[] = [];
  const taken = new Set<number>();
  let clean = 0;
  for (const { file, arrPath } of located) {
    const item = items.find((candidate) => sameFile(candidate.path, arrPath));
    const candidate = item ? keep(item) : null;
    await prisma.manualDownloadFile.update({
      where: { id: file.id },
      data: { arrPath, candidate: candidate ? (candidate as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    if (!candidate) continue; // not a video file: Arr imports subtitles and extras along with the video
    if (isSample(candidate)) continue;
    const name = splitPath(file.path).name;
    if (candidate.rejections.length > 0) {
      reasons.push(`${name}: ${candidate.rejections.map((rejection) => rejection.reason).join('; ')}`);
    } else if (download.service === 'RADARR' && candidate.movie?.id !== download.arrItemId) {
      reasons.push(`${name}: ${candidate.movie ? `${app} reads it as ${candidate.movie.title}` : `${app} cannot tell which movie it is`}`);
    } else if (download.service === 'SONARR' && (candidate.series?.id !== download.arrItemId || !candidate.episodes?.length)) {
      reasons.push(`${name}: ${candidate.series && candidate.series.id !== download.arrItemId ? `${app} reads it as ${candidate.series.title}` : `${app} cannot tell which episodes it holds`}`);
    } else if (candidate.episodes?.some((episode) => taken.has(episode.id))) {
      reasons.push(`${name}: another file holds the same episode`);
    } else {
      candidate.episodes?.forEach((episode) => taken.add(episode.id));
      clean += 1;
    }
  }
  if (clean === 0 && reasons.length === 0) reasons.push(`${app} found no video it can import among the chosen files`);
  if (download.service === 'RADARR' && clean > 1) reasons.push(`${clean} files each read as ${download.arrItemTitle}: choose the one to import`);
  return { missing, unambiguous: reasons.length === 0, reasons };
}

/**
 * Take the download for a scan or an import (IMPORT_PENDING), only from the
 * status it was read in: a second scan or a double-submitted import loses.
 */
async function claim(download: ManualDownload, message: string): Promise<boolean> {
  try {
    await prisma.manualDownload.update({
      where: { id: download.id, status: download.status },
      data: { status: 'IMPORT_PENDING', lastError: null, events: { create: { status: 'IMPORT_PENDING', message } } },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return false;
    throw error;
  }
}

/**
 * The chosen files finished: import them when Arr is sure of every one,
 * otherwise ask the user (NEEDS_MAPPING), or say what is in the way (BLOCKED).
 * False when another scan or import has the download already.
 */
export async function settleDownloaded(download: ManualDownload, client: RadarrClient | SonarrClient, savePath: string): Promise<boolean> {
  const app = appOf(download.service as ManualDownloadService);
  if (download.status !== 'IMPORT_PENDING' && !(await claim(download, `Downloaded. Asking ${app} what the files are.`))) return false;
  const outcome = await scanFallback(await prisma.manualDownload.findUniqueOrThrow({ where: { id: download.id }, include: { files: true } }), client, savePath);
  if (outcome.missing.length > 0) {
    const what = outcome.missing.length === 1 ? 'a downloaded file' : `${outcome.missing.length} downloaded files`;
    await moveTo(download.id, 'BLOCKED', `${app} cannot see ${what} where it should (${outcome.missing[0]}). Check ${app}'s remote path mappings, then scan again.`);
    return true;
  }
  if (!outcome.unambiguous) {
    await moveTo(download.id, 'NEEDS_MAPPING', `Confirm what the files are. ${outcome.reasons.join('. ')}.`);
    return true;
  }

  const scanned = await prisma.manualDownload.findUniqueOrThrow({ where: { id: download.id }, include: { files: true } });
  const decisions: FileDecision[] = scanned.files.filter((file) => file.selected && file.candidate).map((file) => {
    const candidate = file.candidate as unknown as Candidate;
    return isSample(candidate)
      ? { fileId: file.id, decision: 'IGNORE' }
      : { fileId: file.id, decision: 'IMPORT', episodeIds: candidate.episodes?.map((episode) => episode.id) };
  });
  await importFallback(scanned, client, decisions, systemAuditActor('manual-downloads'));
  return true;
}

export interface FileDecision {
  fileId: string;
  decision: 'IMPORT' | 'IGNORE';
  /** Sonarr: the episodes the file holds. */
  episodeIds?: number[];
}

/** Decisions that name only chosen, downloaded files, with valid episodes, and one file per episode. */
async function checkDecisions(
  download: ManualDownload & { files: ManualDownloadFile[] },
  client: RadarrClient | SonarrClient,
  decisions: FileDecision[],
): Promise<{ byId: Map<string, ManualDownloadFile>; importing: FileDecision[] }> {
  if (!['IMPORT_PENDING', 'NEEDS_MAPPING', 'BLOCKED'].includes(download.status)) {
    throw new FallbackImportError('This download cannot be imported now.');
  }
  const byId = new Map(download.files.map((file) => [file.id, file]));
  const importing = decisions.filter((decision) => decision.decision === 'IMPORT');
  if (new Set(decisions.map((decision) => decision.fileId)).size !== decisions.length) throw new FallbackImportError('A file is listed twice.');
  for (const decision of decisions) {
    const file = byId.get(decision.fileId);
    if (!file || !file.selected || !file.arrPath) throw new FallbackImportError('A file to import is not one of the downloaded files.');
  }
  if (importing.length === 0) throw new FallbackImportError('Choose at least one file to import.');
  if (download.service === 'SONARR') {
    const episodes = await (client as SonarrClient).getEpisodes(download.arrItemId!);
    const known = new Set(episodes.map((episode) => episode.id));
    const all = importing.flatMap((decision) => decision.episodeIds ?? []);
    if (importing.some((decision) => !decision.episodeIds?.length)) throw new FallbackImportError('Choose the episodes each imported file holds.');
    if (all.some((episodeId) => !known.has(episodeId))) throw new FallbackImportError(`An episode chosen is not in ${download.arrItemTitle}.`);
    if (new Set(all).size !== all.length) throw new FallbackImportError('Two files are set to the same episode.');
  } else if (importing.length > 1) {
    throw new FallbackImportError(`Import one file for ${download.arrItemTitle}.`);
  }

  return { byId, importing };
}

/** Arr's verdict on the decisions without importing anything (its reprocess): rejections per file. */
export async function previewFallback(
  download: ManualDownload & { files: ManualDownloadFile[] },
  client: RadarrClient | SonarrClient,
  decisions: FileDecision[],
): Promise<Array<{ fileId: string; rejections: string[] }>> {
  const { byId, importing } = await checkDecisions(download, client, decisions);
  const items = importing.map((decision) => importItem(download, byId.get(decision.fileId)!, decision));
  const answered = await client.reprocessManualImport(items);
  return importing.map((decision, index) => ({
    fileId: decision.fileId,
    rejections: (answered[index]?.rejections ?? []).map((rejection) => rejection.reason),
  }));
}

/** One file as Arr's manual import takes it. */
function importItem(download: ManualDownload, file: ManualDownloadFile, decision: FileDecision) {
  const candidate = (file.candidate ?? {}) as Partial<Candidate>;
  return {
    path: file.arrPath,
    ...(download.service === 'RADARR' ? { movieId: download.arrItemId } : { seriesId: download.arrItemId, episodeIds: decision.episodeIds }),
    quality: candidate.quality,
    languages: candidate.languages ?? [],
    releaseGroup: candidate.releaseGroup ?? '',
    indexerFlags: candidate.indexerFlags ?? 0,
    ...(candidate.releaseType ? { releaseType: candidate.releaseType } : {}),
    downloadId: '',
  };
}

/**
 * Import the files decided on, exactly: each must be one of the chosen files,
 * found where Arr sees it. Copies (hardlinks), so the torrent keeps seeding.
 * The decisions are kept, so a retry imports the same thing.
 */
export async function importFallback(
  download: ManualDownload & { files: ManualDownloadFile[] },
  client: RadarrClient | SonarrClient,
  decisions: FileDecision[],
  actor: AuditActor,
): Promise<void> {
  const { byId, importing } = await checkDecisions(download, client, decisions);
  // The user's import takes the download first, so a double submit imports once.
  if (download.status !== 'IMPORT_PENDING' && !(await claim(download, 'Importing the files as decided.'))) {
    throw new FallbackImportError('This download is already being imported.');
  }
  try {
    await submitImport(download, client, byId, importing, decisions, actor);
  } catch (error) {
    await moveTo(download.id, 'BLOCKED', `${appOf(download.service as ManualDownloadService)} did not take the import: ${error instanceof Error ? error.message : String(error)}. Import again.`);
    throw error;
  }
}

async function submitImport(
  download: ManualDownload & { files: ManualDownloadFile[] },
  client: RadarrClient | SonarrClient,
  byId: Map<string, ManualDownloadFile>,
  importing: FileDecision[],
  decisions: FileDecision[],
  actor: AuditActor,
): Promise<void> {
  const targetEpisodeIds = download.service === 'SONARR' ? importing.flatMap((decision) => decision.episodeIds!) : [];
  const baseline = download.service === 'RADARR'
    ? (await (client as RadarrClient).getMovieFiles(download.arrItemId!)).map((file) => file.id)
    : Object.fromEntries((await (client as SonarrClient).getEpisodes(download.arrItemId!))
      .filter((episode) => targetEpisodeIds.includes(episode.id))
      .map((episode) => [String(episode.id), episode.episodeFileId ?? 0]));

  await prisma.$transaction(decisions.map((decision) => prisma.manualDownloadFile.update({
    where: { id: decision.fileId },
    data: { decision: decision.decision, episodeIds: decision.decision === 'IMPORT' ? decision.episodeIds ?? [] : [] },
  })));

  const files = importing.map((decision) => importItem(download, byId.get(decision.fileId)!, decision));
  const command = await runWithOperationAudit({
    user: actor, service: download.service as ManualDownloadService, instanceId: download.instanceId, operation: 'IMPORT',
    targetType: download.service === 'RADARR' ? 'movie' : 'series', targetId: download.arrItemId, targetTitle: download.arrItemTitle,
    itemCount: files.length, filesDeleted: false,
    details: { manualDownloadId: download.id, files: files.map((file) => file.path), importMode: 'copy' },
  }, () => client.submitManualImport(files, 'copy'));
  await moveTo(download.id, 'IMPORTING', `Importing ${files.length} file${files.length === 1 ? '' : 's'} into ${download.arrItemTitle}.`, {
    arrCommandId: command.id,
    targetEpisodeIds,
    baselineFileIds: baseline,
  });
}

export class FallbackImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FallbackImportError';
  }
}
