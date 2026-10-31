'use client';

import { Tv, VolumeX } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import Link from '@/components/ui/app-link';
import { FadeInImage } from '@/components/media/fade-in-image';
import { SelectionCheck } from '@/components/media/selection-check';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { SwipeRow } from '@/components/ui/swipe-row';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import { ActionsMenu } from './actions-menu';
import { daysUntil, formatDuration, VIDEO_TYPE_LABELS, type TwitchVideo } from './types';
import type { VideoActions } from './use-video-actions';

export interface VideoSelection {
  selected: boolean;
  onToggle: () => void;
}

const IMAGE_CHIP = 'rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium leading-none text-white';

function expiryLabel(iso: string | null): { text: string; urgent: boolean } | null {
  const days = daysUntil(iso);
  if (days === null || days > 7 || days < 0) return null;
  return { text: days <= 0 ? 'Today' : `${days}d left`, urgent: days <= 3 };
}

function Thumbnail({ video, sizes, className }: { video: TwitchVideo; sizes: string; className?: string }) {
  const src = toCachedImageSrc(video.thumbnailUrl, undefined, { width: 640 });
  const expiry = expiryLabel(video.estimatedExpiresAt);
  const muted = (video.mutedSegments?.length ?? 0) > 0;
  const recording = video.availability === 'RECORDING';
  return (
    <span className={cn('relative block aspect-video overflow-hidden bg-muted', className)}>
      {src ? (
        <FadeInImage src={src} alt="" fill sizes={sizes} className="object-cover" unoptimized />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Tv className="h-6 w-6" /></span>
      )}
      <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/50 to-transparent" />
      {(recording || expiry || muted) && (
        <span className="absolute right-1 top-1 flex items-center gap-1">
          {muted && <span aria-label="Some audio is muted" className={IMAGE_CHIP}><VolumeX className="h-2.5 w-2.5" /></span>}
          {recording && <span className={cn(IMAGE_CHIP, 'text-red-300')}>Recording</span>}
          {expiry && <span className={cn(IMAGE_CHIP, expiry.urgent ? 'text-red-300' : 'text-amber-300')}>{expiry.text}</span>}
        </span>
      )}
      {video.downloaded && (
        <span aria-label="Downloaded" className="absolute bottom-1.5 left-1.5 h-2 w-2 rounded-full bg-green-500" />
      )}
      <span className={cn(IMAGE_CHIP, 'absolute bottom-1 right-1 tabular-nums')}>{formatDuration(video.durationSeconds)}</span>
      {video.activeJob && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/25">
          <span className="block h-full bg-primary" style={{ width: `${Math.round((video.activeJob.progress ?? 0) * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

function metaLine(video: TwitchVideo, showStreamer: boolean): string {
  const age = formatDistanceToNowStrict(new Date(video.twitchCreatedAt), { addSuffix: true });
  return [
    video.type === 'ARCHIVE' ? null : VIDEO_TYPE_LABELS[video.type],
    showStreamer ? video.streamer.displayName : null,
    age,
  ].filter(Boolean).join(' · ');
}

function VideoTile({ video, showStreamer, actions, selection, onSelect }: CardProps) {
  const title = <span className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug">{video.title}</span>;
  const meta = <span className="mt-0.5 block truncate pr-6 text-[11px] text-muted-foreground">{metaLine(video, showStreamer)}</span>;
  const sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw';

  if (selection) {
    return (
      <div className="group relative min-w-0">
        <button
          type="button"
          aria-pressed={selection.selected}
          aria-label={`${selection.selected ? 'Deselect' : 'Select'} ${video.title}`}
          onClick={selection.onToggle}
          className="block w-full rounded-xl text-left"
        >
          <Thumbnail
            video={video}
            sizes={sizes}
            className={cn('rounded-xl shadow-sm', selection.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
          />
          {title}
          {meta}
        </button>
        <div className="absolute left-1.5 top-1.5 z-10"><SelectionCheck selected={selection.selected} /></div>
      </div>
    );
  }

  const groups = actions.groupsFor(video, onSelect);
  return (
    <div className="group relative min-w-0">
      <QuickContextMenu label={`${video.title} actions`} groups={groups}>
        <Link href={`/twitch/vod/${video.id}`} className="press-feedback block">
          <Thumbnail video={video} sizes={sizes} className="rounded-xl shadow-sm" />
          {title}
          {meta}
        </Link>
      </QuickContextMenu>
      <ActionsMenu
        label={`Actions for ${video.title}`}
        groups={groups}
        className="touch-target absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center text-muted-foreground"
      />
    </div>
  );
}

function VideoRow({ video, showStreamer, actions, selection, onSelect }: CardProps) {
  const body = (
    <>
      <Thumbnail video={video} sizes="160px" className="w-32 shrink-0 rounded-lg sm:w-40" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{video.title}</span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">{metaLine(video, showStreamer)}</span>
      </span>
    </>
  );

  if (selection) {
    return (
      <button
        type="button"
        aria-pressed={selection.selected}
        aria-label={`${selection.selected ? 'Deselect' : 'Select'} ${video.title}`}
        onClick={selection.onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-foreground/5"
      >
        <SelectionCheck selected={selection.selected} className="shrink-0" />
        {body}
      </button>
    );
  }

  const groups = actions.groupsFor(video, onSelect);
  return (
    <SwipeRow contentClassName="bg-card" {...actions.swipeFor(video)}>
      <div className="flex items-center">
        <QuickContextMenu label={`${video.title} actions`} groups={groups}>
          <Link href={`/twitch/vod/${video.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 active:bg-foreground/5">
            {body}
          </Link>
        </QuickContextMenu>
        <ActionsMenu
          label={`Actions for ${video.title}`}
          groups={groups}
          className="flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground"
        />
      </div>
    </SwipeRow>
  );
}

interface CardProps {
  video: TwitchVideo;
  showStreamer: boolean;
  actions: VideoActions;
  selection?: VideoSelection;
  /** Offered in the long-press menu: starts selecting with this video. */
  onSelect?: () => void;
}

export function TwitchVideoCard({ layout, showStreamer = true, ...props }: Omit<CardProps, 'showStreamer'> & {
  layout: 'grid' | 'list';
  showStreamer?: boolean;
}) {
  const Card = layout === 'list' ? VideoRow : VideoTile;
  return <Card showStreamer={showStreamer} {...props} />;
}
