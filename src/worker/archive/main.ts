// First: the generated secrets, before any module reads the environment.
import './load-secrets';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, PrismaClient, type ArchiveJob, type ArchiveJobKind, type ArchivePlatform } from '@prisma/client';
import type { DownloadSession, PlatformAdapter } from './adapter';
import { twitchAdapter } from './adapters/twitch';
import { readYoutubeFormats, removeLeftoverCookies, youtubeAdapter, youtubeVideoArgs } from './adapters/youtube';
import { claimJob, LEASE_MS } from './claim';
import { classifyJobError, nextStepAfterFailure } from '@/lib/archive/job-errors';
import { inReencodeWindow, REENCODE_NOW_PRIORITY } from '@/lib/archive/reencode-window';
import type { DownloadOptions } from '@/lib/archive/jobs';
import { libraryFor, WORKER_VERSION } from './env';
import { forgetFilesDeletedElsewhere, repairLibraryModes, runDeleteFiles } from './delete-files';
import { measureParkedOriginals, runDeleteOriginal, runRestoreOriginal } from './original-files';
import { DiskGuardError, runDownload, WaitForRecordingError } from './pipeline';
import { deleteExpiredOriginals, probeGpu, runReencode } from './reencode';
import { assertSeparateRoots, isMountedFolder } from './library-paths';
import { DeferJobError, JobCancelledError, LeaseLostError } from './process';
import { activeVersion, ensureTools, latestVersion, setSmokeVideo, TWITCH_TOOLS, updateTools, YOUTUBE_TOOLS, type ToolName } from './tools';
import { TWITCH } from '@/lib/twitch/platform';
import { withoutSignedLinks } from '@/lib/archive/redact-links';

const RENEW_MS = 20_000;
const POLL_MS = 5_000;
const FORMATS_POLL_MS = 2_000;
const CANCEL_POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const MIGRATION_POLL_MS = 5_000;
const REQUIRED_MIGRATION = '20261101150000_youtube_real_formats';
const CPU_POLL_MS = 30_000;
const DELETED_CHECK_MS = 2 * 60_000;
const TOOL_CHECK_MS = 24 * 3_600_000;
const YOUTUBE_TOOL_RETRY_MS = 30 * 60_000;
const EXTRACTOR_FAILURE_LIMIT = 3;
const DISK_RECHECK_MS = 15 * 60_000;
const HOUSEKEEPING_MS = 60 * 60_000;
// File housekeeping needs no tools, so it carries on while they are held.
const FILE_KINDS: ArchiveJobKind[] = ['DELETE_FILES', 'DELETE_ORIGINAL', 'RESTORE_ORIGINAL'];
const NETWORK_KINDS: ArchiveJobKind[] = ['DOWNLOAD', ...FILE_KINDS];
const ALL_PLATFORMS: ArchivePlatform[] = ['TWITCH', 'YOUTUBE'];
const ADAPTERS: Record<ArchivePlatform, PlatformAdapter> = { TWITCH: twitchAdapter, YOUTUBE: youtubeAdapter };
// Every root the worker looks after. YouTube joins at start, only if its folder is mounted.
const PLATFORMS: ArchivePlatform[] = [TWITCH];

const prisma = new PrismaClient();
const workerId = `${os.hostname()}-${randomUUID().slice(0, 8)}`;
const running = new Map<string, AbortController>();
let stopping = false;
let gpuAvailable = false;
let cpuBusy = false;
let formatsBusy = false;
let downloadsRunning = 0;
let appliedPins = '';
let toolsBusy = false;
let youtubeRepairAt = 0;
let youtubeMounted = false;
let youtubeToolTriedAt = 0;

