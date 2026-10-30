import type { Prisma } from '@prisma/client';

// The only video shape that leaves the server: never a file path.
export const VIDEO_SELECT = {
  id: true,
  twitchVideoId: true,
  type: true,
  title: true,
  description: true,
  twitchCreatedAt: true,
  durationSeconds: true,
  thumbnailUrl: true,
  category: true,
  viewCount: true,
  mutedSegments: true,
  chapters: true,
  availability: true,
  estimatedExpiresAt: true,
  streamer: { select: { id: true, login: true, displayName: true, profileImageUrl: true, isLive: true } },
  mediaFiles: { select: { id: true, jellyfinItemId: true } },
  jobs: {
    where: { kind: 'DOWNLOAD', state: { in: ['QUEUED', 'BLOCKED', 'RUNNING', 'RETRY_WAIT'] } },
    select: { id: true, state: true, stage: true, progress: true },
    take: 1,
  },
} satisfies Prisma.TwitchVideoSelect;

export type VideoRow = Prisma.TwitchVideoGetPayload<{ select: typeof VIDEO_SELECT }>;

/** Helix thumbnail URLs carry %{width}x%{height} placeholders. */
export function sizeThumbnail(url: string | null, width = 640, height = 360): string | null {
  if (!url || url.includes('/_404/')) return null;
  return url.replace('%{width}', String(width)).replace('%{height}', String(height));
}

export function serializeVideo(video: VideoRow, seenAt?: Date | null) {
  const { mediaFiles, jobs, thumbnailUrl, ...rest } = video;
  return {
    ...rest,
    thumbnailUrl: sizeThumbnail(thumbnailUrl),
    seen: Boolean(seenAt),
    downloaded: mediaFiles.length > 0,
    fileId: mediaFiles[0]?.id ?? null,
    jellyfinItemId: mediaFiles.find((file) => file.jellyfinItemId)?.jellyfinItemId ?? null,
    activeJob: jobs[0] ?? null,
  };
}

const ARTWORK_HOSTS = new Set(['static-cdn.jtvnw.net', 'vod-secure.twitch.tv']);

/** The worker fetches these URLs, so only Twitch's own image hosts are ever asked. */
export function isTwitchArtworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ARTWORK_HOSTS.has(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port;
  } catch {
    return false;
  }
}
