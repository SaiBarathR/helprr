import type { Prisma } from '@prisma/client';

export const JOB_SELECT = {
  id: true,
  kind: true,
  state: true,
  source: true,
  priority: true,
  stage: true,
  progress: true,
  speedBps: true,
  etaSeconds: true,
  bytesDone: true,
  bytesTotal: true,
  errorClass: true,
  lastError: true,
  attempts: true,
  cancelRequested: true,
  requestedByUserId: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  video: {
    select: {
      id: true,
      title: true,
      thumbnailUrl: true,
      durationSeconds: true,
      streamer: { select: { displayName: true } },
    },
  },
} satisfies Prisma.TwitchJobSelect;

export type JobRow = Prisma.TwitchJobGetPayload<{ select: typeof JOB_SELECT }>;

/** BigInt does not survive JSON. */
export function serializeJob(job: JobRow) {
  return {
    ...job,
    bytesDone: job.bytesDone === null ? null : Number(job.bytesDone),
    bytesTotal: job.bytesTotal === null ? null : Number(job.bytesTotal),
  };
}
