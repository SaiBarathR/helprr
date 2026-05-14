'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { VideoPlayerDialog, type PlayableVideo } from '@/components/media/video-player-dialog';
import { extractYouTubeVideosFromExternalLinks } from '@/lib/anilist-helpers';
import type { AniListExternalLink, AniListTrailer } from '@/types/anilist';

interface AnimeTrailerRailProps {
  trailer: AniListTrailer | null;
  externalLinks: AniListExternalLink[];
  title: string;
}

export function AnimeTrailerRail({ trailer, externalLinks, title }: AnimeTrailerRailProps) {
  const [dialogState, setDialogState] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });

  const videos = useMemo<PlayableVideo[]>(() => {
    const list: PlayableVideo[] = [];
    const seen = new Set<string>();
    if (trailer?.id && (trailer.site === 'youtube' || trailer.site === 'dailymotion')) {
      const site = trailer.site;
      list.push({
        id: `${site}:${trailer.id}`,
        site,
        videoKey: trailer.id,
        title,
        type: 'Trailer',
      });
      if (site === 'youtube') seen.add(trailer.id);
    }
    for (const v of extractYouTubeVideosFromExternalLinks(externalLinks)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      list.push({
        id: `youtube:${v.id}`,
        site: 'youtube',
        videoKey: v.id,
        title,
        type: 'Video',
      });
    }
    return list;
  }, [trailer, externalLinks, title]);

  if (!videos.length) return null;

  return (
    <div>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide animate-rail-in">
        {videos.map((video, idx) => {
          const thumbnail = video.site === 'youtube'
            ? `https://img.youtube.com/vi/${video.videoKey}/mqdefault.jpg`
            : (idx === 0 && trailer?.thumbnail) || null;
          return (
            <button
              key={video.id}
              type="button"
              onClick={() => setDialogState({ open: true, index: idx })}
              className="group shrink-0 w-[220px] sm:w-[260px] text-left"
            >
              <div className="relative aspect-video rounded-lg overflow-hidden bg-muted border border-border/40">
                {thumbnail && (
                  <Image
                    src={thumbnail}
                    alt={video.title || 'Video'}
                    fill
                    sizes="260px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized
                  />
                )}
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                    <Play className="h-5 w-5 text-black fill-black ml-0.5" />
                  </div>
                </div>
              </div>
              <p className="text-[11px] font-medium mt-1.5 line-clamp-1 leading-tight">{video.title}</p>
              <p className="text-[10px] text-muted-foreground">{video.type}</p>
            </button>
          );
        })}
      </div>
      <VideoPlayerDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState((s) => ({ ...s, open }))}
        videos={videos}
        initialIndex={dialogState.index}
      />
    </div>
  );
}
