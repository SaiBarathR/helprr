import { Prisma, type ManualDownload, type ManualDownloadStatus } from '@prisma/client';
import axios from 'axios';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { runWithOperationAudit, type AuditActor } from '@/lib/file-audit';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { ArrReleasePushInput, HistoryItem } from '@/types';
import { arrClientFor, preflightManualDownload, resolveArrCallbackOrigin, TERMINAL_STATUSES, type PreflightInput, type PreflightResult } from './preflight';
import { offerTorrentToArr, withdrawTorrentLink } from './torrent-link';

/**
 * Sending a manual download to Sonarr/Radarr (the default, Arr-managed mode):
 *
 *   preflight → record → add the title with searches off (or use the existing
 *   one, monitoring it when allowed) → make sure Arr maps the release to it →
 *   push the release → prove the grab from Arr's history → QUEUED.
 *
 * Every Arr change is audited. When a step fails after this workflow added the
 * title, the title is removed again, but only while it has no files and only
 * when Arr cannot have grabbed the release. Arr owns everything after the grab;
 * the status worker follows it from there.
 */

export type ManualDownloadWithEvents = ManualDownload & { events: Array<{ at: Date; status: ManualDownloadStatus; message: string | null }> };

/** The preflight refused the download; nothing was created. */
export class ManualDownloadRefusedError extends Error {
  constructor(readonly result: PreflightResult) {
    super(result.errors.map((issue) => issue.message).join(' '));
    this.name = 'ManualDownloadRefusedError';
  }
}

const EPISODE_WAIT_MS = 30_000;
const GRAB_CHECK_ATTEMPTS = 6;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withEvents(id: string): Promise<ManualDownloadWithEvents> {
  return prisma.manualDownload.findUniqueOrThrow({
    where: { id },
    include: { events: { orderBy: { at: 'asc' }, select: { at: true, status: true, message: true } } },
  });
}

async function moveTo(
  id: string,
  status: ManualDownloadStatus,
  message: string | null,
  data: Prisma.ManualDownloadUpdateInput = {},
): Promise<void> {
  const terminal = (TERMINAL_STATUSES as readonly string[]).includes(status);
  await prisma.manualDownload.update({
    where: { id },
    data: {
      ...data,
      status,
      ...(status === 'FAILED' || status === 'BLOCKED' ? { lastError: message } : {}),
      ...(terminal ? { completedAt: new Date() } : {}),
      events: { create: { status, message } },
    },
  });
}

/**
 * Start a manual download. Returns the workflow, already QUEUED when Arr
 * grabbed the release, or FAILED / BLOCKED with the reason. A repeated request
 * (same user and clientRequestId, e.g. after a lost response) returns the
 * workflow it started instead of starting another.
 */
