import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, PrismaClient, type TwitchJob, type TwitchJobKind } from '@prisma/client';
import { claimJob, LEASE_MS } from './claim';
import { classifyJobError, nextStepAfterFailure } from '@/lib/twitch/job-errors';
import { inReencodeWindow } from '@/lib/twitch/reencode-window';
import type { DownloadOptions } from '@/lib/twitch/jobs';
import { decryptTwitchToken } from '@/lib/twitch/token-cipher';
import { LIBRARY_DIR, STAGING_DIR, WORKER_VERSION } from './env';
import { runDeleteFiles } from './delete-files';
import { DiskGuardError, runDownload, WaitForRecordingError } from './pipeline';
import { deleteExpiredOriginals, probeGpu, runReencode } from './reencode';
import { DeferJobError, JobCancelledError, LeaseLostError } from './process';
import { activeVersion, ensureTools, latestVersion, updateTools, type ToolName } from './tools';

const RENEW_MS = 20_000;
const POLL_MS = 5_000;
const CANCEL_POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const MIGRATION_POLL_MS = 5_000;
const REQUIRED_MIGRATION = '20261030120100_twitch_tables';
const CPU_POLL_MS = 30_000;
const TOOL_CHECK_MS = 24 * 3_600_000;
const EXTRACTOR_FAILURE_LIMIT = 3;
const DISK_RECHECK_MS = 15 * 60_000;
const HOUSEKEEPING_MS = 60 * 60_000;
const NETWORK_KINDS: TwitchJobKind[] = ['DOWNLOAD', 'DELETE_FILES'];

const prisma = new PrismaClient();
const workerId = `${os.hostname()}-${randomUUID().slice(0, 8)}`;
const running = new Map<string, AbortController>();
let stopping = false;
let gpuAvailable = false;
let cpuBusy = false;
let downloadsRunning = 0;

