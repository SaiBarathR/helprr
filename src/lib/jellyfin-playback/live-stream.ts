import type { JellyfinItem, JellyfinMediaSource } from '@/types/jellyfin';

/**
 * Whether what is playing is a broadcast rather than a file.
 *
 * A broadcast has no length, so everything that presents a position inside one
 * — the scrubber, the clock pair, the ten-second skips — describes something
 * that is not there. The media element is no help: hls.js reports the end of
 * what has been transcoded so far as the duration, which is a number that
 * looks like a seventeen-second film.
 *
 * Jellyfin marks a tuned channel's source `IsInfiniteStream`. The channel item
 * covers the moment before a source has been negotiated.
 */
export function isLiveStream(
  item: Pick<JellyfinItem, 'Type'> | null | undefined,
  source?: Pick<JellyfinMediaSource, 'IsInfiniteStream'> | null,
): boolean {
  return source?.IsInfiniteStream === true || item?.Type === 'TvChannel';
}