export async function sendManualDownload(
  input: PreflightInput,
  clientRequestId: string,
  actor: AuditActor & { id: string },
): Promise<ManualDownloadWithEvents> {
  const repeat = await prisma.manualDownload.findUnique({
    where: { createdByUserId_clientRequestId: { createdByUserId: actor.id, clientRequestId } },
    select: { id: true },
  });
  if (repeat) return withEvents(repeat.id);

  const preflight = await preflightManualDownload(input);
  if (!preflight.ok || !preflight.plan.target || !preflight.plan.instance) throw new ManualDownloadRefusedError(preflight);
  const { plan } = preflight;
  const target = plan.target!;
  const instance = plan.instance!;

  // One active workflow per instance and release: checked and created under a lock.
  let id: string;
  try {
    const recorded = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`manual-download:${instance.id}:${input.source.infoHash}`}))`;
      const active = await tx.manualDownload.findFirst({
        where: { instanceId: instance.id, infoHash: input.source.infoHash, status: { notIn: [...TERMINAL_STATUSES] } },
        select: { id: true, createdByUserId: true, clientRequestId: true },
      });
      // The same submission sent twice at once: the second waited for the lock.
      if (active && active.createdByUserId === actor.id && active.clientRequestId === clientRequestId) return { id: active.id, repeat: true };
      if (active) {
        throw new ManualDownloadRefusedError({
          ...preflight,
          ok: false,
          errors: [{ code: 'ALREADY_ACTIVE', message: `This release is already being sent to ${instance.label}.` }],
        });
      }
      const created = await tx.manualDownload.create({
        data: {
          mode: 'ARR_MANAGED',
          status: 'PREFLIGHT',
          service: input.service,
          instanceId: instance.id,
          instanceLabel: instance.label,
          externalId: target.externalId,
          arrItemId: target.existingId,
          arrItemTitle: target.title,
          targetEpisodeIds: plan.episodes.map((episode) => episode.id),
          releaseTitle: plan.release.title,
          source: input.source.kind,
          infoHash: input.source.infoHash,
          torrentName: input.source.name,
          downloadClientId: plan.downloadClient?.id ?? null,
          downloadClientName: plan.downloadClient?.name ?? null,
          baselineFileIds: [],
          clientRequestId,
          createdByUserId: actor.id,
          createdByUsername: actor.username,
          events: { create: { status: 'PREFLIGHT', message: 'Checked: ready to send.' } },
        },
        select: { id: true },
      });
      return { id: created.id, repeat: false };
    });
    if (recorded.repeat) return withEvents(recorded.id);
    id = recorded.id;
  } catch (error) {
    // The same submission raced itself: hand back the one that won.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.manualDownload.findUnique({
        where: { createdByUserId_clientRequestId: { createdByUserId: actor.id, clientRequestId } },
        select: { id: true },
      });
      if (winner) return withEvents(winner.id);
    }
    throw error;
  }

  const connection = await resolveConnection(input.service, instance.id);
  const client = arrClientFor(input.service, connection);
  const run = new SendRun(id, input, plan, client, actor, instance.id);
  await run.execute();
  return withEvents(id);
}

class SendRun {
  private arrItemId: number | null;
  private createdArrItem = false;
  /** The release went to Arr: from here a failure may follow a grab, so the title stays. */
  private sent = false;
  private episodeIds: number[];

  constructor(
    private readonly id: string,
    private readonly input: PreflightInput,
    private readonly plan: PreflightResult['plan'],
    private readonly client: RadarrClient | SonarrClient,
    private readonly actor: AuditActor,
    private readonly instanceId: string,
  ) {
    this.arrItemId = plan.target!.existingId;
    this.episodeIds = plan.episodes.map((episode) => episode.id);
  }

  private get app() {
    return this.input.service === 'RADARR' ? 'Radarr' : 'Sonarr';
  }

  private get radarr() {
    return this.client as RadarrClient;
  }

  private get sonarr() {
    return this.client as SonarrClient;
  }

  private audit<T>(operation: 'CREATE_MEDIA' | 'PUSH_RELEASE' | 'DELETE_MEDIA', details: Record<string, unknown>, call: () => Promise<T>) {
    return runWithOperationAudit({
      user: this.actor,
      service: this.input.service,
      instanceId: this.instanceId,
      operation,
      targetType: this.input.service === 'RADARR' ? 'movie' : 'series',
      targetId: this.arrItemId,
      targetTitle: this.plan.target!.title,
      itemCount: 1,
      filesDeleted: operation === 'DELETE_MEDIA' ? false : null,
      details: { manualDownloadId: this.id, ...details },
    }, call);
  }

  async execute(): Promise<void> {
    try {
      await moveTo(this.id, 'CREATING_MEDIA', this.arrItemId ? `Using ${this.plan.target!.title}, already in ${this.plan.instance!.label}.` : `Adding ${this.plan.target!.title} to ${this.plan.instance!.label} with searches off.`);
      if (this.arrItemId) await this.monitorExisting();
      else await this.addTitle();
      if (this.input.service === 'SONARR' && this.createdArrItem) {
        const mapped = await this.episodesForNewSeries();
        if (!mapped) return;
      }
      const baseline = await this.fileIds();
      await moveTo(this.id, 'SUBMITTING_RELEASE', `Sending the release to ${this.plan.instance!.label}.`, {
        arrItemId: this.arrItemId,
        createdArrItem: this.createdArrItem,
        targetEpisodeIds: this.episodeIds,
        baselineFileIds: baseline,
      });
      await this.push();
    } catch (error) {
      if (this.sent) {
        // Not FAILED: the status worker keeps checking Arr's queue for it.
        await moveTo(this.id, 'BLOCKED', `Sent to ${this.plan.instance!.label}, but Helprr could not confirm that ${this.app} grabbed it: ${errorText(error)}. ${this.plan.target!.title} stays in ${this.plan.instance!.label}; Helprr keeps checking its queue, and you can cancel this download here.`);
        return;
      }
      await this.failAndUndo(`${this.app} did not answer as expected: ${errorText(error)}`);
    }
  }

  /** An existing title the user allowed us to monitor, so Arr accepts the release. */
  private async monitorExisting(): Promise<void> {
    if (!this.input.monitorTarget || !this.arrItemId) return;
    if (this.input.service === 'RADARR') {
      const movie = await this.radarr.getMovieById(this.arrItemId);
      if (!movie.monitored) await this.radarr.updateMovie({ ...movie, monitored: true });
      return;
    }
    const series = await this.sonarr.getSeriesById(this.arrItemId);
    if (!series.monitored) await this.sonarr.updateSeries({ ...series, monitored: true });
    const unmonitored = this.plan.episodes.filter((episode) => !episode.monitored).map((episode) => episode.id);
    if (unmonitored.length > 0) await this.sonarr.setEpisodesMonitored(unmonitored, true);
  }

  /** Add the title with every automatic search off, from an allowlist of fields. */
  private async addTitle(): Promise<void> {
    const add = this.input.add!;
    const target = this.plan.target!;
    if (this.input.service === 'RADARR') {
      const movie = await this.audit('CREATE_MEDIA', { tmdbId: target.externalId }, () => this.radarr.addMovie({
        title: target.title,
        tmdbId: target.externalId,
        year: target.year,
        qualityProfileId: add.qualityProfileId,
        rootFolderPath: add.rootFolderPath,
        tags: add.tags,
        monitored: true,
        minimumAvailability: add.minimumAvailability ?? 'released',
        addOptions: { searchForMovie: false, monitor: 'movieOnly' },
      } as never));
      this.arrItemId = movie.id;
    } else {
      // Added unmonitored with no searches; the series and the release's
      // episodes are monitored once Sonarr has its episodes.
      const series = await this.audit('CREATE_MEDIA', { tvdbId: target.externalId }, () => this.sonarr.addSeries({
        title: target.title,
        tvdbId: target.externalId,
        qualityProfileId: add.qualityProfileId,
        rootFolderPath: add.rootFolderPath,
        tags: add.tags,
        seriesType: add.seriesType ?? 'standard',
        seasonFolder: add.seasonFolder !== false,
        monitored: false,
        addOptions: { monitor: 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
      } as never));
      this.arrItemId = series.id;
    }
    this.createdArrItem = true;
    await prisma.manualDownload.update({ where: { id: this.id }, data: { arrItemId: this.arrItemId, createdArrItem: true } });
    void invalidateTaggedLibrary(this.input.service === 'RADARR' ? 'radarr' : 'sonarr', this.instanceId).catch(() => {});
  }

  /**
   * A new series: wait for Sonarr to load its episodes, then ask Sonarr which
   * of them the release covers. False (and the workflow failed) when Sonarr
   * does not map the release to this series.
   */
  private async episodesForNewSeries(): Promise<boolean> {
    const seriesId = this.arrItemId!;
    const deadline = Date.now() + EPISODE_WAIT_MS;
    let mapped: Awaited<ReturnType<SonarrClient['parseTitle']>> | null = null;
    while (Date.now() < deadline) {
      const parse = await this.sonarr.parseTitle(this.plan.release.title);
      if (parse.series && parse.series.id !== seriesId) break;
      if (parse.series?.id === seriesId && (parse.episodes?.length ?? 0) > 0) {
        mapped = parse;
        break;
      }
      await sleep(1_000);
    }
    if (!mapped) {
      await this.failAndUndo(`Sonarr did not match the release name to the episodes of ${this.plan.target!.title}. Change the release name so it names this series and its episodes.`);
      return false;
    }
    this.episodeIds = mapped.episodes!.map((episode) => episode.id);
    const series = await this.sonarr.getSeriesById(seriesId);
    if (!series.monitored) await this.sonarr.updateSeries({ ...series, monitored: true });
    await this.sonarr.setEpisodesMonitored(this.episodeIds, true);
    return true;
  }

  /** The target's file ids now, so an import can be proved by new ones later. */
  private async fileIds(): Promise<Prisma.InputJsonValue> {
    if (this.input.service === 'RADARR') {
      const files = await this.radarr.getMovieFiles(this.arrItemId!);
      return files.map((file) => file.id);
    }
    const episodes = await this.sonarr.getEpisodes(this.arrItemId!);
    return Object.fromEntries(
      episodes.filter((episode) => this.episodeIds.includes(episode.id)).map((episode) => [String(episode.id), episode.episodeFileId ?? 0]),
    );
  }

  private async push(): Promise<void> {
    const source = this.input.source;
    const release: ArrReleasePushInput = {
      title: this.plan.release.title,
      protocol: 'torrent',
      publishDate: new Date().toISOString(),
      downloadClientId: this.plan.downloadClient?.id,
      ...(this.input.service === 'RADARR' ? { tmdbId: this.plan.target!.externalId } : { tvdbId: this.plan.target!.externalId }),
    };
    let link: string | null = null;
    if (source.kind === 'MAGNET') release.magnetUrl = source.magnetUrl;
    else {
      link = await offerTorrentToArr(source.bytes, resolveArrCallbackOrigin()!);
      release.downloadUrl = link;
    }

    await prisma.manualDownload.update({ where: { id: this.id }, data: { attempts: { increment: 1 } } });
    let result;
    let pushError: unknown = null;
    this.sent = true;
    try {
      // The audit keeps the hash and name, never the magnet or link.
      result = await this.audit('PUSH_RELEASE', { infoHash: source.infoHash, releaseTitle: release.title, source: source.kind, downloadClientId: release.downloadClientId ?? null }, () => this.client.pushRelease(release));
    } catch (error) {
      // The answer may be lost after Arr grabbed it: history decides below.
      pushError = error;
    } finally {
      if (link) void withdrawTorrentLink(link).catch(() => {});
    }

    if (!pushError && (!result || result.rejected || !result.approved)) {
      const reasons = result?.rejections?.length ? result.rejections.join('; ') : 'no reason given';
      await this.failAndUndo(`${this.app} turned the release down: ${reasons}.`);
      return;
    }

    const grabs = await this.grabRecords();
    if (grabs.length === 0 && pushError) {
      // Arr answered with an error and wrote no grab: it did not take the release.
      if (axios.isAxiosError(pushError) && pushError.response) {
        await this.failAndUndo(`${this.app} did not answer as expected: ${errorText(pushError)}`);
        return;
      }
      throw pushError;
    }
    if (grabs.length === 0) {
      await this.failAndUndo(`${this.app} accepted the release but did not grab it. The download client may already have this torrent${source.kind === 'TORRENT_FILE' ? `, or ${this.app} could not fetch the .torrent from Helprr` : ''}.`);
      return;
    }

    // Sonarr matched an existing series by its TVDB id rather than the name, so
    // the episodes were unknown until now: take them from its grab, as the
    // baseline for proving the import.
    if (this.input.service === 'SONARR' && this.episodeIds.length === 0 && grabs.every((grab) => grab.seriesId === this.arrItemId)) {
      this.episodeIds = grabs.flatMap((grab) => (grab.episodeId !== undefined ? [grab.episodeId] : []));
      await prisma.manualDownload.update({ where: { id: this.id }, data: { targetEpisodeIds: this.episodeIds, baselineFileIds: await this.fileIds() } });
    }

    const wrongTitle = this.input.service === 'RADARR'
      ? grabs.some((grab) => grab.movieId !== this.arrItemId)
      : grabs.some((grab) => grab.seriesId !== this.arrItemId || (grab.episodeId !== undefined && !this.episodeIds.includes(grab.episodeId)));
    const clientName = grabs[0].data?.downloadClientName || grabs[0].data?.downloadClient || this.plan.downloadClient?.name || null;
    if (wrongTitle) {
      await moveTo(this.id, 'BLOCKED', `${this.app} grabbed the release for a different title than ${this.plan.target!.title}. Cancel it from its queue.`, { downloadClientName: clientName });
      return;
    }
    await moveTo(this.id, 'QUEUED', `${this.app} grabbed the release${clientName ? ` and sent it to ${clientName}` : ''}.`, { downloadClientName: clientName });
  }

  /** History "grabbed" records for this release; Arr writes them before the push returns. */
  private async grabRecords(): Promise<HistoryItem[]> {
    for (let attempt = 0; attempt < GRAB_CHECK_ATTEMPTS; attempt += 1) {
      const history = await this.client.getHistory(1, 50, 'date', 'descending', { downloadId: this.input.source.infoHash });
      const grabs = history.records.filter((record) => record.eventType === 'grabbed');
      if (grabs.length > 0) return grabs;
      await sleep(500);
    }
    return [];
  }

  /**
   * Mark the workflow failed and, when it added the title itself, remove the
   * title again while it still has no files. A title that was already there,
   * or that has files, is left alone.
   */
  private async failAndUndo(message: string): Promise<void> {
    let note = message;
    if (this.createdArrItem && this.arrItemId) {
      try {
        const hasFiles = this.input.service === 'RADARR'
          ? (await this.radarr.getMovieFiles(this.arrItemId)).length > 0
          : (await this.sonarr.getEpisodeFiles(this.arrItemId)).length > 0;
        if (hasFiles) {
          note += ` ${this.plan.target!.title} was added and already has files, so it was left in ${this.plan.instance!.label}.`;
        } else {
          await this.audit('DELETE_MEDIA', { reason: 'manual download failed before its grab' }, () => (
            this.input.service === 'RADARR' ? this.radarr.deleteMovie(this.arrItemId!, false, false) : this.sonarr.deleteSeries(this.arrItemId!, false)
          ));
          note += ` ${this.plan.target!.title}, which this download had added, was removed again.`;
          void invalidateTaggedLibrary(this.input.service === 'RADARR' ? 'radarr' : 'sonarr', this.instanceId).catch(() => {});
        }
      } catch (error) {
        note += ` ${this.plan.target!.title} could not be removed again (${errorText(error)}); remove it in ${this.app} if you do not want it.`;
      }
    }
    await moveTo(this.id, 'FAILED', note);
  }
}
