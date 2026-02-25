'use client';

import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MonitorPlay, Play, Pause, Zap, Info } from 'lucide-react';
import type { JellyfinSession } from '@/types/jellyfin';
import { ticksToMinutes, ticksToProgress, getSessionTitle } from '@/lib/jellyfin-helpers';
import { isProtectedApiImageSrc } from '@/lib/image';

interface SessionCardProps {
  session: JellyfinSession;
  variant: 'full' | 'compact';
  onInfoClick?: (session: JellyfinSession) => void;
}

export function SessionCard({ session, variant, onInfoClick }: SessionCardProps) {
  const item = session.NowPlayingItem;
  const playState = session.PlayState;
  const progress = item?.RunTimeTicks && playState?.PositionTicks
    ? ticksToProgress(playState.PositionTicks, item.RunTimeTicks)
    : 0;
  const ti = session.TranscodingInfo;
  const isTranscoding = Boolean(ti && !ti.IsVideoDirect);
  const isHW = Boolean(ti?.HardwareAccelerationType?.trim());
  const imageId = item?.Type === 'Episode' && item?.SeriesId ? item.SeriesId : item?.Id;
  const backdropSrc = imageId
    ? `/api/jellyfin/image?itemId=${item?.Type === 'Episode' && item?.SeriesId ? item.SeriesId : item?.Id}&type=Backdrop&maxWidth=520&quality=80`
    : '';
  const primarySrc = imageId
    ? `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=520&quality=80`
    : '';

  const isFull = variant === 'full';
  const cardWidth = isFull ? 'w-[280px]' : 'w-[260px]';
  const backdropHeight = isFull ? 'h-24' : 'h-20';
  const imgSizes = isFull ? '280px' : '260px';

  return (
    <div className={`snap-start shrink-0 ${cardWidth} rounded-xl bg-card overflow-hidden`}>
      {/* Backdrop area */}
      <div className={`relative ${backdropHeight} bg-muted overflow-hidden`}>
        {item?.BackdropImageTags?.[0] && item.Id ? (
          <Image src={backdropSrc} alt="" fill sizes={imgSizes} className="object-cover" unoptimized={isProtectedApiImageSrc(backdropSrc)} />
        ) : imageId && item?.ImageTags?.Primary ? (
          <Image src={primarySrc} alt="" fill sizes={imgSizes} className="object-cover blur-sm scale-110" unoptimized={isProtectedApiImageSrc(primarySrc)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <MonitorPlay className="h-6 w-6 text-muted-foreground/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-1.5">
          <div className="flex items-center gap-1.5">
            {playState?.IsPaused
              ? <Pause className="h-3 w-3 text-amber-400 shrink-0" />
              : <Play className="h-3 w-3 text-green-400 shrink-0" />
            }
            <span className="text-[13px] font-semibold truncate text-foreground">
              {item ? getSessionTitle(item) : 'Unknown'}
            </span>
          </div>
        </div>
      </div>
      {/* Bottom detail strip */}
      <div className="px-3 pt-1 pb-2.5 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="truncate">{session.UserName} &middot; {session.DeviceName}</span>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {isTranscoding ? (
              <Badge
                variant="outline"
                className={`text-[9px] px-2 py-0 flex items-center h-5 ${isHW ? 'text-amber-500 border-amber-500/30' : 'text-orange-500 border-orange-500/30'}`}
              >
                <Zap className=" w-2 mr-0.5" />
                <p className='pt-0.5'>
                  {isHW ? 'HW' : 'Transcode'}
                </p>
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] px-2 py-0 h-5 flex items-center text-green-500 border-green-500/30">
                <p className='pt-0.5'>
                  Direct
                </p>
              </Badge>
            )}
            {onInfoClick && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onInfoClick(session); }}
                className="p-0.5 rounded-md hover:bg-muted/50 active:bg-muted transition-colors"
                aria-label="Stream info"
              >
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        {isFull && ti && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            {ti.VideoCodec && <span>Video: {ti.VideoCodec}</span>}
            {ti.AudioCodec && <span>&middot; Audio: {ti.AudioCodec}</span>}
          </div>
        )}
        {isFull && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            <span>{session.Client}</span>
            {session.ApplicationVersion && <span>v{session.ApplicationVersion}</span>}
          </div>
        )}
        {item?.RunTimeTicks && (
          <div className="flex items-center gap-2">
            <Progress value={progress} className="h-[3px] flex-1" />
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              {playState?.PositionTicks ? ticksToMinutes(playState.PositionTicks) : '0m'}/{ticksToMinutes(item.RunTimeTicks)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
