import type { Prisma } from '@prisma/client';

// The only video shape that leaves the server: never a file path.
export const VIDEO_SELECT = {
  id: true,
  externalId: true,
  type: true,
  title: true,
  description: true,
  sourceCreatedAt: true,
  durationSeconds: true,
  thumbnailUrl: true,
  category: true,
  viewCount: true,
  mutedSegments: true,
  chapters: true,
  availability: true,
  estimatedExpiresAt: true,
  creator: { select: { id: true, login: true, displayName: true, profileImageUrl: true, isLive: true } },
  mediaFiles: { select: { id: true, jellyfinItemId: true } },
  jobs: {
    where: { kind: 'DOWNLOAD', state: { in: ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] } },
    select: { id: true, state: true, stage: true, progress: true },
    take: 1,
  },
} satisfies Prisma.CreatorVideoSelect;

export type VideoRow = Prisma.CreatorVideoGetPayload<{ select: typeof VIDEO_SELECT }>;

export function serializeVideoRow<T extends VideoRow>(video: T, seenAt?: Date | null) {
  const { mediaFiles, jobs, ...rest } = video;
  return {
    ...rest,
    seen: Boolean(seenAt),
    downloaded: mediaFiles.length > 0,
    fileId: mediaFiles[0]?.id ?? null,
    jellyfinItemId: mediaFiles.find((file) => file.jellyfinItemId)?.jellyfinItemId ?? null,
    activeJob: jobs[0] ?? null,
  };
}
