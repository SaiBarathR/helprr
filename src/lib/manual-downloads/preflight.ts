import type { ServiceConnection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';
import { parseBareOrigin } from '@/lib/request-utils';
import type { DownloadClient, QualityProfile, RootFolder, Tag } from '@/types';
import type { ReleaseSource } from './release-source';

/**
 * The server-owned check run before a manual download creates or sends
 * anything: the instance, the title, the add options, the download client,
 * and how Arr itself reads the release title (GET /api/v3/parse). Helprr does
 * no title parsing of its own; when Arr would not map the release to the
 * chosen title, the answer says why so the user can change the release name.
 */

export type ManualDownloadService = 'RADARR' | 'SONARR';

export const TERMINAL_STATUSES = ['IMPORTED', 'FAILED', 'CANCELLED'] as const;
/** Arr refuses a release it grabbed within this long (its own "recently grabbed" rule). */
const RECENT_GRAB_MS = 12 * 60 * 60_000;

export interface AddOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  tags: number[];
  /** Radarr only. */
  minimumAvailability?: 'announced' | 'inCinemas' | 'released';
  /** Sonarr only. */
  seriesType?: 'standard' | 'daily' | 'anime';
  /** Sonarr only. */
  seasonFolder?: boolean;
}

export interface PreflightInput {
  service: ManualDownloadService;
  instanceId: string;
  /** tmdbId (Radarr) or tvdbId (Sonarr). */
  externalId: number;
  source: ReleaseSource;
  /** The title Arr will parse to map the release; defaults to the release's own name. */
  releaseTitle: string;
  downloadClientId?: number;
  /** Required when the title is not in the instance yet. */
  add?: AddOptions;
  /** Allow monitoring an existing title (and the episodes the release covers) that is not monitored. */
  monitorTarget?: boolean;
}

export interface PreflightIssue {
  code: string;
  message: string;
}

export interface PreflightPlan {
  service: ManualDownloadService;
  instance: { id: string; label: string } | null;
  target: { externalId: number; title: string; year: number; existingId: number | null } | null;
  release: { title: string; name: string; infoHash: string; source: ReleaseSource['kind'] };
  /** What Arr read from the release title. */
  parsed: { quality: string | null; year?: number; seasonNumber?: number; episodeNumbers?: number[]; fullSeason?: boolean } | null;
  /** Sonarr, when the title maps to a library series: the episodes the release covers. */
  episodes: Array<{ id: number; seasonNumber: number; episodeNumber: number; monitored: boolean; hasFile: boolean }>;
  downloadClient: { id: number; name: string } | null;
  /** Every enabled torrent client, offered when one has to be chosen. */
  downloadClientChoices: Array<{ id: number; name: string; priority: number }>;
}

export interface PreflightResult {
  ok: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  plan: PreflightPlan;
}

/** Where Arr can fetch a .torrent from: ARR_CALLBACK_ORIGIN (may be plain http on a LAN), else APP_ORIGIN. */
export function resolveArrCallbackOrigin(): string | null {
  const callback = process.env.ARR_CALLBACK_ORIGIN?.trim();
  if (callback) return parseBareOrigin(callback, false);
  const app = process.env.APP_ORIGIN?.trim();
  return app ? parseBareOrigin(app, false) : null;
}

type LibraryFields = { id?: number | null; monitored?: boolean; tags?: number[]; hasFile?: boolean; secondaryYear?: number | null };

export function arrClientFor(service: ManualDownloadService, connection: ServiceConnection): RadarrClient | SonarrClient {
  const headers = getConnectionHeaders(connection);
  return service === 'RADARR'
    ? new RadarrClient(connection.url, connection.apiKey, headers)
    : new SonarrClient(connection.url, connection.apiKey, headers);
}

/**
 * The client Arr would pick on its own: enabled torrent clients, those tagged
 * for this title if any (else the untagged ones), then the lowest priority
 * number. Null when that leaves more than one, which Arr would rotate between.
 */