function log(level: 'info' | 'warn' | 'error', message: string, extra: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ at: new Date().toISOString(), level, message, ...extra }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function event(jobId: string, level: string, message: string) {
  await prisma.twitchJobEvent.create({ data: { jobId, level, message: message.slice(0, 1000) } }).catch(() => undefined);
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

// Jellyfin runs natively and reads the files as "other", so the mode must allow it.
async function probeLibrary(): Promise<void> {
  process.umask(0o022);
  await mkdir(STAGING_DIR, { recursive: true });
  const probe = path.join(STAGING_DIR, `.probe-${workerId}`);
  await writeFile(probe, '');
  const { mode } = await stat(probe);
  await rm(probe);
  log('info', 'Library is writable', { dir: LIBRARY_DIR, mode: (mode & 0o777).toString(8) });
}

// Tokens go in a mode-600 file per job, never argv, and it is removed with the job.
async function writeCookies(token: string | null): Promise<{ file: string; dir: string } | null> {
  if (!token) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'twitch-cookies-'));
  const file = path.join(dir, 'cookies.txt');
  await writeFile(file, `# Netscape HTTP Cookie File\n.twitch.tv\tTRUE\t/\tTRUE\t0\tauth-token\t${token}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return { file, dir };
}

async function finishJob(job: TwitchJob, data: Prisma.TwitchJobUpdateInput) {
  // Only while the lease is ours: a takeover must not be overwritten by a slow first worker.
  await prisma.twitchJob.updateMany({
    where: { id: job.id, leaseOwner: workerId },
    data: { leaseOwner: null, leaseUntil: null, ...data } as Prisma.TwitchJobUpdateManyMutationInput,
  });
}

async function runJob(job: TwitchJob): Promise<void> {
  const abort = new AbortController();
  running.set(job.id, abort);
  let leaseLost = false;
  let renewedAt = Date.now();
  const loseLease = () => {
    leaseLost = true;
    abort.abort();
  };
  const renew = setInterval(() => {
    void prisma.twitchJob.updateMany({
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
    const owned = await prisma.twitchJob.count({ where: { id: job.id, leaseOwner: workerId, state: 'RUNNING' } });
    if (owned === 0) {
      loseLease();
      throw new LeaseLostError();
    }
  };
  // Unique per claim: attempts reset on retry, so they could name a directory still in use.
  const stagingName = `${job.id}-${randomUUID().slice(0, 8)}`;
  const cancelWatch = setInterval(() => {
    void prisma.twitchJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } })
      .then((row) => { if (row?.cancelRequested) abort.abort(); })
      .catch(() => undefined);
  }, CANCEL_POLL_MS);

  let cookies: { file: string; dir: string } | null = null;
  let countedDownload = false;
  try {
    const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } });
    const setStage = async (stage: string) => {
      await prisma.twitchJob.update({ where: { id: job.id }, data: { stage } });
      await event(job.id, 'info', stage);
    };
    const note = (message: string) => event(job.id, 'warn', message);

    if (job.kind === 'DELETE_FILES') {
      await runDeleteFiles(prisma, job);
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
      await finishJob(job, { state: 'DONE', stage: 'done', progress: 1, finishedAt: new Date(), lastError: null, errorClass: null });
      return;
    }
    if (job.kind !== 'DOWNLOAD' || !job.videoId) throw new Error(`validation failed: ${job.kind} is not supported yet`);
    const video = await prisma.twitchVideo.findUniqueOrThrow({ where: { id: job.videoId }, include: { streamer: true } });
    const browserToken = decryptTwitchToken(settings?.browserAuthToken);
    cookies = await writeCookies(browserToken);
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
      cookiesFile: cookies?.file ?? null,
      browserToken,
      setStage,
      note,
      assertLease,
      stagingName,
    });
    await finishJob(job, { state: 'DONE', stage: 'done', progress: 1, speedBps: null, etaSeconds: null, finishedAt: new Date(), lastError: null, errorClass: null });
    await noteExtractorResult(false);
    log('info', 'Job finished', { jobId: job.id });
  } catch (error) {
    await rm(path.join(STAGING_DIR, stagingName), { recursive: true, force: true }).catch(() => undefined);
    if (leaseLost || error instanceof LeaseLostError) {
      log('warn', 'Lost the lease on a job', { jobId: job.id });
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
      const errorClass = classifyJobError(message);
      const next = nextStepAfterFailure(errorClass, job.attempts);
      if (job.kind === 'DOWNLOAD') await noteExtractorResult(errorClass === 'extractor');
      await finishJob(job, {
        state: next.state,
        errorClass,
        lastError: message.slice(0, 1000),
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
    if (cookies) await rm(cookies.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function heartbeat(): Promise<void> {
  const stats = await statfs(LIBRARY_DIR).catch(() => null);
  const [ytdlp, td] = await Promise.all([activeVersion('ytdlp'), activeVersion('td')]);
  const data = {
    version: WORKER_VERSION,
    tools: { ytdlp, td },
    gpuAvailable,
    diskFreeBytes: stats ? BigInt(stats.bavail) * BigInt(stats.bsize) : null,
    diskTotalBytes: stats ? BigInt(stats.blocks) * BigInt(stats.bsize) : null,
    lanes: { running: running.size },
    lastSeenAt: new Date(),
  };
  await prisma.twitchWorkerHeartbeat.upsert({ where: { workerId }, update: data, create: { workerId, ...data } });
}

async function networkLane(): Promise<void> {
  while (!stopping) {
    const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    if (running.size - (cpuBusy ? 1 : 0) < (settings?.maxConcurrentDownloads ?? 2)) {
      // Nothing new uses the tools while they are broken or about to be swapped.
      const held = settings?.toolsPausedAt || settings?.toolUpdateRequestedAt;
      const job = await claimJob(prisma, workerId, held ? ['DELETE_FILES'] : NETWORK_KINDS).catch((error) => {
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

// One encode at a time, only at night, never while Jellyfin needs the same iGPU.
// An encode already running finishes past the end of the window.
async function cpuLane(): Promise<void> {
  while (!stopping) {
    await sleep(CPU_POLL_MS);
    if (!gpuAvailable || cpuBusy) continue;
    const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null);
    if (!settings?.reencodeEnabled) continue;
    const now = new Date();
    if (!inReencodeWindow(now, settings.reencodeWindowStart, settings.reencodeWindowEnd)) continue;
    if (settings.jellyfinBusyUntil && settings.jellyfinBusyUntil > now) continue;

    const job = await claimJob(prisma, workerId, ['REENCODE']).catch(() => null);
    if (!job) continue;
    cpuBusy = true;
    void runJob(job).finally(() => {
      cpuBusy = false;
    });
  }
}

async function housekeeping(): Promise<void> {
  const deleted = await deleteExpiredOriginals(prisma);
  if (deleted > 0) log('info', 'Deleted originals', { deleted });
  await cleanStaging();
}

// Only what no live lease covers, so it cannot pull files from under another worker.
async function cleanStaging(): Promise<void> {
  const leased = await prisma.twitchJob.findMany({
    where: { state: 'RUNNING', leaseUntil: { gt: new Date() } },
    select: { id: true },
  });
  const live = new Set([...running.keys(), ...leased.map((job) => job.id)]);
  for (const entry of await readdir(STAGING_DIR)) {
    if (!live.has(entry.split('-')[0])) await rm(path.join(STAGING_DIR, entry), { recursive: true, force: true });
  }
}

// Daily: learn what is newest, and install it only if the current tools have stopped working.
// A request from the owner installs at once. Either way, a running download keeps its tool.
async function checkTools(): Promise<void> {
  const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } });
  if (!settings) return;
  const requested = settings.toolUpdateRequestedAt !== null;
  const due = !settings.toolCheckedAt || Date.now() - settings.toolCheckedAt.getTime() > TOOL_CHECK_MS;
  if (!requested && !due) return;

  const pins = (settings.pinnedTools ?? {}) as Partial<Record<ToolName, string>>;
  const toolLatest = { ytdlp: await latestVersion('ytdlp'), td: await latestVersion('td') };
  let updated = false;
  if ((requested || settings.toolsPausedAt) && downloadsRunning === 0) updated = await updateTools(pins);
  else if (requested) return;

  await prisma.twitchSettings.update({
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

// Several videos failing the same way points at the tools, not the videos.
async function noteExtractorResult(failed: boolean): Promise<void> {
  if (!failed) {
    await prisma.twitchSettings.updateMany({ where: { extractorFailures: { gt: 0 } }, data: { extractorFailures: 0 } });
    return;
  }
  const { extractorFailures } = await prisma.twitchSettings.update({
    where: { id: 'singleton' },
    data: { extractorFailures: { increment: 1 } },
  });
  if (extractorFailures >= EXTRACTOR_FAILURE_LIMIT) {
    await prisma.twitchSettings.updateMany({ where: { toolsPausedAt: null }, data: { toolsPausedAt: new Date(), toolCheckedAt: null } });
    log('warn', 'Downloads paused: the tools keep failing', { extractorFailures });
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
  await probeLibrary();
  await cleanStaging();

  const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } });
  await ensureTools((settings?.pinnedTools ?? {}) as Record<string, string>);

  gpuAvailable = await probeGpu();
  log('info', 'GPU probe finished', { gpuAvailable });

  await heartbeat();
  void housekeeping().catch((error) => log('warn', 'Housekeeping failed', { error: String(error) }));
  setInterval(() => void housekeeping().catch((error) => log('warn', 'Housekeeping failed', { error: String(error) })), HOUSEKEEPING_MS);
  setInterval(() => void checkTools().catch((error) => log('warn', 'Tool check failed', { error: String(error).slice(0, 300) })), HEARTBEAT_MS);
  setInterval(() => void heartbeat().catch((error) => log('warn', 'Heartbeat failed', { error: String(error) })), HEARTBEAT_MS);
  log('info', 'Worker ready', { workerId, version: WORKER_VERSION });
  await Promise.all([networkLane(), cpuLane()]);
}

main().catch((error) => {
  log('error', 'Worker crashed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
