import { Prisma, type ManualDownload, type ManualDownloadFile, type ManualDownloadSource, type ManualDownloadStatus } from '@prisma/client';
import axios from 'axios';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { runWithOperationAudit, systemAuditActor, type AuditActor } from '@/lib/file-audit';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { ArrRemotePathMapping, DownloadClient, HistoryItem, ManualImportItem } from '@/types';
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
import { applyMapping, arrPathCandidates, joinPath, qbittorrentHostInArr, samePath, splitPath, type ArrPathCandidate } from './path-mapping';
import { redactUpstreamText } from './redact';

/**
 * The advanced fallback (QBIT_REVIEWED): the user picks the torrent's files
 * before anything downloads, qBittorrent downloads only those, and Arr imports
 * them through its manual import. Arr does the mapping: Helprr asks Arr what
 * each downloaded file is, imports on its own only when Arr is sure of every
 * file, and otherwise asks the user. Only the files chosen up front are ever
 * scanned or imported (the allowlist), and imports copy (hardlink), so the
 * torrent keeps seeding.
 *
 * A scan, an import and a cancel each take the download first (a claim:
 * IMPORT_PENDING, from the exact state read), and write only while they still
 * hold it, so no two of them run at once and an interrupted one is picked up
 * once.
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
const CHECKING = new Set(['checkingDL', 'checkingUP', 'checkingResumeData', 'moving']);
/** qBittorrent states in which the files are not settled on disk yet. */
export const SETTLING_STATES = new Set(['moving', 'checkingUP', 'checkingDL', 'checkingResumeData', 'metaDL', 'forcedMetaDL']);
const appOf = (service: ManualDownloadService | string) => (service === 'RADARR' ? 'Radarr' : 'Sonarr');
/** An error's text as kept on the workflow: upstream text can quote credentials. */
const errorText = (error: unknown) => redactUpstreamText(error instanceof Error ? error.message : String(error));
const isLost = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

type FolderListings = Map<string, ReturnType<RadarrClient['listFolder']>>;

/**
 * Whether Arr sees a folder, or a file of this size. A missing folder lists as
 * empty, so look from its parent. `listings` lists each folder once across calls.
 */
export async function arrSees(client: RadarrClient | SonarrClient, path: string, size?: number, listings?: FolderListings): Promise<boolean> {
  const { folder, name } = splitPath(path.replace(/[\\/]+$/, ''));
  if (!folder || !name) return false;
  let listed = listings?.get(folder);
  if (!listed) {
    listed = client.listFolder(folder);
    listings?.set(folder, listed);
  }
  const listing = await listed;
  return size === undefined
    ? listing.directories.some((entry) => entry.name === name)
    : listing.files.some((entry) => entry.name === name && entry.size === size);
}

function notVisible(app: string, savePath: string, ambiguous: boolean): string {
  const which = ambiguous
    ? ` ${app} has several qBittorrent download clients and none at Helprr's qBittorrent address, so Helprr cannot tell which remote path mappings are its.`
    : '';
  return `${app} cannot see qBittorrent's download folder (${savePath}).${which} If ${app} runs in Docker or on another machine, add a remote path mapping for it in ${app} (Settings → Download Clients).`;
}

/**
 * Where Arr sees qBittorrent's folder: through a remote path mapping for the
 * host Arr knows qBittorrent by, or unchanged; each checked in Arr's own listing.
 */
