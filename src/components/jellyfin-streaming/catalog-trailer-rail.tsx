'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Play } from 'lucide-react';
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
    <section className="space-y-2">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="animate-rail-in flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-[var(--main-pad-x)] px-[var(--main-pad-x)]">
        {playable.map((video, index) => (
          <button
            key={video.id}
            type="button"
            onClick={() => setDialog({ open: true, index })}
            className="group w-[220px] shrink-0 text-left sm:w-[260px]"
          >
            <div className="relative aspect-video overflow-hidden rounded-xl border border-border/40 bg-muted/60">
              <Image
                src={`https://img.youtube.com/vi/${video.videoKey}/mqdefault.jpg`}
                alt={video.title || 'Trailer'}
                fill
                sizes="260px"
                unoptimized
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-background/25 transition-colors group-hover:bg-background/40">
                <span className="flex size-10 items-center justify-center rounded-full border border-border/50 bg-background/70 backdrop-blur">
                  <Play className="ml-0.5 size-5 fill-current" />
                </span>
              </span>
            </div>
            {video.title && <p className="mt-1.5 line-clamp-1 text-[11px] font-medium">{video.title}</p>}
          </button>
        ))}
      </div>
      <VideoPlayerDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        videos={playable}
        initialIndex={dialog.index}
      />
    </section>
  );
}
