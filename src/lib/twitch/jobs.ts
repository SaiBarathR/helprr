import { Prisma, type TwitchJobSource, type TwitchJobState } from '@prisma/client';
import { prisma } from '@/lib/db';

export const ACTIVE_JOB_STATES: TwitchJobState[] = ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'];
const CLIENT_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface DownloadOptions {
  quality: string;
  chat: boolean;
  chapters: boolean;
  reencode: boolean;
  keepForever: boolean;
}

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  quality: '1080p60',
  chat: true,
  chapters: true,
  reencode: true,
  keepForever: false,
};

export function isClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_REQUEST_ID.test(value);
}

export interface EnqueueInput {
  videoId: string;
  source: TwitchJobSource;
  options: DownloadOptions;
  trace?: Prisma.InputJsonValue;
  priority?: number;
  actor?: { id: string; username: string } | null;
  clientRequestId?: string;
}

/** The one way a download is queued. At most one active download per video, checked and created under a lock. */
export async function enqueueDownload(input: EnqueueInput): Promise<{ jobId: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`twitch-download:${input.videoId}`}))`;

    if (input.clientRequestId && input.actor) {
      const repeat = await tx.twitchJob.findUnique({
        where: {
          requestedByUserId_clientRequestId: {
            requestedByUserId: input.actor.id,
            clientRequestId: input.clientRequestId,
          },
        },
        select: { id: true },
      });
      if (repeat) return { jobId: repeat.id, created: false };
    }

    const active = await tx.twitchJob.findFirst({
      where: { videoId: input.videoId, kind: 'DOWNLOAD', state: { in: ACTIVE_JOB_STATES } },
      select: { id: true },
    });
    if (active) return { jobId: active.id, created: false };

    const job = await tx.twitchJob.create({
      data: {
        kind: 'DOWNLOAD',
        videoId: input.videoId,
        source: input.source,
        priority: input.priority ?? 0,
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
