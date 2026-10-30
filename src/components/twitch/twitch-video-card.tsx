'use client';

import Link from '@/components/ui/app-link';
import { Check, Tv, VolumeX } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { FadeInImage } from '@/components/media/fade-in-image';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import { daysUntil, formatDuration, VIDEO_TYPE_LABELS, type TwitchVideo } from './types';

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

export function TwitchVideoCard({ video, layout, showStreamer = true }: {
  video: TwitchVideo;
  layout: 'grid' | 'list';
  showStreamer?: boolean;
}) {
  const avatar = toCachedImageSrc(video.streamer.profileImageUrl, undefined, { width: 72 });
  const age = formatDistanceToNowStrict(new Date(video.twitchCreatedAt), { addSuffix: true });
  return (
    <Link
      href={`/twitch/vod/${video.id}`}
      className={cn('group press-feedback block min-w-0', layout === 'list' && 'grid grid-cols-[9rem_1fr] gap-3 sm:grid-cols-[14rem_1fr]')}
    >
      <Thumbnail video={video} />
      <div className={cn('flex min-w-0 gap-2.5', layout === 'grid' && 'mt-2')}>
        {showStreamer && layout === 'grid' && (
          <span className="relative mt-0.5 block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
            {avatar && <FadeInImage src={avatar} alt="" fill sizes="32px" className="object-cover" unoptimized />}
          </span>
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{video.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {showStreamer ? `${video.streamer.displayName} · ` : ''}{age}
          </p>
        </div>
      </div>
    </Link>
  );
}
