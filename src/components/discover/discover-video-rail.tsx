'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { VideoPlayerDialog, type PlayableVideo } from '@/components/media/video-player-dialog';
import type { DiscoverVideo } from '@/types';

interface DiscoverVideoRailProps {
  title: string;
  videos: DiscoverVideo[];
}

export function DiscoverVideoRail({ title, videos }: DiscoverVideoRailProps) {
  const [dialogState, setDialogState] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });

  const playable = useMemo<PlayableVideo[]>(() => {
    return videos
      .filter((v) => v.site === 'YouTube')
      .map((v) => ({
        id: v.id,
        site: 'youtube' as const,
        videoKey: v.key,
        title: v.name,
        type: v.type,
      }));
  }, [videos]);

  if (!playable.length) return null;

  return (
    <div>
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide animate-rail-in">
        {playable.map((video, idx) => {
          const thumbnailUrl = `https://img.youtube.com/vi/${video.videoKey}/mqdefault.jpg`;

          return (
            <button
              key={video.id}
              type="button"
              onClick={() => setDialogState({ open: true, index: idx })}
              className="group shrink-0 w-[220px] sm:w-[260px] text-left"
            >
              <div className="relative aspect-video rounded-lg overflow-hidden bg-muted border border-border/40">
                <Image
                  src={thumbnailUrl}
                  alt={video.title || 'Video'}
                  fill
                  sizes="260px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  unoptimized
                />
                <div className="absolute inset-0 bg-background/30 flex items-center justify-center group-hover:bg-background/40 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-foreground/90 flex items-center justify-center">
                    <Play className="h-5 w-5 text-background fill-background ml-0.5" />
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
        videos={playable}
        initialIndex={dialogState.index}
      />
    </div>
  );
}
