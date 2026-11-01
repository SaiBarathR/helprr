import { serializeVideoRow, type VideoRow } from '@/lib/archive/serialize-video';

/**
 * A tab left open across a release keeps its old JavaScript, which reads these names and
 * would crash on a refetch. Remove this one release after the names changed.
 */
export function previousVideoNames(video: { externalId: string; creator: unknown }) {
  return { twitchVideoId: video.externalId, streamer: video.creator };
}

/** Helix thumbnail URLs carry %{width}x%{height} placeholders. */
export function sizeThumbnail(url: string | null, width = 640, height = 360): string | null {
  if (!url || url.includes('/_404/')) return null;
  return url.replace('%{width}', String(width)).replace('%{height}', String(height));
}

export function serializeVideo(video: VideoRow, seenAt?: Date | null) {
  const row = serializeVideoRow(video, seenAt);
  return {
    ...row,
    ...previousVideoNames(row),
    twitchCreatedAt: row.sourceCreatedAt,
    thumbnailUrl: sizeThumbnail(row.thumbnailUrl),
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