function log(level: 'info' | 'warn' | 'error', message: string, extra: Record<string, unknown> = {}) {
  // Errors here can quote a tool's output, so every line loses signed links, like the job records.
  console[level](withoutSignedLinks(JSON.stringify({ at: new Date().toISOString(), level, message, ...extra })));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function event(jobId: string, level: string, message: string) {
  await prisma.archiveJobEvent.create({ data: { jobId, level, message: withoutSignedLinks(message).slice(0, 1000) } }).catch(() => undefined);
}

/** The app owns migrations. The worker only waits for them. */
async function waitForMigrations(): Promise<void> {
  for (;;) {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE migration_name = ${REQUIRED_MIGRATION} AND finished_at IS NOT NULL
    `.catch((error) => {
      log('warn', 'Could not read the migration table', { error: String(error).slice(0, 300) });
      return [];
    });
    if (rows.length > 0) return;
    log('info', 'Waiting for the app to apply the Twitch migrations');
    await sleep(MIGRATION_POLL_MS);
  }
}

// Group-writable, because Jellyfin deletes through a group it shares with the worker's
// user. Others can still read, for a Jellyfin that shares no group and only plays.
async function probeLibrary(platform: ArchivePlatform): Promise<void> {
  const { root, staging } = libraryFor(platform);
  process.umask(0o002);
  await mkdir(staging, { recursive: true });
  const probe = path.join(staging, `.probe-${workerId}`);
  await writeFile(probe, '');
  const { mode } = await stat(probe);
  await rm(probe);
  log('info', 'Library is writable', { dir: root, mode: (mode & 0o777).toString(8) });
  const fixed = await repairLibraryModes(root);
  if (fixed > 0) log('info', 'Made older library files group-writable', { fixed });
}

async function finishJob(job: ArchiveJob, data: Prisma.ArchiveJobUpdateInput) {
  // Only while the lease is ours: a takeover must not be overwritten by a slow first worker.
  await prisma.archiveJob.updateMany({
    where: { id: job.id, leaseOwner: workerId },
    data: { leaseOwner: null, leaseUntil: null, ...data } as Prisma.ArchiveJobUpdateManyMutationInput,
  });
}

async function runJob(job: ArchiveJob): Promise<void> {
  const abort = new AbortController();
  running.set(job.id, abort);
  let leaseLost = false;
  let renewedAt = Date.now();
  const loseLease = () => {
    leaseLost = true;
    abort.abort();
  };
  const renew = setInterval(() => {
    void prisma.archiveJob.updateMany({
      where: { id: job.id, leaseOwner: workerId },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    }).then(({ count }) => {
      if (count === 0) loseLease();
      else renewedAt = Date.now();
    }).catch(() => {
      // Out of touch for a whole lease: another worker may already hold this job.
      if (Date.now() - renewedAt > LEASE_MS) loseLease();
    });
  }, RENEW_MS);
  const assertLease = async () => {
    const owned = await prisma.archiveJob.count({ where: { id: job.id, leaseOwner: workerId, state: 'RUNNING' } });
    if (owned === 0) {
      loseLease();
      throw new LeaseLostError();
    }
  };
  // Unique per claim: attempts reset on retry, so they could name a directory still in use.
  const stagingName = `${job.id}-${randomUUID().slice(0, 8)}`;
  const cancelWatch = setInterval(() => {
    void prisma.archiveJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } })
      .then((row) => { if (row?.cancelRequested) abort.abort(); })
      .catch(() => undefined);
  }, CANCEL_POLL_MS);

  let session: DownloadSession | null = null;
  let countedDownload = false;
  try {
    const settings = await prisma.archiveSettings.findUnique({ where: { id: 'singleton' } });
    const setStage = async (stage: string) => {
      await prisma.archiveJob.update({ where: { id: job.id }, data: { stage } });
      await event(job.id, 'info', stage);
    };
    const note = (message: string) => event(job.id, 'warn', message);

    if (FILE_KINDS.includes(job.kind)) {
      if (job.kind === 'DELETE_FILES') await runDeleteFiles(prisma, job, assertLease);
      else if (job.kind === 'DELETE_ORIGINAL') await runDeleteOriginal(prisma, job, assertLease);
      else await runRestoreOriginal(prisma, job, assertLease);
      await finishJob(job, { state: 'DONE', stage: 'done', progress: 1, finishedAt: new Date(), lastError: null, errorClass: null });
      return;
    }
    if (job.kind === 'REENCODE') {
      await runReencode({
        prisma,
        job,
        signal: abort.signal,
        quality: settings?.reencodeGlobalQuality ?? 20,
        preset: settings?.reencodePreset ?? 'faster',
        keepOriginalDays: settings?.keepOriginalDays ?? 3,
        setStage,
        note,
        assertLease,
        stagingName,
      });
      await finishJob(job, { state: 'DONE', stage: 'done', progress: 1, etaSeconds: null, finishedAt: new Date(), lastError: null, errorClass: null });
      return;
    }
    if (job.kind === 'FORMATS' && job.videoId) {
      const video = await prisma.creatorVideo.findUniqueOrThrow({ where: { id: job.videoId }, include: { creator: true } });
      session = await ADAPTERS[job.platform].openSession(settings, { prisma, video });
      downloadsRunning += 1;
      countedDownload = true;
      await readYoutubeFormats({ prisma, video, cookiesFile: session.cookiesFile, signal: abort.signal });
      await forgetFormatsJob(job);
      return;
    }
    if (job.kind !== 'DOWNLOAD' || !job.videoId) throw new Error(`validation failed: ${job.kind} is not supported yet`);
    const video = await prisma.creatorVideo.findUniqueOrThrow({ where: { id: job.videoId }, include: { creator: true } });
    const adapter = ADAPTERS[job.platform];
    session = await adapter.openSession(settings, { prisma, video });
    downloadsRunning += 1;
    countedDownload = true;
    await runDownload({
      prisma,
      job,
      video,
      options: job.options as unknown as DownloadOptions,
      signal: abort.signal,
      minFreeGb: settings?.minFreeGb ?? 50,
      reencodeEnabled: settings?.reencodeEnabled ?? true,
      cookiesFile: session.cookiesFile,
      browserToken: session.browserToken,
      setStage,
      note,
      assertLease,
      stagingName,
    }, adapter);
    await finishJob(job, { state: 'DONE', stage: 'done', progress: 1, speedBps: null, etaSeconds: null, finishedAt: new Date(), lastError: null, errorClass: null });
    await noteExtractorResult(job.platform, false);
    if (job.platform === 'YOUTUBE' && session?.cookiesFile) await noteAccount(true);
    log('info', 'Job finished', { jobId: job.id });
  } catch (error) {
    await rm(path.join(libraryFor(job.platform).staging, stagingName), { recursive: true, force: true }).catch(() => undefined);
    if (leaseLost || error instanceof LeaseLostError) {
      log('warn', 'Lost the lease on a job', { jobId: job.id });
    } else if (job.kind === 'FORMATS') {
      // Nothing is lost: the sheet falls back to estimates, and a person can open it again.
      log('warn', 'Format lookup failed', { jobId: job.id, error: String(error).slice(0, 300) });
      await forgetFormatsJob(job);
    } else if (stopping && error instanceof JobCancelledError) {
      await finishJob(job, { state: 'QUEUED', stage: null, attempts: { decrement: 1 } });
    } else if (error instanceof JobCancelledError) {
      await finishJob(job, { state: 'CANCELLED', stage: 'cancelled', finishedAt: new Date() });
    } else if (error instanceof WaitForRecordingError) {
      await finishJob(job, { state: 'RETRY_WAIT', stage: 'waiting_recorded', runAfter: error.runAfter, attempts: { decrement: 1 } });
    } else if (error instanceof DeferJobError) {
      await finishJob(job, { state: 'RETRY_WAIT', stage: error.stage, runAfter: error.runAfter, attempts: { decrement: 1 } });
    } else if (error instanceof DiskGuardError) {
      await finishJob(job, {
        state: 'BLOCKED',
        stage: 'waiting for disk',
        errorClass: 'disk',
        lastError: error.message,
        runAfter: new Date(Date.now() + DISK_RECHECK_MS),
        attempts: { decrement: 1 },
      });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      let errorClass = classifyJobError(message, job.platform);
      // YouTube can ask for an age check on a video its API did not flag. With the account
      // in use, the same answer means the account itself no longer works.
      if (errorClass === 'ageRestricted' && job.videoId) {
        await prisma.creatorVideo.update({ where: { id: job.videoId }, data: { ageRestricted: true } });
        if (session?.cookiesFile) errorClass = 'cookiesExpired';
      }
      if (errorClass === 'cookiesExpired') await noteAccount(false);
      const next = nextStepAfterFailure(errorClass, job.attempts);
      if (job.kind === 'DOWNLOAD') await noteExtractorResult(job.platform, errorClass === 'extractor');
      await finishJob(job, {
        state: next.state,
        errorClass,
        lastError: withoutSignedLinks(message).slice(0, 1000),
        ...(next.state === 'RETRY_WAIT' ? { runAfter: new Date(Date.now() + next.delayMs) } : {}),
        ...(next.state === 'FAILED' ? { finishedAt: new Date() } : {}),
      });
      await event(job.id, 'error', message);
      log('warn', 'Job failed', { jobId: job.id, errorClass, state: next.state });
    }
  } finally {
    clearInterval(renew);
    clearInterval(cancelWatch);
    running.delete(job.id);
    if (countedDownload) downloadsRunning -= 1;
    await session?.release();
  }
}

async function heartbeat(): Promise<void> {
  const stats = await statfs(libraryFor(TWITCH).root).catch(() => null);
  const [ytdlp, td, ytdlpYoutube] = await Promise.all([activeVersion('ytdlp'), activeVersion('td'), activeVersion('ytdlpYoutube')]);
  const data = {
    version: WORKER_VERSION,
    tools: { ytdlp, td, ytdlpYoutube },
    gpuAvailable,
    diskFreeBytes: stats ? BigInt(stats.bavail) * BigInt(stats.bsize) : null,
    diskTotalBytes: stats ? BigInt(stats.blocks) * BigInt(stats.bsize) : null,
    lanes: { running: running.size },
    platforms: PLATFORMS,
    roots: Object.fromEntries(await Promise.all(ALL_PLATFORMS.map(async (platform) => {
      const { root } = libraryFor(platform);
      const space = await isMountedFolder(root) ? await statfs(root).catch(() => null) : null;
      return [platform, {
        available: space !== null,
        freeBytes: space ? Number(BigInt(space.bavail) * BigInt(space.bsize)) : null,
        totalBytes: space ? Number(BigInt(space.blocks) * BigInt(space.bsize)) : null,
      }];
    }))),
    lastSeenAt: new Date(),
  };
  await prisma.archiveWorkerHeartbeat.upsert({ where: { workerId }, update: data, create: { workerId, ...data } });
}

// A lookup leaves no history worth keeping, and the Queue is for downloads.
async function forgetFormatsJob(job: ArchiveJob): Promise<void> {
  await prisma.archiveJob.deleteMany({ where: { id: job.id, leaseOwner: workerId } });
}

async function readyPlatforms(settings: { toolsPausedAt: Date | null } | null): Promise<ArchivePlatform[]> {
  const youtube = await prisma.youtubeSettings.findUnique({ where: { id: 'singleton' }, select: { toolsPausedAt: true } });
  const paused = { TWITCH: settings?.toolsPausedAt, YOUTUBE: youtube?.toolsPausedAt };
  return PLATFORMS.filter((platform) => !paused[platform]);
}

async function claimNetworkJob(held: boolean, ready: ArchivePlatform[]): Promise<ArchiveJob | null> {
  const job = held ? null : await claimJob(prisma, workerId, NETWORK_KINDS, ready);
  return job ?? claimJob(prisma, workerId, FILE_KINDS, PLATFORMS);
}

async function noteAccount(works: boolean): Promise<void> {
  await prisma.youtubeSettings.updateMany({ data: { cookiesValid: works, cookiesCheckedAt: new Date() } });
}

async function networkLane(): Promise<void> {
  while (!stopping) {
    const settings = await prisma.archiveSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    if (running.size - (cpuBusy ? 1 : 0) - (formatsBusy ? 1 : 0) < (settings?.maxConcurrentDownloads ?? 2)) {
      // Nothing new uses the tools while they are about to be swapped, and a platform whose
      // tools are broken stops alone. File housekeeping needs no tools.
      const held = Boolean(toolsBusy || settings?.toolUpdateRequestedAt);
      const job = await claimNetworkJob(held, await readyPlatforms(settings)).catch((error) => {
        log('error', 'Claim failed', { error: String(error) });
        return null;
      });
      if (job) {
        void runJob(job);
        continue;
      }
    }
    await sleep(POLL_MS);
  }
}

// Its own slot, because a person is waiting on this and two long downloads must not hold it up.
async function formatsLane(): Promise<void> {
  while (!stopping) {
    const settings = await prisma.archiveSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    const ready = (await readyPlatforms(settings).catch(() => [])).filter((platform) => platform === 'YOUTUBE');
    const held = toolsBusy || settings?.toolUpdateRequestedAt;
    const job = held ? null : await claimJob(prisma, workerId, ['FORMATS'], ready).catch(() => null);
    if (job) {
      formatsBusy = true;
      await runJob(job).finally(() => {
        formatsBusy = false;
      });
    } else {
      await sleep(FORMATS_POLL_MS);
    }
  }
}

// One encode at a time, only at night, never while Jellyfin needs the same iGPU.
// An encode already running finishes past the end of the window. A person asking for
// one now is the exception: the window and the Jellyfin hold are theirs to overrule.
async function cpuLane(): Promise<void> {
  while (!stopping) {
    await sleep(CPU_POLL_MS);
    if (!gpuAvailable || cpuBusy) continue;
    const settings = await prisma.archiveSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    const now = new Date();
    const open = Boolean(settings?.reencodeEnabled)
      && inReencodeWindow(now, settings?.reencodeWindowStart ?? '01:00', settings?.reencodeWindowEnd ?? '08:00')
      && !(settings?.jellyfinBusyUntil && settings.jellyfinBusyUntil > now);

    const job = await claimJob(prisma, workerId, ['REENCODE'], PLATFORMS, open ? undefined : REENCODE_NOW_PRIORITY).catch(() => null);
    if (!job) continue;
    cpuBusy = true;
    void runJob(job).finally(() => {
      cpuBusy = false;
    });
  }
}

async function housekeeping(): Promise<void> {
  for (const platform of PLATFORMS) {
    const measured = await measureParkedOriginals(prisma, platform);
    if (measured > 0) log('info', 'Measured parked originals', { platform, measured });
    const deleted = await deleteExpiredOriginals(prisma, platform);
    if (deleted > 0) log('info', 'Deleted originals', { platform, deleted });
  }
  await cleanStaging();
}

async function checkDeletedFiles(): Promise<void> {
  for (const platform of PLATFORMS) {
    const forgotten = await forgetFilesDeletedElsewhere(prisma, platform);
    if (forgotten > 0) log('info', 'Forgot files deleted outside Helprr', { platform, forgotten });
  }
}

// Only what no live lease covers, so it cannot pull files from under another worker.
async function cleanStaging(): Promise<void> {
  const leased = await prisma.archiveJob.findMany({
    where: { state: 'RUNNING', leaseUntil: { gt: new Date() } },
    select: { id: true },
  });
  const live = new Set([...running.keys(), ...leased.map((job) => job.id)]);
  for (const platform of PLATFORMS) {
    const { staging } = libraryFor(platform);
    for (const entry of await readdir(staging)) {
      if (!live.has(entry.split('-')[0])) await rm(path.join(staging, entry), { recursive: true, force: true });
    }
  }
}

async function newestVideo(platform: ArchivePlatform): Promise<string | null> {
  const video = await prisma.creatorVideo.findFirst({
    where: { platform, availability: 'PUBLISHED' },
    orderBy: { sourceCreatedAt: 'desc' },
    select: { externalId: true },
  });
  return video?.externalId ?? null;
}

// A platform with nothing to test against still checks the tool runs, and says so.
async function prepareSmokeVideos(): Promise<void> {
  const twitch = await newestVideo('TWITCH');
  setSmokeVideo('ytdlp', twitch ? ['-J', '--no-playlist', `https://www.twitch.tv/videos/${twitch}`] : null);
  const youtube = await newestVideo('YOUTUBE');
  setSmokeVideo('ytdlpYoutube', youtube ? youtubeVideoArgs(youtube) : null);
  if (!twitch) log('info', 'No Twitch video to smoke test with');
  if (!youtube && PLATFORMS.includes('YOUTUBE')) log('info', 'No YouTube video to smoke test with');
}

// Apart from Twitch's, because a bad YouTube release or a slow GitHub must never stop Twitch
// from starting. Without its tool YouTube waits, and the next tool check tries again.
async function ensureYoutubeTool(pins: Partial<Record<ToolName, string>>): Promise<void> {
  if (!youtubeMounted) return;
  youtubeToolTriedAt = Date.now();
  try {
    await ensureTools(pins, YOUTUBE_TOOLS);
    if (!PLATFORMS.includes('YOUTUBE')) PLATFORMS.push('YOUTUBE');
  } catch (error) {
    PLATFORMS.splice(0, PLATFORMS.length, ...PLATFORMS.filter((platform) => platform !== 'YOUTUBE'));
    log('error', 'YouTube is off: its yt-dlp could not be installed', { error: String(error).slice(0, 300) });
  }
}

// Straight away, not at the next daily check: YouTube breaks often and is often fixed the same day.
async function repairYoutubeTools(pins: Partial<Record<ToolName, string>>): Promise<void> {
  if (!PLATFORMS.includes('YOUTUBE') || downloadsRunning > 0) return;
  const youtube = await prisma.youtubeSettings.findUnique({ where: { id: 'singleton' }, select: { toolsPausedAt: true } });
  if (!youtube?.toolsPausedAt || Date.now() - youtubeRepairAt < TOOL_CHECK_MS) return;
  youtubeRepairAt = Date.now();
  toolsBusy = true;
  try {
    await prepareSmokeVideos();
    if (await updateTools(pins, YOUTUBE_TOOLS)) await pauseStores.YOUTUBE.clear();
  } finally {
    toolsBusy = false;
  }
}

// Daily: learn what is newest, and install it only if the current tools have stopped working.
// A request from the owner installs at once. Either way, a running download keeps its tool.
async function checkTools(): Promise<void> {
  const settings = await prisma.archiveSettings.findUnique({ where: { id: 'singleton' } });
  if (!settings) return;
  // Not every tick: GitHub allows 60 lookups an hour, and Twitch's updates need them too.
  if (youtubeMounted && !PLATFORMS.includes('YOUTUBE') && downloadsRunning === 0 && Date.now() - youtubeToolTriedAt > YOUTUBE_TOOL_RETRY_MS) {
    await prepareSmokeVideos();
    await ensureYoutubeTool((settings.pinnedTools ?? {}) as Partial<Record<ToolName, string>>);
  }
  await repairYoutubeTools((settings.pinnedTools ?? {}) as Partial<Record<ToolName, string>>)
    .catch((error) => log('warn', 'YouTube tool repair failed', { error: String(error).slice(0, 300) }));

  // A new pin is tried once, so a mistyped version is not fetched every few seconds.
  const pinned = JSON.stringify(settings.pinnedTools ?? {});
  if (pinned !== appliedPins && downloadsRunning === 0) {
    appliedPins = pinned;
    toolsBusy = true;
    try {
      await prepareSmokeVideos();
      const pins = (settings.pinnedTools ?? {}) as Partial<Record<ToolName, string>>;
      await ensureTools(pins, TWITCH_TOOLS);
      // A pin can be the cure for a pause, so the tools get another go.
      await pauseStores.TWITCH.clear();
      await ensureYoutubeTool(pins);
      await pauseStores.YOUTUBE.clear();
    } finally {
      toolsBusy = false;
    }
  }
  const requested = settings.toolUpdateRequestedAt !== null;
  const due = !settings.toolCheckedAt || Date.now() - settings.toolCheckedAt.getTime() > TOOL_CHECK_MS;
  if (!requested && !due) return;

  const pins = (settings.pinnedTools ?? {}) as Partial<Record<ToolName, string>>;
  if (requested && downloadsRunning > 0) return;
  let toolLatest;
  let updated = false;
  try {
    await prepareSmokeVideos();
    toolLatest = { ytdlp: await latestVersion('ytdlp'), td: await latestVersion('td') };
    if ((requested || settings.toolsPausedAt) && downloadsRunning === 0) updated = await updateTools(pins, TWITCH_TOOLS);
    // Last and on its own, so a failed YouTube smoke test cannot stop a Twitch repair.
    if (requested && PLATFORMS.includes('YOUTUBE')) {
      youtubeRepairAt = 0;
      // As with Twitch, a pause ends when the owner says to try again, new tool or not.
      await updateTools(pins, YOUTUBE_TOOLS).then(() => pauseStores.YOUTUBE.clear()).catch((error) => {
        log('warn', 'YouTube tool update failed', { error: String(error).slice(0, 300) });
      });
    }
  } catch (error) {
    // The installed tools still stand, so a failed update must not keep holding downloads.
    await prisma.archiveSettings.update({ where: { id: 'singleton' }, data: { toolUpdateRequestedAt: null, toolCheckedAt: new Date() } });
    throw error;
  }

  await prisma.archiveSettings.update({
    where: { id: 'singleton' },
    data: {
      toolLatest,
      toolCheckedAt: new Date(),
      toolUpdateRequestedAt: null,
      // A pause ends on new tools, or when the owner says to try again.
      ...(updated || requested ? { toolsPausedAt: null, extractorFailures: 0 } : {}),
    },
  });
  log('info', 'Tools checked', { updated, requested });
}

interface PauseStore {
  clear(): Promise<unknown>;
  countFailure(): Promise<number>;
  reset(): Promise<unknown>;
  pause(): Promise<unknown>;
}

// One count and one pause per platform, so YouTube breaking leaves Twitch downloading.
const pauseStores: Record<ArchivePlatform, PauseStore> = {
  TWITCH: {
    clear: () => prisma.archiveSettings.updateMany({ data: { toolsPausedAt: null, extractorFailures: 0 } }),
    countFailure: async () => (await prisma.archiveSettings.update({
      where: { id: 'singleton' },
      data: { extractorFailures: { increment: 1 } },
    })).extractorFailures,
    reset: () => prisma.archiveSettings.updateMany({ where: { extractorFailures: { gt: 0 } }, data: { extractorFailures: 0 } }),
    pause: () => prisma.archiveSettings.updateMany({ where: { toolsPausedAt: null }, data: { toolsPausedAt: new Date(), toolCheckedAt: null } }),
  },
  YOUTUBE: {
    clear: () => prisma.youtubeSettings.updateMany({ data: { toolsPausedAt: null, extractorFailures: 0 } }),
    countFailure: async () => (await prisma.youtubeSettings.upsert({
      where: { id: 'singleton' },
      update: { extractorFailures: { increment: 1 } },
      create: { id: 'singleton', extractorFailures: 1 },
    })).extractorFailures,
    reset: () => prisma.youtubeSettings.updateMany({ where: { extractorFailures: { gt: 0 } }, data: { extractorFailures: 0 } }),
    pause: () => prisma.youtubeSettings.updateMany({ where: { toolsPausedAt: null }, data: { toolsPausedAt: new Date() } }),
  },
};

// Several videos failing the same way points at the tools, not the videos.
async function noteExtractorResult(platform: ArchivePlatform, failed: boolean): Promise<void> {
  const store = pauseStores[platform];
  if (!failed) {
    await store.reset();
    return;
  }
  const failures = await store.countFailure();
  if (failures >= EXTRACTOR_FAILURE_LIMIT) {
    await store.pause();
    log('warn', 'Downloads paused: the tools keep failing', { platform, failures });
  }
}

async function shutdown(signal: string): Promise<void> {
  log('info', 'Shutting down', { signal, running: running.size });
  stopping = true;
  for (const abort of running.values()) abort.abort();
  while (running.size > 0) await sleep(100);
  await prisma.$disconnect();
  process.exit(0);
}

async function main(): Promise<void> {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await waitForMigrations();
  const leftovers = await removeLeftoverCookies().catch(() => 0);
  if (leftovers > 0) log('info', 'Removed leftover account files', { leftovers });
  youtubeMounted = await isMountedFolder(libraryFor('YOUTUBE').root);
  const roots = youtubeMounted ? ['TWITCH', 'YOUTUBE'] as const : ['TWITCH'] as const;
  await assertSeparateRoots(roots.map((platform) => libraryFor(platform).root));
  for (const platform of roots) await probeLibrary(platform);
  await cleanStaging();

  const settings = await prisma.archiveSettings.findUnique({ where: { id: 'singleton' } });
  appliedPins = JSON.stringify(settings?.pinnedTools ?? {});
  const pins = (settings?.pinnedTools ?? {}) as Partial<Record<ToolName, string>>;
  await ensureTools(pins, TWITCH_TOOLS);
  await ensureYoutubeTool(pins);

  gpuAvailable = await probeGpu();
  log('info', 'GPU probe finished', { gpuAvailable });

  await heartbeat();
  void housekeeping().catch((error) => log('warn', 'Housekeeping failed', { error: String(error) }));
  setInterval(() => void housekeeping().catch((error) => log('warn', 'Housekeeping failed', { error: String(error) })), HOUSEKEEPING_MS);
  setInterval(() => void checkDeletedFiles().catch((error) => log('warn', 'Deleted-file check failed', { error: String(error) })), DELETED_CHECK_MS);
  setInterval(() => void checkTools().catch((error) => log('warn', 'Tool check failed', { error: String(error).slice(0, 300) })), HEARTBEAT_MS);
  setInterval(() => void heartbeat().catch((error) => log('warn', 'Heartbeat failed', { error: String(error) })), HEARTBEAT_MS);
  log('info', 'Worker ready', { workerId, version: WORKER_VERSION });
  await Promise.all([networkLane(), cpuLane(), formatsLane()]);
}

main().catch((error) => {
  log('error', 'Worker crashed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
