import type { Prisma } from '@prisma/client';
import { sizeThumbnail } from './serialize';

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
  attempts: true,
  cancelRequested: true,
  requestedByUserId: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  video: {
    select: {
      id: true,
      externalId: true,
      title: true,
      thumbnailUrl: true,
      durationSeconds: true,
      creator: { select: { id: true, displayName: true } },
    },
  },
} satisfies Prisma.ArchiveJobSelect;

export type JobRow = Prisma.ArchiveJobGetPayload<{ select: typeof JOB_SELECT }>;

/** BigInt does not survive JSON. */
export function serializeJob({ video, ...job }: JobRow) {
  return {
    ...job,
    video: video && {
      id: video.id,
      twitchVideoId: video.externalId,
      title: video.title,
      thumbnailUrl: sizeThumbnail(video.thumbnailUrl, 320, 180),
      durationSeconds: video.durationSeconds,
      streamer: video.creator,
    },
    bytesDone: job.bytesDone === null ? null : Number(job.bytesDone),
    bytesTotal: job.bytesTotal === null ? null : Number(job.bytesTotal),
  };
}
