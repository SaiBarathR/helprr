import { Prisma, type ArchiveJobSource, type ArchivePlatform, type ArchiveJobState } from '@prisma/client';
import { prisma } from '@/lib/db';

export const ACTIVE_JOB_STATES: ArchiveJobState[] = ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'];
/** An automatic delete that has passed its last check, so it can no longer be stopped. */
export const REMOVING_STAGE = 'removing';
const CLIENT_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface DownloadOptions {
  quality: string;
  chat: boolean;
  chapters: boolean;
  reencode: boolean;
  keepForever: boolean;
  /** YouTube only. */
  codec?: string;
  hdr?: boolean;
  /** The exact copy the sheet showed. Only ever matched against the worker's own list. */
  formatId?: string;
  captions?: boolean;
  sponsorblock?: string;
}

export const DOWNLOAD_OPTION_KEYS = ['chat', 'chapters', 'reencode', 'keepForever'] as const;

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  quality: '1080p60',
  chat: true,
  chapters: true,
  reencode: true,
  keepForever: false,
};

// A YouTube file is already well encoded: re-encoding made every test file larger.
export const DEFAULT_YOUTUBE_OPTIONS: DownloadOptions = {
  quality: '1080',
  codec: 'compatible',
  chat: false,
  chapters: true,
  captions: true,
  sponsorblock: 'mark',
  reencode: false,
  keepForever: false,
};

const WATCHED_DOWNLOADS = 500;

/**
 * The videos downloading or waiting to, and nothing else, so an open page can cheaply notice a
 * download that a rule or another device started.
 */
export async function activeDownloadVideoIds(platform: ArchivePlatform): Promise<string[]> {
  const rows = await prisma.archiveJob.findMany({
    where: { platform, kind: 'DOWNLOAD', state: { in: ACTIVE_JOB_STATES }, videoId: { not: null } },
    orderBy: { videoId: 'asc' },
    take: WATCHED_DOWNLOADS,
    select: { videoId: true },
  });
  return [...new Set(rows.map((row) => row.videoId!))];
}

export function isClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_REQUEST_ID.test(value);
}

export interface EnqueueInput {
  platform: ArchivePlatform;
  videoId: string;
  source: ArchiveJobSource;
  options: DownloadOptions;
  trace?: Prisma.InputJsonValue;
  priority?: number;
  /** Not before this time. Rules use it to give a new video time to settle. */
  runAfter?: Date;
  actor?: { id: string; username: string } | null;
  clientRequestId?: string;
  /** A person asking: a rule's download still waiting to settle starts now, with their choices. */
  startWaitingRuleJob?: boolean;
}

/** The one way a download is queued. At most one active download per video, checked and created under a lock. */
export async function enqueueDownload(
  input: EnqueueInput,
): Promise<{ jobId: string; created: boolean; startedNow?: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-download:${input.videoId}`}))`;

    if (input.clientRequestId && input.actor) {
      const repeat = await tx.archiveJob.findUnique({
        where: {
          platform_requestedByUserId_clientRequestId: {
            platform: input.platform,
            requestedByUserId: input.actor.id,
            clientRequestId: input.clientRequestId,
          },
        },
        select: { id: true },
      });
      if (repeat) return { jobId: repeat.id, created: false };
    }

    const active = await tx.archiveJob.findFirst({
      where: { videoId: input.videoId, kind: 'DOWNLOAD', state: { in: ACTIVE_JOB_STATES } },
      select: { id: true },
    });
    if (active && input.startWaitingRuleJob && input.actor) {
      // Only a rule's job no one has started: a claim moves it off QUEUED under the row lock, so a
      // job the worker took a moment ago is left alone, whether or not its wait had passed.
      const { count } = await tx.archiveJob.updateMany({
        where: { id: active.id, source: 'RULE', state: 'QUEUED', cancelRequested: false },
        data: {
          runAfter: new Date(),
          source: input.source,
          options: input.options as unknown as Prisma.InputJsonValue,
          // Audits name whoever set this running, not the rule that picked it.
          requestedByUserId: input.actor.id,
          requestedByUsername: input.actor.username,
          clientRequestId: input.clientRequestId,
        },
      });
      if (count > 0) return { jobId: active.id, created: false, startedNow: true };
    }
    if (active) return { jobId: active.id, created: false };

    const job = await tx.archiveJob.create({
      data: {
        platform: input.platform,
        kind: 'DOWNLOAD',
        videoId: input.videoId,
        source: input.source,
        priority: input.priority ?? 0,
        ...(input.runAfter ? { runAfter: input.runAfter } : {}),
        options: input.options as unknown as Prisma.InputJsonValue,
        trace: input.trace,
        requestedByUserId: input.actor?.id,
        requestedByUsername: input.actor?.username,
        clientRequestId: input.clientRequestId,
      },
      select: { id: true },
    });
    return { jobId: job.id, created: true };
  });
}

/** Under the same lock as enqueueing, so a retry cannot make a second active download. */
export async function retryJob(
  jobId: string,
  actor: { id: string; username: string },
  platform: ArchivePlatform,
): Promise<'retried' | 'active' | 'not-retryable'> {
  const target = await prisma.archiveJob.findUnique({ where: { id: jobId, platform }, select: { kind: true, videoId: true } });
  if (!target) return 'not-retryable';

  return prisma.$transaction(async (tx) => {
    if (target.videoId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-download:${target.videoId}`}))`;
    }
    if (target.kind === 'DOWNLOAD' && target.videoId) {
      const active = await tx.archiveJob.findFirst({
        where: { videoId: target.videoId, kind: 'DOWNLOAD', state: { in: ACTIVE_JOB_STATES }, id: { not: jobId } },
        select: { id: true },
      });
      if (active) return 'active';
    }
    const { count } = await tx.archiveJob.updateMany({
      where: { id: jobId, state: { in: ['FAILED', 'CANCELLED'] } },
      data: {
        state: 'QUEUED',
        attempts: 0,
        runAfter: new Date(),
        cancelRequested: false,
        errorClass: null,
        lastError: null,
        stage: null,
        progress: null,
        finishedAt: null,
        failureNotifiedAt: null,
        // Audits name whoever set this running, not whoever first asked.
        requestedByUserId: actor.id,
        requestedByUsername: actor.username,
      },
    });
    return count === 0 ? 'not-retryable' : 'retried';
  });
}
