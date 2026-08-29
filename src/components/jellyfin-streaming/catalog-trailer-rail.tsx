'use client';

import { useMemo, useState } from 'react';
import { MediaRail } from '@/components/jellyfin-streaming/media-rail';
import { MediaTile } from '@/components/jellyfin-streaming/media-tile';
import { VideoPlayerDialog, type PlayableVideo } from '@/components/media/video-player-dialog';

/** Jellyfin stores remote trailers as bare URLs, so the key has to be parsed out. */
function toPlayable(trailer: { Name?: string; Url?: string }, index: number): PlayableVideo | null {
  if (!trailer.Url) return null;
  let url: URL;
  try {
    url = new URL(trailer.Url);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const key = url.searchParams.get('v') ?? url.pathname.split('/').filter(Boolean).pop();
    return key ? { id: `${key}-${index}`, site: 'youtube', videoKey: key, title: trailer.Name } : null;
  }
  if (host === 'youtu.be') {
    const key = url.pathname.slice(1);
    return key ? { id: `${key}-${index}`, site: 'youtube', videoKey: key, title: trailer.Name } : null;
  }
  if (host === 'dailymotion.com') {
    const key = url.pathname.split('/').filter(Boolean).pop();
    return key ? { id: `${key}-${index}`, site: 'dailymotion', videoKey: key, title: trailer.Name } : null;
  }
  return null;
}

/**
 * Trailers as playable thumbnails in Helprr's own dialog, matching the movie
 * and series pages — they used to be a list of blue "Trailer" text links that
 * navigated away.
 */
export function CatalogTrailerRail({
  trailers,
  title = 'Trailers',
}: {
  trailers: Array<{ Name?: string; Url?: string }>;
  title?: string;
}) {
  const [dialog, setDialog] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });
  const playable = useMemo(
    () => trailers.map(toPlayable).filter((video): video is PlayableVideo => video !== null),
    [trailers],
  );

  if (playable.length === 0) return null;

  return (
    <>
      <MediaRail title={title} count={playable.length}>
        {playable.map((video, index) => (
          <MediaTile
            key={video.id}
            shape="landscape"
            title={video.title || 'Trailer'}
            imageUrl={`https://img.youtube.com/vi/${video.videoKey}/mqdefault.jpg`}
            onActivate={() => setDialog({ open: true, index })}
            playAffordance
          />
        ))}
      </MediaRail>
      <VideoPlayerDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        videos={playable}
        initialIndex={dialog.index}
      />
    </>
  );
}
