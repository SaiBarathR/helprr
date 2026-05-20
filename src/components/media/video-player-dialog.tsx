'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface PlayableVideo {
  id: string;
  site: 'youtube' | 'dailymotion';
  videoKey: string;
  title?: string;
  type?: string;
}

interface VideoPlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videos: PlayableVideo[];
  initialIndex: number;
}

function buildEmbedUrl(video: PlayableVideo): string {
  if (video.site === 'youtube') {
    return `https://www.youtube.com/embed/${video.videoKey}?autoplay=1&rel=0`;
  }
  return `https://www.dailymotion.com/embed/video/${video.videoKey}?autoplay=1`;
}

function buildExternalUrl(video: PlayableVideo): string {
  if (video.site === 'youtube') {
    return `https://www.youtube.com/watch?v=${video.videoKey}`;
  }
  return `https://www.dailymotion.com/video/${video.videoKey}`;
}

export function VideoPlayerDialog({ open, onOpenChange, videos, initialIndex }: VideoPlayerDialogProps) {
  const [index, setIndex] = useState(initialIndex);
  const [prevInitialIndex, setPrevInitialIndex] = useState(initialIndex);
  if (initialIndex !== prevInitialIndex) {
    setPrevInitialIndex(initialIndex);
    setIndex(initialIndex);
  }

  if (!videos.length) return null;

  const safeIndex = Math.min(Math.max(index, 0), videos.length - 1);
  const video = videos[safeIndex];
  const hasMultiple = videos.length > 1;
  const externalLabel = video.site === 'youtube' ? 'Open in YouTube' : 'Open on DailyMotion';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="w-[95dvw] max-w-[95dvw] sm:max-w-3xl max-h-[95dvh] p-0 gap-0 overflow-hidden flex flex-col"
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-4 pt-4 pb-3 pr-12">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold line-clamp-2">
              {video.title || 'Video'}
            </DialogTitle>
            {video.type && (
              <DialogDescription asChild>
                <div className="mt-1">
                  <Badge variant="secondary" className="text-[10px]">{video.type}</Badge>
                </div>
              </DialogDescription>
            )}
          </div>
        </div>

        <div className="relative bg-background w-full aspect-video shrink-0 mx-auto max-w-[calc((95dvh-9rem)*16/9)]">
          {open && (
            <iframe
              key={video.id}
              src={buildEmbedUrl(video)}
              title={video.title || 'Video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 w-full h-full"
            />
          )}
          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={safeIndex === 0}
                aria-label="Previous video"
                className={cn(
                  'absolute left-2 top-1/2 -translate-y-1/2 z-10 size-9 rounded-full bg-background/60 text-foreground flex items-center justify-center transition-opacity',
                  safeIndex === 0 ? 'opacity-30 pointer-events-none' : 'hover:bg-background/80'
                )}
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(videos.length - 1, i + 1))}
                disabled={safeIndex === videos.length - 1}
                aria-label="Next video"
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 z-10 size-9 rounded-full bg-background/60 text-foreground flex items-center justify-center transition-opacity',
                  safeIndex === videos.length - 1 ? 'opacity-30 pointer-events-none' : 'hover:bg-background/80'
                )}
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t">
          <span className="text-[11px] text-muted-foreground">
            {hasMultiple ? `${safeIndex + 1} / ${videos.length}` : ''}
          </span>
          <Button asChild variant="outline" size="sm">
            <a href={buildExternalUrl(video)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              {externalLabel}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
