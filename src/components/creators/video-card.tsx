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
import { CreatorAvatar } from './creator-avatar';
import { daysUntil, formatDuration, type CreatorVideoItem } from './types';
import type { VideoActions } from './use-video-actions';
import { useCreatorPlatform, type CreatorPlatform } from './platform';

export interface VideoSelection {
  selected: boolean;
  onToggle: () => void;
}

const IMAGE_CHIP = 'rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium leading-none text-white';
const VIEWS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function expiryLabel(iso: string | null): { text: string; urgent: boolean } | null {
  const days = daysUntil(iso);
  if (days === null || days > 7 || days < 0) return null;
  return { text: days <= 0 ? 'Today' : `${days}d left`, urgent: days <= 3 };
}

function Thumbnail({ video, sizes, className }: { video: CreatorVideoItem; sizes: string; className?: string }) {
  const src = toCachedImageSrc(video.thumbnailUrl, undefined, { width: 640 });
  const expiry = expiryLabel(video.estimatedExpiresAt);
  const muted = (video.mutedSegments?.length ?? 0) > 0;
  const recording = video.availability === 'RECORDING';
  const platform = useCreatorPlatform();
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
          {recording && <span className={cn(IMAGE_CHIP, 'text-red-300')}>{platform.recordingLabel}</span>}
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

function metaLine(video: CreatorVideoItem, showStreamer: boolean, platform: CreatorPlatform): string {
  const age = formatDistanceToNowStrict(new Date(video.sourceCreatedAt), { addSuffix: true });
  return [
    platform.cardTypeLabel(video.type),
    showStreamer ? video.creator.displayName : null,
    video.viewCount > 0 ? `${VIEWS.format(video.viewCount)} views` : null,
    age,
  ].filter(Boolean).join(' · ');
}

function VideoTile({ video, showStreamer, actions, selection, onSelect }: CardProps) {
  const platform = useCreatorPlatform();
  // The YouTube layout: the channel's avatar beside the title, wherever the
  // channel is not already named by the page or row around the card.
  const text = (
    <span className="mt-2.5 flex gap-3">
      {showStreamer && <CreatorAvatar url={video.creator.profileImageUrl} size={36} />}
      <span className="min-w-0 flex-1 pr-6">
        <span className="line-clamp-2 text-sm font-medium leading-snug sm:text-[15px]">{video.title}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{metaLine(video, showStreamer, platform)}</span>
      </span>
    </span>
  );
  const sizes = '(max-width: 500px) 100vw, (max-width: 1280px) 50vw, 33vw';

  if (selection) {
    return (
      <button
        type="button"
        aria-pressed={selection.selected}
        aria-label={`${selection.selected ? 'Deselect' : 'Select'} ${video.title}`}
        onClick={selection.onToggle}
        className="relative block w-full min-w-0 rounded-xl text-left"
      >
        <Thumbnail
          video={video}
          sizes={sizes}
          className={cn('rounded-xl shadow-sm', selection.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
        />
        <SelectionCheck selected={selection.selected} className="absolute left-1.5 top-1.5 z-10" />
        {text}
      </button>
    );
  }

  const groups = actions.groupsFor(video, onSelect);
  return (
    <div className="group relative min-w-0">
      <QuickContextMenu label={`${video.title} actions`} groups={groups}>
        <Link href={`${platform.videoPath}/${video.id}`} className="press-feedback block">
          <Thumbnail video={video} sizes={sizes} className="rounded-xl shadow-sm" />
          {text}
        </Link>
      </QuickContextMenu>
      {/* A box the thumbnail's size, so the menu sits beside the title whatever the card's width. */}
      <span className="pointer-events-none absolute inset-x-0 top-0 aspect-video">
        <ActionsMenu
          label={`Actions for ${video.title}`}
          groups={groups}
          className="touch-target pointer-events-auto absolute -right-1.5 top-full mt-1.5 flex h-7 w-7 items-center justify-center text-muted-foreground"
        />
      </span>
    </div>
  );
}

function VideoRow({ video, showStreamer, actions, selection, onSelect }: CardProps) {
  const platform = useCreatorPlatform();
  const body = (
    <>
      <Thumbnail video={video} sizes="160px" className="w-32 shrink-0 rounded-lg sm:w-40" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{video.title}</span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">{metaLine(video, showStreamer, platform)}</span>
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
          <Link href={`${platform.videoPath}/${video.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 active:bg-foreground/5">
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
  video: CreatorVideoItem;
  showStreamer: boolean;
  actions: VideoActions;
  selection?: VideoSelection;
  /** Offered in the long-press menu: starts selecting with this video. */
  onSelect?: () => void;
}

export function CreatorVideoCard({ layout, showStreamer = true, ...props }: Omit<CardProps, 'showStreamer'> & {
  layout: 'grid' | 'list';
  showStreamer?: boolean;
}) {
  const Card = layout === 'list' ? VideoRow : VideoTile;
  return <Card showStreamer={showStreamer} {...props} />;
}
