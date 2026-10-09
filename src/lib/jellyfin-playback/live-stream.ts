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
 *
 * The stream on the player is the *previous* item's until this one's has been
 * negotiated, so its source only counts when it belongs to `item`. Otherwise a
 * film started from a channel would be shown as a broadcast.
 */
export function isLiveStream(
  item: Pick<JellyfinItem, 'Id' | 'Type'> | null | undefined,
  stream?: { item: Pick<JellyfinItem, 'Id'>; mediaSource: Pick<JellyfinMediaSource, 'IsInfiniteStream'> } | null,
): boolean {
  if (!item) return false;
  const source = stream?.item.Id === item.Id ? stream.mediaSource : null;
  return source?.IsInfiniteStream === true || item.Type === 'TvChannel';
}
