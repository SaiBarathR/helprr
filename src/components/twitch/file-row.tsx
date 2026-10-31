'use client';

import { Tv } from 'lucide-react';
import { differenceInCalendarDays, formatDistanceToNowStrict } from 'date-fns';
import Link from '@/components/ui/app-link';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Badge } from '@/components/ui/badge';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { SwipeRow } from '@/components/ui/swipe-row';
import { formatBytes } from '@/lib/format';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import { ActionsMenu } from './actions-menu';
import { codecLabel, jobLabel, savedPercent, type DeletedFile, DELETION_CAUSES, type TwitchFile } from './file-types';
import { formatDuration } from './types';
import type { FileActions } from './use-file-actions';

const BADGE = 'shrink-0 px-1.5 py-0 text-[10px]';
const GOOD = 'bg-green-500/15 text-green-400';
const WARN = 'bg-amber-500/15 text-amber-400';
const ACTIVE = 'bg-primary/15 text-primary';

function keptFor(deleteAfter: string | null): string {
  if (!deleteAfter) return 'Original kept';
  const days = differenceInCalendarDays(new Date(deleteAfter), new Date());
  return days > 0 ? `Original kept ${days}d` : 'Original goes today';
}

export function FileBadges({ file, cleanupDue }: { file: TwitchFile; cleanupDue?: boolean }) {
  const percent = savedPercent(file);
  return (
    <>
      {file.activeJob && <Badge variant="secondary" className={cn(BADGE, ACTIVE)}>{jobLabel(file.activeJob)}</Badge>}
      {file.reencodedAt ? (
        <Badge variant="secondary" className={cn(BADGE, GOOD)}>{percent === null ? 'Re-encoded' : `Saved ${percent}%`}</Badge>
      ) : file.reencodeSkippedAt ? (
        <Badge variant="secondary" className={BADGE}>Not worth re-encoding</Badge>
      ) : file.activeJob?.kind !== 'REENCODE' && file.videoCodec !== 'hevc' && (
        <Badge variant="secondary" className={BADGE}>Not re-encoded</Badge>
      )}
      {file.originalKept && <Badge variant="secondary" className={cn(BADGE, WARN)}>{keptFor(file.originalDeleteAfter)}</Badge>}
      {file.keepForever && <Badge variant="secondary" className={cn(BADGE, ACTIVE)}>Keep forever</Badge>}
      {cleanupDue && <Badge variant="secondary" className={cn(BADGE, WARN)}>Cleanup due</Badge>}
      {file.watchedAt && <Badge variant="secondary" className={BADGE}>Watched</Badge>}
      {!file.jellyfinItemId && <Badge variant="secondary" className={cn(BADGE, WARN)}>Not in Jellyfin</Badge>}
    </>
  );
}

export function FileRow({ file, actions, cleanupDue }: { file: TwitchFile; actions: FileActions; cleanupDue?: boolean }) {
  const thumbnail = toCachedImageSrc(file.thumbnailUrl, undefined, { width: 320 });
  const groups = actions.groupsFor(file);
  const meta = [file.streamer.displayName, formatBytes(file.sizeBytes), file.height ? `${file.height}p` : null, codecLabel(file.videoCodec)]
    .filter(Boolean).join(' · ');
  return (
    <SwipeRow contentClassName="bg-card" {...actions.swipeFor(file)}>
      <div className="flex items-center">
        <QuickContextMenu label={`${file.title} actions`} groups={groups}>
          <Link href={`/twitch/library/${file.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 active:bg-foreground/5">
            <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-36">
              {thumbnail ? (
                <FadeInImage src={thumbnail} alt="" fill sizes="144px" className="object-cover" unoptimized />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Tv className="h-5 w-5" /></span>
              )}
              <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium leading-none tabular-nums text-white">
                {formatDuration(file.durationSeconds)}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium leading-snug">{file.title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{meta}</span>
              <span className="mt-1 flex flex-wrap gap-1"><FileBadges file={file} cleanupDue={cleanupDue} /></span>
            </span>
          </Link>
        </QuickContextMenu>
        <ActionsMenu
          label={`Actions for ${file.title}`}
          groups={groups}
          className="flex h-11 w-9 shrink-0 items-center justify-center text-muted-foreground"
        />
      </div>
    </SwipeRow>
  );
}

export function DeletedRow({ row }: { row: DeletedFile }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{row.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {row.streamer} · {formatDistanceToNowStrict(new Date(row.createdAt), { addSuffix: true })}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          <Badge variant="secondary" className={BADGE}>{row.kind === 'ORIGINAL' ? 'Original' : 'Video'}</Badge>
          <Badge variant="secondary" className={BADGE}>
            {row.detail ? `Rule: ${row.detail}` : row.deletedBy ? `${DELETION_CAUSES[row.cause]}, ${row.deletedBy}` : DELETION_CAUSES[row.cause]}
          </Badge>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-medium tabular-nums">{row.freedBytes > 0 ? formatBytes(row.freedBytes) : '—'}</span>
        <span className="block text-[10px] text-muted-foreground">freed</span>
      </span>
    </>
  );
  const className = 'flex items-center gap-3 px-3 py-2.5';
  return row.videoId
    ? <Link href={`/twitch/vod/${row.videoId}`} className={cn(className, 'active:bg-foreground/5')}>{body}</Link>
    : <div className={className}>{body}</div>;
}