async function locateSaveFolder(
  client: RadarrClient | SonarrClient,
  savePath: string,
  known?: { clients: DownloadClient[]; mappings: ArrRemotePathMapping[] },
): Promise<{ path: string | null; mapping: ArrPathCandidate['mapping']; ambiguous: boolean }> {
  const [clients, mappings, qbittorrent] = await Promise.all([
    known?.clients ?? client.getDownloadClients(),
    known?.mappings ?? client.getRemotePathMappings(),
    prisma.serviceConnection.findFirst({ where: { type: 'QBITTORRENT' }, select: { url: true } }),
  ]);
  const { host, ambiguous } = qbittorrentHostInArr(clients, qbittorrent?.url ?? null);
  for (const candidate of arrPathCandidates(savePath, mappings, host)) {
    if (await arrSees(client, candidate.path)) return { path: candidate.path, mapping: candidate.mapping, ambiguous };
  }
  return { path: null, mapping: null, ambiguous };
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
  if (CHECKING.has(torrent.state)) error('TORRENT_CHECKING', 'qBittorrent is still checking the torrent. Try again in a moment.');
  else if (!STOPPED.has(torrent.state)) error('TORRENT_RUNNING', 'The torrent has already started. Files can only be chosen before it downloads.');

  // One workflow per torrent, whichever instance: it is one torrent in Helprr's qBittorrent.
  const active = await prisma.manualDownload.findFirst({
    where: { infoHash: input.infoHash, status: { notIn: [...TERMINAL_STATUSES] } },
    select: { arrItemTitle: true, instanceLabel: true },
  });
  if (active) error('ALREADY_ACTIVE', `This torrent is already linked to ${active.arrItemTitle} in ${active.instanceLabel}.`);

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
    const where = await locateSaveFolder(client, torrent.save_path, { clients, mappings });
    plan.arrSavePath = where.path;
    plan.mapping = where.mapping;
    if (!where.path) error('PATH_NOT_VISIBLE', notVisible(app, torrent.save_path, where.ambiguous));
  } catch {
    error('INSTANCE_UNREACHABLE', `${connection.label} did not answer. Check that ${app} is running and try again.`);
    return done();
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
      // Per torrent, not per instance: two instances must not both set its files.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`manual-download:qbittorrent:${input.infoHash}`}))`;
      const active = await tx.manualDownload.findFirst({
        where: { infoHash: input.infoHash, status: { notIn: [...TERMINAL_STATUSES] } },
        select: { id: true, createdByUserId: true, clientRequestId: true, instanceLabel: true },
      });
      if (active && active.createdByUserId === actor.id && active.clientRequestId === clientRequestId) return { id: active.id, repeat: true };
      if (active) {
        throw new FallbackRefusedError({ ...check, ok: false, errors: [{ code: 'ALREADY_ACTIVE', message: `This torrent is already linked in ${active.instanceLabel}.` }] });
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
    await moveTo(id, 'FAILED', `${app} did not add ${target.title}: ${errorText(error)}`);
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
    await moveTo(id, 'BLOCKED', `qBittorrent did not start the download: ${errorText(error)}. Start it in qBittorrent, or cancel this download.`);
    return withEvents(id);
  }
  const count = torrent.files.filter((file) => file.selected).length;
  await moveTo(id, 'DOWNLOADING', `Downloading ${count} of ${torrent.files.length} file${torrent.files.length === 1 ? '' : 's'} in qBittorrent.`);
  return withEvents(id);
}

export type FallbackFile = ManualDownloadFile;
type DownloadWithFiles = ManualDownload & { files: ManualDownloadFile[] };
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

// Arr's own list of video extensions (MediaFileExtensions): a chosen file with one is a video Arr should offer.
const VIDEO_EXTENSIONS = new Set([
  'webm', 'm4v', '3gp', 'nsv', 'ty', 'strm', 'rm', 'rmvb', 'm3u', 'ifo', 'mov', 'qt', 'divx', 'xvid', 'bivx', 'nrg', 'pva', 'wmv',
  'asf', 'asx', 'ogm', 'ogv', 'm2v', 'avi', 'bin', 'dat', 'dvr-ms', 'mpg', 'mpeg', 'mp4', 'avc', 'vp3', 'svq3', 'nuv', 'viv', 'dv',
  'fli', 'flv', 'wpl', 'img', 'iso', 'vob', 'mkv', 'mk3d', 'ts', 'wtv', 'm2ts',
]);
const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/**
 * A sample Helprr may leave out on its own: Arr's only objection is that it is
 * one, and the file is named one (the word "sample" in its name, or a Sample
 * folder) in a title not itself named so. Arr also calls a whole-season file
 * "Sample" by its runtime, so anything else goes to the user.
 */
