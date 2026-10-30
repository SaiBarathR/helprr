'use client';

import Link from '@/components/ui/app-link';
import { Check, Download, ExternalLink, Eye, EyeOff, MoreVertical, Tv, VolumeX, Zap } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { FadeInImage } from '@/components/media/fade-in-image';
import { SelectionCheck } from '@/components/media/selection-check';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import { daysUntil, formatDuration, VIDEO_TYPE_LABELS, type TwitchVideo } from './types';
import type { VideoActions } from './use-video-actions';

function ExpiryPill({ iso }: { iso: string | null }) {
  const days = daysUntil(iso);
  if (days === null || days > 7 || days < 0) return null;
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold text-white', days <= 3 ? 'bg-red-500/90' : 'bg-orange-500/90')}>
      {days <= 0 ? 'Today' : `${days}d left`}
    </span>
  );
}

function Thumbnail({ video }: { video: TwitchVideo }) {
  const src = toCachedImageSrc(video.thumbnailUrl, undefined, { width: 640 });
  const progress = video.activeJob?.progress;
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
      {src ? (
        <FadeInImage src={src} alt="" fill sizes="(max-width: 640px) 100vw, 360px" className="object-cover transition-transform group-hover:scale-105" unoptimized />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground"><Tv className="h-8 w-8" /></div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {video.availability === 'RECORDING' ? 'Recording' : VIDEO_TYPE_LABELS[video.type]}
      </span>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
        {(video.mutedSegments?.length ?? 0) > 0 && (
          <span aria-label="Some audio is muted" className="flex h-5 w-5 items-center justify-center rounded bg-black/55 text-white"><VolumeX className="h-3 w-3" /></span>
        )}
        <ExpiryPill iso={video.estimatedExpiresAt} />
      </div>
      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">
        {formatDuration(video.durationSeconds)}
      </span>
      {video.downloaded && (
        <span aria-label="In Jellyfin" className="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="h-3 w-3" />
        </span>
      )}
      {video.activeJob && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
          <div className="h-full bg-primary" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function CardMenu({ video, actions }: { video: TwitchVideo; actions: VideoActions }) {
  const canDownload = !video.downloaded && !video.activeJob && video.availability === 'PUBLISHED';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${video.title}`}
        className="-mr-2 flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canDownload && <DropdownMenuItem onSelect={() => actions.openSheet(video)}><Download />Download…</DropdownMenuItem>}
        {canDownload && <DropdownMenuItem onSelect={() => actions.quickDownload(video)}><Zap />Quick download</DropdownMenuItem>}
        {!video.seen && <DropdownMenuItem onSelect={() => actions.markSeen(video)}><Eye />Mark seen</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => actions.hide(video)}><EyeOff />Hide</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`https://www.twitch.tv/videos/${video.twitchVideoId}`} target="_blank" rel="noopener noreferrer"><ExternalLink />Open on Twitch</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TwitchVideoCard({ video, layout, showStreamer = true, actions, selection }: {
  video: TwitchVideo;
  layout: 'grid' | 'list';
  showStreamer?: boolean;
  actions?: VideoActions;
  selection?: { selected: boolean; onToggle: () => void };
}) {
  const avatar = toCachedImageSrc(video.streamer.profileImageUrl, undefined, { width: 72 });
  const age = formatDistanceToNowStrict(new Date(video.twitchCreatedAt), { addSuffix: true });
  const meta = [showStreamer ? video.streamer.displayName : null, age, video.category].filter(Boolean).join(' · ');
  const wrapper = cn('group press-feedback block min-w-0', layout === 'list' && 'grid grid-cols-[9rem_1fr] gap-3 sm:grid-cols-[14rem_1fr]');
  const body = (
    <>
      <div className="relative">
        <Thumbnail video={video} />
        {selection && <SelectionCheck selected={selection.selected} className="absolute left-1.5 top-8" />}
      </div>
      <div className={cn('flex min-w-0 gap-2.5', layout === 'grid' && 'mt-2')}>
        {showStreamer && layout === 'grid' && (
          <span className="relative mt-0.5 block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
            {avatar && <FadeInImage src={avatar} alt="" fill sizes="32px" className="object-cover" unoptimized />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{video.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>
    </>
  );

  if (selection) {
    return (
      <button type="button" aria-pressed={selection.selected} onClick={selection.onToggle} className={cn(wrapper, 'w-full text-left')}>
        {body}
      </button>
    );
  }
  return (
    <div className="relative">
      <Link href={`/twitch/vod/${video.id}`} className={cn(wrapper, actions && 'pr-7')}>{body}</Link>
      {actions && <div className="absolute bottom-0 right-0"><CardMenu video={video} actions={actions} /></div>}
    </div>
  );
}
