'use client';

import { use, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clock, Download, ExternalLink, HardDrive, Loader2, Moon, MoreHorizontal, Play, RotateCcw, Trash2, Tv, Zap } from 'lucide-react';
import { differenceInCalendarDays, format, formatDistanceStrict } from 'date-fns';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { FadeInImage } from '@/components/media/fade-in-image';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionsMenu } from '@/components/twitch/actions-menu';
import { FileBadges } from '@/components/twitch/file-row';
import {
  bitrateLabel,
  codecLabel,
  DELETION_CAUSES,
  savedBytes,
  savedPercent,
  type TimelineDeletion,
  type TimelineJob,
  type TwitchFileDetail,
} from '@/components/twitch/file-types';
import { SwitchRow } from '@/components/twitch/setting-rows';
import { formatDuration } from '@/components/twitch/types';
import { useFileActions } from '@/components/twitch/use-file-actions';
import { formatBytes } from '@/lib/format';
import { toCachedImageSrc } from '@/lib/image';
import { ApiError } from '@/lib/query-fetch';
import { cn } from '@/lib/utils';

const DATE = 'PP';
const DATE_TIME = 'PP, p';

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="grouped-row gap-3">
      <span className="shrink-0 text-sm">{label}</span>
      <span className={cn('min-w-0 text-right text-sm text-muted-foreground', tone)}>{value}</span>
    </div>
  );
}

function ActionRow({ label, icon, destructive, disabled, onClick }: {
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grouped-row w-full gap-3 text-left hover:bg-foreground/[0.03] active:bg-foreground/5 disabled:opacity-50',
        destructive ? 'text-destructive' : 'text-primary',
      )}
    >
      <span className="text-sm">{label}</span>
      {icon}
    </button>
  );
}