export function defaultDownloadClient(clients: DownloadClient[], itemTags: number[]): DownloadClient | null {
  const tagged = clients.filter((client) => (client.tags ?? []).some((tag) => itemTags.includes(tag)));
  const pool = tagged.length > 0 ? tagged : clients.filter((client) => (client.tags ?? []).length === 0);
  if (pool.length === 0) return null;
  const best = Math.min(...pool.map((client) => client.priority));
  const group = pool.filter((client) => client.priority === best);
  return group.length === 1 ? group[0] : null;
}

function qualityName(quality: { quality: { name: string } } | undefined): string | null {
  return quality?.quality?.name ?? null;
}

function episodeLabel(episode: { seasonNumber: number; episodeNumber: number }): string {
  return `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
}

export async function preflightManualDownload(input: PreflightInput): Promise<PreflightResult> {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];
  const error = (code: string, message: string) => errors.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });
  const app = input.service === 'RADARR' ? 'Radarr' : 'Sonarr';
  const releaseTitle = input.releaseTitle.trim();
  const plan: PreflightPlan = {
    service: input.service,
    instance: null,
    target: null,
    release: { title: releaseTitle, name: input.source.name, infoHash: input.source.infoHash, source: input.source.kind },
    parsed: null,
    episodes: [],
    downloadClient: null,
    downloadClientChoices: [],
  };
  const done = () => ({ ok: errors.length === 0, errors, warnings, plan });

  let connection: ServiceConnection;
  try {
    connection = await resolveConnection(input.service, input.instanceId);
  } catch {
    error('INSTANCE_NOT_FOUND', `That ${app} instance no longer exists.`);
    return done();
  }
  plan.instance = { id: connection.id, label: connection.label };

  if (!releaseTitle) error('RELEASE_TITLE_REQUIRED', `Give the release a name ${app} can read, such as its original release name.`);
  if (releaseTitle.length > 500) error('RELEASE_TITLE_TOO_LONG', 'The release name is too long.');
  if (input.source.kind === 'TORRENT_FILE' && !resolveArrCallbackOrigin()) {
    error('CALLBACK_ORIGIN_MISSING', `${app} fetches a .torrent file from Helprr, so Helprr needs an address it can reach: set ARR_CALLBACK_ORIGIN (or APP_ORIGIN).`);
  }

  const active = await prisma.manualDownload.findFirst({
    where: { instanceId: connection.id, infoHash: input.source.infoHash, status: { notIn: [...TERMINAL_STATUSES] } },
    select: { id: true, arrItemTitle: true },
  });
  if (active) error('ALREADY_ACTIVE', `This release is already being sent to ${connection.label} for ${active.arrItemTitle}.`);

  const client = arrClientFor(input.service, connection);
  const term = input.service === 'RADARR' ? `tmdb:${input.externalId}` : `tvdb:${input.externalId}`;
  let found: (LibraryFields & { title: string; year: number; tmdbId?: number; tvdbId?: number }) | undefined;
  let downloadClients: DownloadClient[];
  let lastGrab: Date | null;
  let parse: Awaited<ReturnType<RadarrClient['parseTitle']>> | Awaited<ReturnType<SonarrClient['parseTitle']>> | null;
  let options: { profiles: QualityProfile[]; folders: RootFolder[]; tags: Tag[] } | null = null;
  try {
    const lookup = input.service === 'RADARR'
      ? (client as RadarrClient).lookupMovie(term)
      : (client as SonarrClient).lookupSeries(term);
    const [results, clients, history, parsed] = await Promise.all([
      lookup,
      client.getDownloadClients(),
      // Grab events only: a later import or failure must not hide an earlier grab.
      client.getHistory(1, 1, 'date', 'descending', { downloadId: input.source.infoHash, eventType: 1 }),
      releaseTitle ? client.parseTitle(releaseTitle) : Promise.resolve(null),
    ]);
    found = (results as Array<LibraryFields & { title: string; year: number; tmdbId?: number; tvdbId?: number }>)
      .find((result) => (input.service === 'RADARR' ? result.tmdbId : result.tvdbId) === input.externalId);
    downloadClients = clients.filter((dc) => dc.enable && dc.protocol === 'torrent');
    const grab = history.records.find((record) => record.eventType === 'grabbed');
    lastGrab = grab ? new Date(grab.date) : null;
    parse = parsed;
    if (found && !(found.id && found.id > 0) && input.add) {
      const [profiles, folders, tags] = await Promise.all([client.getQualityProfiles(), client.getRootFolders(), client.getTags()]);
      options = { profiles, folders, tags };
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
  // Arr itself refuses a release grabbed within the last 12 hours; an older grab
  // (later failed, removed or imported) may be sent again.
  if (lastGrab) {
    const age = Date.now() - lastGrab.getTime();
    if (!(age >= RECENT_GRAB_MS)) error('ALREADY_GRABBED', `${connection.label} grabbed this release less than 12 hours ago, and ${app} refuses it again until then.`);
    else warn('GRABBED_BEFORE', `${connection.label} grabbed this release before, on ${lastGrab.toISOString().slice(0, 10)}.`);
  }

  // A new title: the add options must belong to this instance.
  if (!existingId) {
    if (!input.add) {
      error('ADD_OPTIONS_REQUIRED', `${found.title} is not in ${connection.label} yet: choose a quality profile and root folder.`);
    } else if (options) {
      if (!options.profiles.some((profile) => profile.id === input.add!.qualityProfileId)) error('PROFILE_INVALID', `That quality profile is not in ${connection.label}.`);
      if (!options.folders.some((folder) => folder.path === input.add!.rootFolderPath)) error('ROOT_FOLDER_INVALID', `That root folder is not in ${connection.label}.`);
      if (input.add.tags.some((tag) => !options!.tags.some((known) => known.id === tag))) error('TAG_INVALID', `A chosen tag is not in ${connection.label}.`);
    }
  }

  // How Arr reads the release title.
  if (parse && input.service === 'RADARR') {
    const radarr = parse as Awaited<ReturnType<RadarrClient['parseTitle']>>;
    const info = radarr.parsedMovieInfo;
    plan.parsed = info ? { quality: qualityName(info.quality), year: info.year } : null;
    if (!info) {
      error('RELEASE_TITLE_UNPARSEABLE', 'Radarr cannot read this release name. Use a name with the title and year, such as Title.2020.1080p.WEB.');
    } else {
      if (plan.parsed?.quality === 'Unknown') error('RELEASE_QUALITY_UNKNOWN', 'Radarr cannot tell the quality from this name. Add the quality words (for example 1080p WEB) to the release name.');
      // Radarr maps a pushed release by its TMDB id first, which holds when the
      // years agree or the name has no year (Radarr reads it below 1800);
      // otherwise it falls back to the title.
      const yearMatches = (info.year ?? 0) < 1800 || info.year === found.year || (!!found.secondaryYear && info.year === found.secondaryYear);
      if (!yearMatches && radarr.movie && radarr.movie.id !== existingId) {
        error('RELEASE_OTHER_TITLE', `Radarr reads this release as ${radarr.movie.title} (${radarr.movie.year}), which is already in ${connection.label}. Change the release name.`);
      } else if (!yearMatches && !(radarr.movie && radarr.movie.id === existingId)) {
        error('RELEASE_YEAR_MISMATCH', `Radarr reads the year as ${info.year || 'missing'}, but ${found.title} is from ${found.year}. Put the right year in the release name.`);
      }
    }
    if (existingId && found.monitored === false) {
      if (input.monitorTarget) warn('TARGET_WILL_BE_MONITORED', `${found.title} is not monitored; it will be monitored so Radarr accepts the release.`);
      else error('TARGET_UNMONITORED', `${found.title} is not monitored, and Radarr only accepts releases for monitored movies.`);
    }
    if (existingId && found.hasFile) warn('TARGET_HAS_FILE', `${found.title} already has a file; Radarr only takes the release if it is an upgrade.`);
  } else if (parse) {
    const sonarr = parse as Awaited<ReturnType<SonarrClient['parseTitle']>>;
    const info = sonarr.parsedEpisodeInfo;
    plan.parsed = info
      ? { quality: qualityName(info.quality), seasonNumber: info.seasonNumber, episodeNumbers: info.episodeNumbers, fullSeason: info.fullSeason }
      : null;
    const coversEpisodes = info && (info.fullSeason || (info.episodeNumbers?.length ?? 0) > 0 || (info.absoluteEpisodeNumbers?.length ?? 0) > 0 || info.isDaily);
    if (!info) {
      error('RELEASE_TITLE_UNPARSEABLE', 'Sonarr cannot read this release name. Use a name with the series and episode, such as Show.S01E02.1080p.WEB.');
    } else if (!coversEpisodes) {
      error('RELEASE_NO_EPISODES', 'Sonarr cannot tell which episodes this release holds. Add the season and episode (for example S01E02, or S01 for a season) to the release name.');
    } else if (plan.parsed?.quality === 'Unknown') {
      error('RELEASE_QUALITY_UNKNOWN', 'Sonarr cannot tell the quality from this name. Add the quality words (for example 1080p WEB) to the release name.');
    }
    if (sonarr.series && sonarr.series.id !== existingId) {
      // Sonarr maps by name first: this release would be grabbed for that other series.
      error('RELEASE_OTHER_TITLE', `Sonarr reads this release as ${sonarr.series.title}, which is already in ${connection.label}. Change the release name.`);
    } else if (existingId && sonarr.series) {
      plan.episodes = (sonarr.episodes ?? []).map((episode) => ({
        id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
        monitored: episode.monitored, hasFile: (episode.episodeFileId ?? 0) > 0,
      }));
      if (coversEpisodes && plan.episodes.length === 0) error('RELEASE_EPISODES_UNKNOWN', `Sonarr finds no episodes of ${found.title} for this release name.`);
      const unmonitored = plan.episodes.filter((episode) => !episode.monitored);
      if (!sonarr.series.monitored || unmonitored.length > 0) {
        const what = !sonarr.series.monitored ? found.title : unmonitored.map(episodeLabel).join(', ');
        if (input.monitorTarget) warn('TARGET_WILL_BE_MONITORED', `${what} will be monitored so Sonarr accepts the release.`);
        else error('TARGET_UNMONITORED', `${what} ${unmonitored.length === 1 && sonarr.series.monitored ? 'is' : 'are'} not monitored, and Sonarr only accepts releases for monitored episodes.`);
      }
      const withFiles = plan.episodes.filter((episode) => episode.hasFile);
      if (withFiles.length > 0) warn('TARGET_HAS_FILE', `${withFiles.map(episodeLabel).join(', ')} already ${withFiles.length === 1 ? 'has a file' : 'have files'}; Sonarr only takes the release if it is an upgrade.`);
    } else if (existingId) {
      warn('RELEASE_MAPPED_BY_ID', `Sonarr does not match this release name to ${found.title}; it will match it by its TVDB id, and the episodes are checked when it is sent.`);
      if (found.monitored === false) {
        if (input.monitorTarget) warn('TARGET_WILL_BE_MONITORED', `${found.title} will be monitored so Sonarr accepts the release.`);
        else error('TARGET_UNMONITORED', `${found.title} is not monitored, and Sonarr only accepts releases for monitored series.`);
      }
    } else {
      warn('EPISODES_CHECKED_AFTER_ADD', `The episodes are checked once ${found.title} is added to ${connection.label}.`);
    }
  }

  // The download client: never leave Arr to rotate between several.
  plan.downloadClientChoices = downloadClients.map((dc) => ({ id: dc.id, name: dc.name, priority: dc.priority }));
  if (downloadClients.length === 0) {
    error('NO_DOWNLOAD_CLIENT', `${connection.label} has no enabled torrent download client.`);
  } else if (input.downloadClientId !== undefined) {
    const chosen = downloadClients.find((dc) => dc.id === input.downloadClientId);
    if (chosen) plan.downloadClient = { id: chosen.id, name: chosen.name };
    else error('DOWNLOAD_CLIENT_INVALID', `That download client is not an enabled torrent client in ${connection.label}.`);
  } else {
    const itemTags = existingId ? found.tags ?? [] : input.add?.tags ?? [];
    const chosen = defaultDownloadClient(downloadClients, itemTags);
    if (chosen) plan.downloadClient = { id: chosen.id, name: chosen.name };
    else error('DOWNLOAD_CLIENT_REQUIRED', `${connection.label} has more than one torrent client it could use: choose one.`);
  }

  return done();
}