function isSample(candidate: Candidate, path: string, title: string): boolean {
  if (candidate.rejections.length === 0 || !candidate.rejections.every((rejection) => /sample/i.test(rejection.reason))) return false;
  if (/\bsample\b/i.test(title)) return false;
  const parts = path.split(/[\\/]/);
  const name = parts.pop()!.replace(/\.[^.]+$/, '');
  return parts.some((folder) => /^samples?$/i.test(folder)) || name.split(/[^a-z0-9]+/i).some((word) => word.toLowerCase() === 'sample');
}

export interface ScanOutcome {
  /** Files that could not be found where Arr should see them. */
  missing: string[];
  /** Every chosen video file Arr maps to the target without objection (samples aside). */
  unambiguous: boolean;
  reasons: string[];
}

/** Where the chosen files are now: qBittorrent's folder, and the mapping Arr sees it through. */
interface Located {
  savePath: string;
  mapping: ArrPathCandidate['mapping'];
}

/**
 * Find each chosen file where Arr sees it, ask Arr's manual import what each
 * one is, and keep only the chosen files' answers.
 */
export async function scanFallback(download: DownloadWithFiles, client: RadarrClient | SonarrClient, located: Located): Promise<ScanOutcome> {
  const chosen = download.files.filter((file) => file.selected);
  const paths = chosen.map((file) => ({ file, arrPath: applyMapping(joinPath(located.savePath, file.path), located.mapping) }));

  const missing: string[] = [];
  const listings: FolderListings = new Map();
  for (const { file, arrPath } of paths) {
    if (!(await arrSees(client, arrPath, Number(file.size), listings))) missing.push(file.path);
  }
  if (missing.length > 0) return { missing, unambiguous: false, reasons: [] };

  // One scan of the torrent's own folder when every file sits in it; otherwise each file on its own.
  const roots = new Set(chosen.map((file) => file.path.split(/[\\/]/)[0]));
  const multiFile = download.files.length > 1 && roots.size === 1 && chosen.every((file) => /[\\/]/.test(file.path));
  const scans = multiFile
    ? [applyMapping(joinPath(located.savePath, [...roots][0]), located.mapping)]
    : paths.map((entry) => entry.arrPath);
  const items: ManualImportItem[] = [];
  for (const folder of scans) {
    items.push(...await client.scanImportPath(folder));
  }

  const app = appOf(download.service);
  const reasons: string[] = [];
  const taken = new Set<number>();
  let clean = 0;
  for (const { file, arrPath } of paths) {
    // Exactly this file: on Linux a.mkv and A.mkv are two files.
    const matches = items.filter((item) => samePath(item.path, arrPath));
    const candidate = matches.length === 1 ? keep(matches[0]) : null;
    await prisma.manualDownloadFile.update({
      where: { id: file.id },
      data: { arrPath, candidate: candidate ? (candidate as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    const name = splitPath(file.path).name;
    if (matches.length > 1) {
      reasons.push(`${name}: ${app} lists it more than once`);
      continue;
    }
    if (!candidate) {
      // Subtitles and extras go along with their video; a video Arr leaves out goes to the user.
      if (VIDEO_EXTENSIONS.has(extensionOf(name))) reasons.push(`${name}: ${app} did not offer it for import`);
      continue;
    }
    if (isSample(candidate, file.path, download.arrItemTitle)) continue;
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

type Checked = { ok: true; located: Located } | { ok: false; status: 'DOWNLOADING' | 'BLOCKED'; message: string };

/**
 * The chosen files as qBittorrent has them now: each still at its index with
 * the name and size chosen, set to download and complete, in a torrent that is
 * not moving or checking; and where Arr sees qBittorrent's folder now.
 */
async function checkDownloaded(download: DownloadWithFiles, client: RadarrClient | SonarrClient): Promise<Checked> {
  const qbit = await getQBittorrentClient();
  const [torrent] = await qbit.getTorrents(undefined, undefined, undefined, undefined, download.infoHash.toLowerCase());
  if (!torrent) return { ok: false, status: 'BLOCKED', message: 'The torrent is no longer in qBittorrent.' };
  const files = await qbit.getTorrentFiles(torrent.hash);
  let finished = !SETTLING_STATES.has(torrent.state);
  for (const file of download.files.filter((entry) => entry.selected)) {
    const now = files.find((entry) => entry.index === file.fileIndex);
    const name = splitPath(file.path).name;
    if (!now || now.name !== file.path || now.size !== Number(file.size)) {
      return { ok: false, status: 'BLOCKED', message: `${name} is no longer in the torrent as it was chosen (renamed or changed in qBittorrent). Cancel this download, then add the torrent again.` };
    }
    if (now.priority === 0) return { ok: false, status: 'BLOCKED', message: `${name} was set not to download in qBittorrent. Set it to download again, then scan again.` };
    if (now.progress < 1) finished = false;
  }
  if (!finished) return { ok: false, status: 'DOWNLOADING', message: 'The chosen files have not finished downloading in qBittorrent.' };
  const where = await locateSaveFolder(client, torrent.save_path);
  if (!where.path) return { ok: false, status: 'BLOCKED', message: notVisible(appOf(download.service), torrent.save_path, where.ambiguous) };
  return { ok: true, located: { savePath: torrent.save_path, mapping: where.mapping } };
}

const ERROR_STATUSES: readonly string[] = ['FAILED', 'BLOCKED', 'NEEDS_MAPPING'];

/** A new status from the exact state read (nothing written since); the same reason again is not logged again. */
async function moveFrom(download: ManualDownload, status: ManualDownloadStatus, message: string): Promise<void> {
  const lastError = ERROR_STATUSES.includes(status) ? message : null;
  if (download.status === status && download.lastError === lastError) return;
  try {
    await prisma.manualDownload.update({
      where: { id: download.id, status: download.status, updatedAt: download.updatedAt },
      data: { status, lastError, events: { create: { status, message } } },
    });
  } catch (error) {
    if (!isLost(error)) throw error;
  }
}

/** Holding a fallback download (IMPORT_PENDING) for a scan, an import or a cancel: its updatedAt as last written under the claim. */
export interface FallbackClaim {
  id: string;
  at: Date;
}

// Strictly later than the last write, so a claim's mark is never reused within one millisecond.
const after = (at: Date) => new Date(Math.max(Date.now(), at.getTime() + 1));

/**
 * Take the download from the exact state it was read in (status and
 * updatedAt): of two scans, imports, cancels or recoveries that read the same
 * state, one wins. Only a recovery carries over the import the expired claim
 * sent (`sentAt`); any other claim starts with none.
 */
export async function claimFallback(download: ManualDownload, message: string, sentAt: Date | null = null): Promise<FallbackClaim | null> {
  try {
    const row = await prisma.manualDownload.update({
      where: { id: download.id, status: download.status, updatedAt: download.updatedAt },
      data: { status: 'IMPORT_PENDING', lastError: null, importSentAt: sentAt, updatedAt: after(download.updatedAt), events: { create: { status: 'IMPORT_PENDING', message } } },
      select: { updatedAt: true },
    });
    return { id: download.id, at: row.updatedAt };
  } catch (error) {
    if (isLost(error)) return null;
    throw error;
  }
}

/** Write while still holding the claim; false when it was lost (taken over once it had expired). */
async function underClaim(claim: FallbackClaim, data: Prisma.ManualDownloadUpdateInput): Promise<boolean> {
  try {
    const row = await prisma.manualDownload.update({
      where: { id: claim.id, status: 'IMPORT_PENDING', updatedAt: claim.at },
      data: { ...data, updatedAt: after(claim.at) },
      select: { updatedAt: true },
    });
    claim.at = row.updatedAt;
    return true;
  } catch (error) {
    if (isLost(error)) return false;
    throw error;
  }
}

/** Let go of the claim into a new status, with its event. False when the claim was lost. */
export async function releaseClaim(
  claim: FallbackClaim,
  status: ManualDownloadStatus,
  message: string,
  data: Prisma.ManualDownloadUpdateInput = {},
): Promise<boolean> {
  const terminal = (TERMINAL_STATUSES as readonly string[]).includes(status);
  return underClaim(claim, {
    status,
    // An import sent under the claim is settled by now (IMPORTING follows its command).
    importSentAt: null,
    lastError: ERROR_STATUSES.includes(status) ? message : null,
    ...(terminal ? { completedAt: new Date() } : {}),
    ...data,
    events: { create: { status, message } },
  });
}

/**
 * The chosen files finished, or the user asked for a new reading: check them
 * in qBittorrent, then import them when Arr is sure of every one, otherwise ask
 * the user (NEEDS_MAPPING) or say what is in the way (BLOCKED). An import
 * interrupted after its files were decided is carried through as decided.
 * False when another scan, import or cancel has the download.
 */
export async function settleDownloaded(download: ManualDownload, client: RadarrClient | SonarrClient): Promise<boolean> {
  const app = appOf(download.service);
  const current = await prisma.manualDownload.findUniqueOrThrow({ where: { id: download.id }, include: { files: true } });
  // An expired claim that had sent an import: Helprr stopped, or Arr did not answer, before it was settled.
  if (download.status === 'IMPORT_PENDING' && current.importSentAt) {
    const claim = await claimFallback(download, `Checking whether ${app} took the import.`, current.importSentAt);
    if (!claim) return false;
    await recoverImport(current, claim, client, current.importSentAt);
    return true;
  }

  const checked = await checkDownloaded(current, client);
  if (!checked.ok) {
    await moveFrom(download, checked.status, checked.message);
    return true;
  }
  const claim = await claimFallback(download, download.status === 'DOWNLOADING' ? `Downloaded. Asking ${app} what the files are.` : `Asking ${app} again what the files are.`);
  if (!claim) return false;
  // A new reading: the mapping as it is now, and no decisions from an earlier one.
  const fresh = { pathMapping: { mapping: checked.located.mapping }, files: { updateMany: { where: {}, data: { decision: 'PENDING' as const, episodeIds: [] } } } };
  if (!(await underClaim(claim, fresh))) return true;
  const outcome = await scanFallback(current, client, checked.located);
  if (outcome.missing.length > 0) {
    const what = outcome.missing.length === 1 ? 'a downloaded file' : `${outcome.missing.length} downloaded files`;
    await releaseClaim(claim, 'BLOCKED', `${app} cannot see ${what} where it should (${outcome.missing[0]}). Check ${app}'s remote path mappings, then scan again.`);
    return true;
  }
  if (!outcome.unambiguous) {
    await releaseClaim(claim, 'NEEDS_MAPPING', `Confirm what the files are. ${outcome.reasons.join('. ')}.`);
    return true;
  }

  const scanned = await prisma.manualDownload.findUniqueOrThrow({ where: { id: download.id }, include: { files: true } });
  const decisions: FileDecision[] = scanned.files.filter((file) => file.selected && file.candidate).map((file) => {
    const candidate = file.candidate as unknown as Candidate;
    return isSample(candidate, file.path, scanned.arrItemTitle)
      ? { fileId: file.id, decision: 'IGNORE' }
      : { fileId: file.id, decision: 'IMPORT', episodeIds: candidate.episodes?.map((episode) => episode.id) };
  });
  await submitAttempt(scanned, claim, client, decisions, systemAuditActor('manual-downloads'));
  return true;
}

export interface FileDecision {
  fileId: string;
  decision: 'IMPORT' | 'IGNORE';
  /** Sonarr: the episodes the file holds. */
  episodeIds?: number[];
}

const IMPORTABLE: readonly string[] = ['NEEDS_MAPPING', 'BLOCKED'];

/** Decisions that name only chosen files Arr offered, with valid episodes, and one file per episode. */
async function checkDecisions(
  download: DownloadWithFiles,
  client: RadarrClient | SonarrClient,
  decisions: FileDecision[],
): Promise<{ byId: Map<string, ManualDownloadFile>; importing: FileDecision[] }> {
  if (!IMPORTABLE.includes(download.status)) {
    throw new FallbackImportError(download.status === 'IMPORT_PENDING' ? 'This download is already being read or imported.' : 'This download cannot be imported now.');
  }
  const app = appOf(download.service);
  const byId = new Map(download.files.map((file) => [file.id, file]));
  const importing = decisions.filter((decision) => decision.decision === 'IMPORT');
  if (new Set(decisions.map((decision) => decision.fileId)).size !== decisions.length) throw new FallbackImportError('A file is listed twice.');
  for (const decision of decisions) {
    const file = byId.get(decision.fileId);
    if (!file || !file.selected || !file.arrPath) throw new FallbackImportError('A file to import is not one of the downloaded files.');
    if (decision.decision === 'IMPORT' && !file.candidate) {
      throw new FallbackImportError(`${app} did not offer ${splitPath(file.path).name} for import, so it cannot be imported. Leave it out, or scan again.`);
    }
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
  download: DownloadWithFiles,
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
    path: file.arrPath!,
    // A file set to its episodes is one (or a multi-episode) release, whatever its folder made Arr think.
    ...(download.service === 'RADARR'
      ? { movieId: download.arrItemId }
      : { seriesId: download.arrItemId, episodeIds: decision.episodeIds, releaseType: (decision.episodeIds?.length ?? 0) > 1 ? 'multiEpisode' : 'singleEpisode' }),
    quality: candidate.quality,
    languages: candidate.languages ?? [],
    releaseGroup: candidate.releaseGroup ?? '',
    indexerFlags: candidate.indexerFlags ?? 0,
    downloadId: '',
  };
}

/**
 * Import the files as the user decided, exactly: each a chosen file Arr
 * offered, still in qBittorrent as chosen and complete, and still where Arr
 * read it. Copies (hardlinks), so the torrent keeps seeding.
 */
export async function importFallback(
  download: DownloadWithFiles,
  client: RadarrClient | SonarrClient,
  decisions: FileDecision[],
  actor: AuditActor,
): Promise<void> {
  const { byId, importing } = await checkDecisions(download, client, decisions);
  // The files may have changed since Arr read them.
  const checked = await checkDownloaded(download, client);
  if (!checked.ok) {
    await moveFrom(download, checked.status, checked.message);
    throw new FallbackImportError(checked.message);
  }
  const listings: FolderListings = new Map();
  for (const decision of importing) {
    const file = byId.get(decision.fileId)!;
    const arrPath = applyMapping(joinPath(checked.located.savePath, file.path), checked.located.mapping);
    if (!samePath(arrPath, file.arrPath!) || !(await arrSees(client, arrPath, Number(file.size), listings))) {
      const message = `${splitPath(file.path).name} is not where ${appOf(download.service)} read it any more. Scan again.`;
      await moveFrom(download, 'BLOCKED', message);
      throw new FallbackImportError(message);
    }
  }
  // The user's import takes the download first, so a double submit imports once.
  const claim = await claimFallback(download, 'Importing the files as decided.');
  if (!claim) throw new FallbackImportError('This download is already being imported.');
  const problem = await submitAttempt(download, claim, client, decisions, actor);
  if (problem) throw new FallbackImportError(problem);
}

/**
 * Arr imports extra files (subtitles, nfo...) it finds next to each imported
 * video when its Import Extra Files setting is on, which would reach past the
 * chosen files. The reason to stop when such a file was not chosen, or null.
 */
async function strayExtra(download: DownloadWithFiles, client: RadarrClient | SonarrClient, importing: ManualDownloadFile[]): Promise<string | null> {
  const config = await client.getMediaManagementConfig();
  if (!config.importExtraFiles) return null;
  const wanted = new Set((config.extraFileExtensions ?? '').split(',').map((entry) => entry.trim().replace(/^\.+/, '').toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return null;
  const chosen = download.files.filter((file) => file.selected && file.arrPath).map((file) => file.arrPath!);
  const app = appOf(download.service);
  // Arr looks in the video's own folder only (no subfolders) for a manual import.
  for (const folder of new Set(importing.map((file) => splitPath(file.arrPath!).folder))) {
    const listing = await client.listFolder(folder);
    const stray = listing.files.find((entry) => wanted.has(extensionOf(entry.name)) && !chosen.some((path) => samePath(path, joinPath(folder, entry.name))));
    if (stray) {
      return `${app} imports extra files it finds next to a video (Settings → Media Management → Import Extra Files), and ${folder} also holds ${stray.name}, which this download did not choose. Turn that setting off in ${app}, or move ${stray.name} elsewhere, then import again.`;
    }
  }
  return null;
}

/** Arr's ManualImport command for these files, queued since `since` (Arr forgets its commands when it restarts). */
async function findImportCommand(client: RadarrClient | SonarrClient, paths: string[], since: Date): Promise<{ id: number } | null> {
  const commands = await client.getCommands();
  return commands
    .filter((command) => command.name === 'ManualImport' && Date.parse(command.queued) >= since.getTime() - 60_000)
    .filter((command) => paths.every((path) => command.body?.files?.some((file) => file.path !== undefined && samePath(file.path, path))))
    .sort((a, b) => Date.parse(b.queued) - Date.parse(a.queued))[0] ?? null;
}

/**
 * Send the import under the claim. The attempt (decisions, targets, baseline)
 * is kept before Arr is asked, so an interruption after Arr took it is
 * recovered from it rather than sent again. The reason it did not go, or null.
 */
async function submitAttempt(
  download: DownloadWithFiles,
  claim: FallbackClaim,
  client: RadarrClient | SonarrClient,
  decisions: FileDecision[],
  actor: AuditActor,
): Promise<string | null> {
  const app = appOf(download.service);
  const fail = async (message: string) => {
    await releaseClaim(claim, 'BLOCKED', message);
    return message;
  };
  const byId = new Map(download.files.map((file) => [file.id, file]));
  const importing = decisions.filter((decision) => decision.decision === 'IMPORT');
  const targetEpisodeIds = download.service === 'SONARR' ? importing.flatMap((decision) => decision.episodeIds!) : [];
  let baseline: number[] | Record<string, number>;
  try {
    const stray = await strayExtra(download, client, importing.map((decision) => byId.get(decision.fileId)!));
    if (stray) return fail(stray);
    baseline = download.service === 'RADARR'
      ? (await (client as RadarrClient).getMovieFiles(download.arrItemId!)).map((file) => file.id)
      : Object.fromEntries((await (client as SonarrClient).getEpisodes(download.arrItemId!))
        .filter((episode) => targetEpisodeIds.includes(episode.id))
        .map((episode) => [String(episode.id), episode.episodeFileId ?? 0]));
  } catch (error) {
    return fail(`${app} did not answer: ${errorText(error)}. Import again.`);
  }

  const sentAt = new Date();
  try {
    claim.at = await prisma.$transaction(async (tx) => {
      const row = await tx.manualDownload.update({
        where: { id: claim.id, status: 'IMPORT_PENDING', updatedAt: claim.at },
        data: { targetEpisodeIds, baselineFileIds: baseline, arrCommandId: null, importSentAt: sentAt, updatedAt: after(claim.at) },
        select: { updatedAt: true },
      });
      await tx.manualDownloadFile.updateMany({ where: { downloadId: download.id }, data: { decision: 'PENDING', episodeIds: [] } });
      for (const decision of decisions) {
        await tx.manualDownloadFile.update({
          where: { id: decision.fileId },
          data: { decision: decision.decision, episodeIds: decision.decision === 'IMPORT' ? decision.episodeIds ?? [] : [] },
        });
      }
      return row.updatedAt;
    });
  } catch (error) {
    if (isLost(error)) return 'Another scan, import or cancel took this download meanwhile.';
    throw error;
  }

  const files = importing.map((decision) => importItem(download, byId.get(decision.fileId)!, decision));
  // Copy keeps the source, but Arr replaces (deletes or recycles) a file the import upgrades.
  const replaced = Array.isArray(baseline) ? baseline : Object.values(baseline).filter((fileId) => fileId > 0);
  let command: { id: number };
  try {
    command = await runWithOperationAudit({
      user: actor, service: download.service as ManualDownloadService, instanceId: download.instanceId, operation: 'IMPORT',
      targetType: download.service === 'RADARR' ? 'movie' : 'series', targetId: download.arrItemId, targetTitle: download.arrItemTitle,
      itemCount: files.length, filesDeleted: replaced.length > 0 ? null : false,
      details: { manualDownloadId: download.id, files: files.map((file) => file.path), importMode: 'copy', ...(replaced.length > 0 ? { replacesFileIds: replaced } : {}) },
    }, () => client.submitManualImport(files, 'copy'));
  } catch (error) {
    // The answer may be lost after Arr took it: look before saying it did not.
    const taken = await findImportCommand(client, files.map((file) => file.path), sentAt).catch(() => null);
    if (taken) command = taken;
    else if (axios.isAxiosError(error) && error.response) return fail(`${app} did not take the import: ${errorText(error)}. Import again.`);
    else {
      // No answer, and no command to be seen (yet): never sent again on a guess. The
      // attempt stays kept, and the status worker settles it once the claim expires.
      await underClaim(claim, { events: { create: { status: 'IMPORT_PENDING', message: `${app} did not answer the import (${errorText(error)}). Helprr checks in a few minutes whether it took it.` } } });
      return null;
    }
  }
  await releaseClaim(claim, 'IMPORTING', `Importing ${files.length} file${files.length === 1 ? '' : 's'} into ${download.arrItemTitle}.`, { arrCommandId: command.id });
  return null;
}

/**
 * An import sent but not settled (Helprr interrupted, or Arr's answer lost):
 * done when Arr's history has it, under way when Arr lists its command since
 * it was sent, otherwise left to the user to check and import again. Never
 * sent a second time on Helprr's own.
 */
async function recoverImport(download: DownloadWithFiles, claim: FallbackClaim, client: RadarrClient | SonarrClient, sentAt: Date): Promise<void> {
  const app = appOf(download.service);
  const proof = await fallbackImportProof(download, client);
  if (proof.proved) {
    await releaseClaim(claim, 'IMPORTED', `${app} imported it.`, { importedFileIds: proof.fileIds });
    return;
  }
  const paths = download.files.filter((file) => file.decision === 'IMPORT' && file.arrPath).map((file) => file.arrPath!);
  const command = await findImportCommand(client, paths, sentAt);
  if (command) {
    await releaseClaim(claim, 'IMPORTING', `Importing into ${download.arrItemTitle}, as ${app} took it.`, { arrCommandId: command.id });
    return;
  }
  await releaseClaim(claim, 'BLOCKED', `Helprr could not confirm the import it sent, and ${app} shows no sign of it. Check ${download.arrItemTitle} in ${app}, then import again.`);
}

/**
 * Whether Arr imported this attempt: an import in the title's history from
 * each decided file's own path, into a file that was not there before (Sonarr:
 * for every target episode). New file ids alone could be another download's.
 */
export async function fallbackImportProof(
  download: ManualDownload,
  client: RadarrClient | SonarrClient,
): Promise<{ proved: boolean; fileIds: number[]; missing: number }> {
  const files = await prisma.manualDownloadFile.findMany({ where: { downloadId: download.id, decision: 'IMPORT' } });
  const history = download.service === 'RADARR'
    ? await (client as RadarrClient).getMovieHistory(download.arrItemId!, 3)
    : await (client as SonarrClient).getSeriesHistory(download.arrItemId!, 3);
  const imports = history.filter((event) => event.eventType === 'downloadFolderImported');
  const fileIdOf = (event: HistoryItem) => Number(event.data?.fileId);
  const from = (file: ManualDownloadFile | undefined, event: HistoryItem) =>
    !!file?.arrPath && typeof event.data?.droppedPath === 'string' && samePath(event.data.droppedPath, file.arrPath) && fileIdOf(event) > 0;

  if (download.service === 'RADARR') {
    const before = new Set(Array.isArray(download.baselineFileIds) ? (download.baselineFileIds as number[]) : []);
    const event = files.length === 1
      ? imports.find((entry) => from(files[0], entry) && entry.movieId === download.arrItemId && !before.has(fileIdOf(entry)))
      : undefined;
    return event ? { proved: true, fileIds: [fileIdOf(event)], missing: 0 } : { proved: false, fileIds: [], missing: 1 };
  }
  const before = (download.baselineFileIds ?? {}) as Record<string, number>;
  const fileIds: number[] = [];
  let missing = 0;
  for (const episodeId of download.targetEpisodeIds) {
    const file = files.find((entry) => entry.episodeIds.includes(episodeId));
    const event = imports.find((entry) => from(file, entry) && entry.episodeId === episodeId && fileIdOf(entry) !== Number(before[String(episodeId)] ?? 0));
    if (event) fileIds.push(fileIdOf(event));
    else missing += 1;
  }
  return { proved: download.targetEpisodeIds.length > 0 && missing === 0, fileIds: [...new Set(fileIds)], missing };
}

export class FallbackImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FallbackImportError';
  }
}
