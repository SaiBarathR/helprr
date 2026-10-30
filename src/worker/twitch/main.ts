import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, PrismaClient, type TwitchJob, type TwitchJobKind } from '@prisma/client';
import { classifyJobError, nextStepAfterFailure } from '@/lib/twitch/job-errors';
import type { DownloadOptions } from '@/lib/twitch/jobs';
import { decryptTwitchToken } from '@/lib/twitch/token-cipher';
import { LIBRARY_DIR, STAGING_DIR, WORKER_VERSION } from './env';
import { DiskGuardError, runDownload, WaitForRecordingError } from './pipeline';
import { JobCancelledError } from './process';
import { activeVersion, ensureTools } from './tools';

const LEASE_MS = 60_000;
const RENEW_MS = 20_000;
const POLL_MS = 5_000;
const CANCEL_POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const MIGRATION_POLL_MS = 5_000;
const REQUIRED_MIGRATION = '20261030120100_twitch_tables';
const NETWORK_KINDS: TwitchJobKind[] = ['DOWNLOAD', 'DELETE_FILES'];

const prisma = new PrismaClient();
const workerId = `${os.hostname()}-${randomUUID().slice(0, 8)}`;
const running = new Map<string, AbortController>();
let stopping = false;

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

/** One atomic claim: SKIP LOCKED keeps two workers off one job, and an expired lease is taken over. */
async function claim(kinds: TwitchJobKind[]): Promise<TwitchJob | null> {
  const rows = await prisma.$queryRaw<TwitchJob[]>`
    UPDATE "TwitchJob" SET
      "state" = 'RUNNING',
      "leaseOwner" = ${workerId},
      "leaseUntil" = NOW() + (${LEASE_MS} * INTERVAL '1 millisecond'),
      "attempts" = "attempts" + 1,
      "startedAt" = COALESCE("startedAt", NOW()),
      "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "TwitchJob"
      WHERE "kind"::text IN (${Prisma.join(kinds)})
        AND "cancelRequested" = false
        AND (
          ("state" IN ('QUEUED', 'RETRY_WAIT') AND "runAfter" <= NOW())
          OR ("state" = 'RUNNING' AND "leaseUntil" < NOW())
        )
      ORDER BY "priority" DESC, "runAfter" ASC, "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

// Tokens go in a mode-600 file per job, never argv, and it is removed with the job.
async function writeCookies(): Promise<{ file: string; dir: string } | null> {
  const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } });
  const token = decryptTwitchToken(settings?.browserAuthToken);
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
  const renew = setInterval(() => {
    void prisma.twitchJob.updateMany({
      where: { id: job.id, leaseOwner: workerId },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    }).catch(() => undefined);
  }, RENEW_MS);
  const cancelWatch = setInterval(() => {
    void prisma.twitchJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } })
      .then((row) => { if (row?.cancelRequested) abort.abort(); })
      .catch(() => undefined);
  }, CANCEL_POLL_MS);

  let cookies: { file: string; dir: string } | null = null;
  try {
    if (job.kind !== 'DOWNLOAD' || !job.videoId) throw new Error(`validation failed: ${job.kind} is not supported yet`);
    const video = await prisma.twitchVideo.findUniqueOrThrow({ where: { id: job.videoId }, include: { streamer: true } });
    const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } });
    cookies = await writeCookies();
    await runDownload({
      prisma,
      job,
      video,
      options: job.options as unknown as DownloadOptions,
      signal: abort.signal,
      minFreeGb: settings?.minFreeGb ?? 50,
      cookiesFile: cookies?.file ?? null,
      setStage: async (stage) => {
        await prisma.twitchJob.update({ where: { id: job.id }, data: { stage } });
        await event(job.id, 'info', stage);
      },
    });
    await finishJob(job, { state: 'DONE', stage: 'done', progress: 1, finishedAt: new Date(), lastError: null, errorClass: null });
    log('info', 'Job finished', { jobId: job.id });
  } catch (error) {
    await rm(path.join(STAGING_DIR, job.id), { recursive: true, force: true }).catch(() => undefined);
    if (stopping && error instanceof JobCancelledError) {
      await finishJob(job, { state: 'QUEUED', stage: null, attempts: { decrement: 1 } });
    } else if (error instanceof JobCancelledError) {
      await finishJob(job, { state: 'CANCELLED', stage: 'cancelled', finishedAt: new Date() });
    } else if (error instanceof WaitForRecordingError) {
      await finishJob(job, { state: 'RETRY_WAIT', stage: 'waiting_recorded', runAfter: error.runAfter, attempts: { decrement: 1 } });
    } else if (error instanceof DiskGuardError) {
      await finishJob(job, { state: 'BLOCKED', stage: 'waiting for disk', errorClass: 'disk', lastError: error.message });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = classifyJobError(message);
      const next = nextStepAfterFailure(errorClass, job.attempts);
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
    if (cookies) await rm(cookies.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function heartbeat(): Promise<void> {
  const stats = await statfs(LIBRARY_DIR).catch(() => null);
  const [ytdlp, td] = await Promise.all([activeVersion('ytdlp'), activeVersion('td')]);
  const data = {
    version: WORKER_VERSION,
    tools: { ytdlp, td },
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
    if (running.size < (settings?.maxConcurrentDownloads ?? 2)) {
      const job = await claim(NETWORK_KINDS).catch((error) => {
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
  for (const entry of await readdir(STAGING_DIR)) await rm(path.join(STAGING_DIR, entry), { recursive: true, force: true });

  const settings = await prisma.twitchSettings.findUnique({ where: { id: 'singleton' } });
  await ensureTools((settings?.pinnedTools ?? {}) as Record<string, string>);

  await heartbeat();
  setInterval(() => void heartbeat().catch((error) => log('warn', 'Heartbeat failed', { error: String(error) })), HEARTBEAT_MS);
  log('info', 'Worker ready', { workerId, version: WORKER_VERSION });
  await networkLane();
}

main().catch((error) => {
  log('error', 'Worker crashed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
