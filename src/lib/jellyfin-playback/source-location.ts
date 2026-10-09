import type { JellyfinItem, JellyfinMediaStream } from '@/types/jellyfin';

export function withoutStreamPath(stream: JellyfinMediaStream): JellyfinMediaStream {
  return { ...stream, Path: undefined };
}

/**
 * Jellyfin's single-item response says where the file lives: the server path,
 * and in its media sources a remote source's address and request headers,
 * which can hold that provider's credentials. The browser gets the item
 * without them. Of a media source it keeps the summary the item page shows.
 */
export function withoutSourceLocation(item: JellyfinItem): JellyfinItem {
  return {
    ...item,
    Path: undefined,
    MediaStreams: item.MediaStreams?.map(withoutStreamPath),
    MediaSources: item.MediaSources?.map((source) => ({
      Id: source.Id,
      Container: source.Container,
      Size: source.Size,
      Bitrate: source.Bitrate,
    })),
  };
}