function SizeBar({ label, value, width, className }: { label: string; value: string; width: number; className: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', className)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SavedCard({ file }: { file: TwitchFileDetail }) {
  const saved = savedBytes(file);
  const percent = savedPercent(file);
  if (saved === null || percent === null || !file.originalSizeBytes) return null;
  return (
    <section aria-label="Space saved" className="rounded-xl bg-card p-4">
      <p className="text-2xl font-semibold tabular-nums text-emerald-500">{percent}% smaller</p>
      <p className="text-sm text-muted-foreground">Saved {formatBytes(saved)}</p>
      <div className="mt-3 space-y-2">
        <SizeBar label="Original" value={formatBytes(file.originalSizeBytes)} width={100} className="bg-muted-foreground/50" />
        <SizeBar label="Now" value={formatBytes(file.sizeBytes)} width={Math.max(2, 100 - percent)} className="bg-primary" />
      </div>
    </section>
  );
}

function reencodeStatus(file: TwitchFileDetail): string {
  if (file.activeJob?.kind === 'REENCODE') return file.activeJob.state === 'RUNNING' ? 'Re-encoding now' : file.activeJob.priority > 0 ? 'Starting soon' : 'Waiting for tonight';
  if (file.reencodedAt) return `Done ${format(new Date(file.reencodedAt), DATE)}`;
  if (file.reencodeSkippedAt) return 'Tried: it saved under 10%, so the original stayed';
  if (file.videoCodec === 'hevc') return 'Not needed: already HEVC';
  return 'Not re-encoded';
}

function cleanupStatus(file: TwitchFileDetail): { text: string; tone?: string } {
  const { cleanup } = file;
  if (file.keepForever) return { text: 'Never: kept forever' };
  if (cleanup.reason) return { text: `Due: ${cleanup.reason}`, tone: 'text-amber-400' };
  if (cleanup.deleteAfter) return { text: `From ${format(new Date(cleanup.deleteAfter), DATE)}` };
  if (cleanup.keepLatest !== null) return { text: `When it is no longer one of the latest ${cleanup.keepLatest}` };
  if (cleanup.deleteAfterWatchedDays !== null) return { text: `${cleanup.deleteAfterWatchedDays} days after it is watched` };
  return { text: 'Never: no limit set' };
}

const JOB_NAMES: Record<TimelineJob['kind'], string> = {
  DOWNLOAD: 'Download',
  REENCODE: 'Re-encode',
  DELETE_FILES: 'Delete',
  DELETE_ORIGINAL: 'Delete original',
  RESTORE_ORIGINAL: 'Restore original',
};
const JOB_STATES: Record<string, string> = {
  DONE: 'finished',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RUNNING: 'running',
  QUEUED: 'queued',
  RETRY_WAIT: 'will retry',
  BLOCKED: 'waiting for disk space',
};

interface TimelineEntry {
  id: string;
  at: Date;
  title: string;
  detail: string | null;
  failed?: boolean;
}

function jobEntry(job: TimelineJob): TimelineEntry {
  const took = job.startedAt && job.finishedAt && job.state === 'DONE'
    ? formatDistanceStrict(new Date(job.startedAt), new Date(job.finishedAt))
    : null;
  const who = job.requestedByUsername ?? (job.source === 'RULE' ? 'a rule' : null);
  return {
    id: job.id,
    at: new Date(job.finishedAt ?? job.startedAt ?? job.createdAt),
    title: `${JOB_NAMES[job.kind]} ${JOB_STATES[job.state] ?? job.state.toLowerCase()}`,
    detail: [took && `took ${took}`, who && `by ${who}`].filter(Boolean).join(', ') || null,
    failed: job.state === 'FAILED',
  };
}

function deletionEntry(row: TimelineDeletion): TimelineEntry {
  return {
    id: row.id,
    at: new Date(row.createdAt),
    title: 'Original deleted',
    detail: [row.freedBytes > 0 && `freed ${formatBytes(row.freedBytes)}`, row.deletedBy ? `by ${row.deletedBy}` : DELETION_CAUSES[row.cause].toLowerCase()]
      .filter(Boolean).join(', '),
  };
}

export default function TwitchFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const actions = useFileActions();

  const query = useQuery({
    queryKey: ['twitch', 'file', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/files/${id}`, { signal });
      if (!res.ok) throw new ApiError(res.status, 'Failed to load the file');
      return (await res.json()) as TwitchFileDetail;
    },
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
    refetchInterval: (state) => (state.state.data?.activeJob ? 3_000 : false),
    refetchIntervalInBackground: false,
  });
  const file = query.data;

  if (query.isError && !file) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="animate-content-in">
        <PageHeader title="File details" backHref="/twitch/library" />
        {gone ? (
          <div className="mt-3 rounded-xl bg-card p-8 text-center text-muted-foreground">
            <p>This file has been deleted.</p>
            <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/twitch/library">Back to the library</Link></Button>
          </div>
        ) : (
          <ErrorState message="Couldn't load this file" onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }
  if (!file) {
    return (
      <>
        <PageHeader title="File details" backHref="/twitch/library" />
        <div className="space-y-3 pt-3">
          <div className="flex gap-3"><Skeleton className="aspect-video w-32 rounded-lg" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </>
    );
  }

  const thumbnail = toCachedImageSrc(file.thumbnailUrl, undefined, { width: 480 });
  const groups = actions.groupsFor(file);
  const bitrate = bitrateLabel(file.sizeBytes, file.durationSeconds);
  const originalBitrate = file.originalSizeBytes ? bitrateLabel(file.originalSizeBytes, file.durationSeconds) : null;
  const codec = file.originalVideoCodec && file.reencodedAt
    ? `${codecLabel(file.originalVideoCodec)} → ${codecLabel(file.videoCodec)}`
    : codecLabel(file.videoCodec);
  const originalDays = file.originalDeleteAfter ? differenceInCalendarDays(new Date(file.originalDeleteAfter), new Date()) : null;
  const canReencode = actions.canReencode(file);
  const running = file.activeJob?.kind === 'REENCODE' ? file.activeJob : null;
  const cleanup = cleanupStatus(file);
  const timeline = [...file.timeline.jobs.map(jobEntry), ...file.timeline.deletions.map(deletionEntry)]
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <PageHeader
        title={file.title}
        subtitle="File details"
        backHref="/twitch/library"
        rightContent={(
          <ActionsMenu
            label={`${file.title} actions`}
            groups={groups}
            className="flex h-11 w-10 items-center justify-center text-primary"
            icon={<MoreHorizontal className="h-5 w-5" />}
          />
        )}
      />
      <div className="space-y-4 pt-3 animate-content-in">
        <div className="flex gap-3">
          <span className="relative block aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-48">
            {thumbnail ? (
              <FadeInImage src={thumbnail} alt="" fill sizes="192px" className="object-cover" unoptimized />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Tv className="h-6 w-6" /></span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-3 text-base font-semibold leading-snug">{file.title}</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              <Link href={`/twitch/streamers/${file.streamer.id}`}>{file.streamer.displayName}</Link>
            </p>
            <div className="mt-1 flex flex-wrap gap-1"><FileBadges file={file} /></div>
          </div>
        </div>

        <div className="flex gap-3">
          {file.jellyfinItemId && (
            <Button asChild className="h-10 flex-1 rounded-full">
              <Link href={`/jellyfin/library/item/${file.jellyfinItemId}`}><Play className="mr-2 h-4 w-4 fill-current" />Play</Link>
            </Button>
          )}
          <Button asChild variant="secondary" className="h-10 flex-1 rounded-full">
            <Link href={`/twitch/vod/${file.videoId}`}><Tv className="mr-2 h-4 w-4" />View video</Link>
          </Button>
        </div>

        <SavedCard file={file} />

        <div className="md:grid md:grid-cols-2 md:gap-x-6">
          <div>
            <GroupedSection title="File">
              <Row label="Size" value={formatBytes(file.sizeBytes)} />
              <Row label="Codec" value={codec} />
              {file.height && <Row label="Resolution" value={`${file.height}p`} />}
              {bitrate && <Row label="Bitrate" value={originalBitrate && file.reencodedAt ? `${originalBitrate} → ${bitrate}` : bitrate} />}
              <Row label="Length" value={formatDuration(file.durationSeconds)} />
              <Row label="Streamed" value={format(new Date(file.streamedAt), DATE)} />
              <Row label="Downloaded" value={format(new Date(file.downloadedAt), DATE)} />
              <Row label="Chat" value={file.chatArchived ? 'Archived' : 'Not archived'} />
              <Row label="Jellyfin" value={file.jellyfinItemId ? 'In the library' : 'Not found yet'} tone={file.jellyfinItemId ? undefined : 'text-amber-400'} />
            </GroupedSection>

            <GroupedSection
              title="Re-encoding"
              footer={canReencode && !file.reencodeSkippedAt ? `Could save about ${formatBytes(file.sizeBytes * 0.63)} to ${formatBytes(file.sizeBytes * 0.82)}` : undefined}
            >
              <Row label="Status" value={reencodeStatus(file)} />
              {running?.progress != null && <Row label="Progress" value={`${Math.round(running.progress * 100)}%`} />}
              {file.reencodeQuality !== null && <Row label="Quality setting" value={file.reencodeQuality} />}
              {file.reencodeSkippedBytes !== null && <Row label="Size it came to" value={formatBytes(file.reencodeSkippedBytes)} />}
              {canReencode && (
                <>
                  <ActionRow label="Re-encode now" icon={actions.reencoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} disabled={actions.reencoding} onClick={() => actions.reencode(file, 'now')} />
                  {!file.activeJob && <ActionRow label="Re-encode tonight" icon={<Moon className="h-4 w-4" />} disabled={actions.reencoding} onClick={() => actions.reencode(file, 'tonight')} />}
                </>
              )}
            </GroupedSection>

            {file.reencodedAt && (
              <GroupedSection title="Original">
                <Row
                  label="Status"
                  value={file.originalKept
                    ? (originalDays !== null && originalDays > 0 ? `Kept for ${originalDays} more ${originalDays === 1 ? 'day' : 'days'}` : 'Deleted today')
                    : file.originalDeletedAt ? `Deleted ${format(new Date(file.originalDeletedAt), DATE)}` : 'Deleted'}
                  tone={file.originalKept ? 'text-amber-400' : undefined}
                />
                <Row label="Size" value={file.originalSizeBytes ? formatBytes(file.originalSizeBytes) : 'Not recorded'} />
                {file.originalKept && actions.idle(file) && (
                  <>
                    <ActionRow label="Restore original" icon={<RotateCcw className="h-4 w-4" />} onClick={() => actions.ask('restore', file)} />
                    <ActionRow label="Delete original now" icon={<Trash2 className="h-4 w-4" />} destructive onClick={() => actions.ask('delete-original', file)} />
                  </>
                )}
              </GroupedSection>
            )}
          </div>

          <div>
            <GroupedSection title="Cleanup" footer="Rules only delete when you start a cleanup in Settings">
              {actions.canManage ? (
                <SwitchRow label="Keep forever" checked={file.keepForever} onCheckedChange={(keep) => actions.setKeepForever(file, keep)} />
              ) : (
                <Row label="Keep forever" value={file.keepForever ? 'Yes' : 'No'} />
              )}
              <Row label="Rules would delete it" value={cleanup.text} tone={cleanup.tone} />
              {file.jellyfinItemId && <Row label="Watched" value={file.watchedAt ? format(new Date(file.watchedAt), DATE) : 'Not yet'} />}
              {actions.canManage && (
                <Link href="/settings/twitch" className="grouped-row gap-3 hover:bg-foreground/[0.03] active:bg-foreground/5">
                  <span className="text-sm">Cleanup settings</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              )}
            </GroupedSection>

            <GroupedSection title="Timeline">
              {timeline.length === 0 && <Row label="No history" value="" />}
              {timeline.map((entry) => (
                <div key={entry.id} className="grouped-row items-start justify-start gap-3">
                  {entry.title.startsWith('Download')
                    ? <Download className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    : entry.title.startsWith('Re-encode')
                      ? <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', entry.failed && 'text-red-400')}>{entry.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {[format(entry.at, DATE_TIME), entry.detail].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              ))}
            </GroupedSection>

            <GroupedSection>
              <a href={`https://www.twitch.tv/videos/${file.twitchVideoId}`} target="_blank" rel="noopener noreferrer" className="grouped-row gap-3 text-primary hover:bg-foreground/[0.03] active:bg-foreground/5">
                <span className="text-sm">Open on Twitch</span>
                <ExternalLink className="h-4 w-4" />
              </a>
              {actions.idle(file) && <ActionRow label="Delete video" icon={<Trash2 className="h-4 w-4" />} destructive onClick={() => actions.ask('delete', file)} />}
            </GroupedSection>
          </div>
        </div>
      </div>
      {actions.dialogs}
    </>
  );
}
