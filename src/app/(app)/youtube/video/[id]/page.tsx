'use client';

import { use, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { ChevronRight, Download, ExternalLink, Lock, MoreHorizontal, Play } from 'lucide-react';
import { format } from 'date-fns';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { useMe, hasCapability } from '@/components/permission-provider';
import { YoutubeDownloadSheet } from '@/components/youtube/download-sheet';
import { HeroImage } from '@/components/media/hero-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionsMenu } from '@/components/creators/actions-menu';
import { ClampedText } from '@/components/creators/clamped-text';
import { CreatorAvatar } from '@/components/creators/creator-avatar';
import { formatDuration, type CreatorVideoItem } from '@/components/creators/types';
import { useVideoActions } from '@/components/creators/use-video-actions';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';

type VideoDetail = CreatorVideoItem & { liveEndedAt: string | null; ageRestricted: boolean };

const TYPE_LABELS: Partial<Record<CreatorVideoItem['type'], string>> = { UPLOAD: 'Video', ARCHIVE: 'Live replay', SHORT: 'Short' };

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between border-b border-border/40 py-2.5 last:border-b-0">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="ml-4 truncate text-right text-sm">{value}</span>
    </div>
  );
}

function statusOf(video: VideoDetail): { label: string; className: string } {
  if (video.activeJob) return { label: 'Downloading', className: 'bg-primary/15 text-primary border-primary/30' };
  if (video.downloaded) return { label: 'Downloaded', className: 'bg-green-500/20 text-green-400 border-green-500/30' };
  if (video.availability === 'RECORDING') return { label: 'Live', className: 'bg-red-500/20 text-red-400 border-red-500/30' };
  if (video.availability === 'UNAVAILABLE') return { label: 'Removed from YouTube', className: 'bg-foreground/10 text-muted-foreground border-border' };
  return { label: 'Not downloaded', className: 'bg-foreground/10 text-muted-foreground border-border' };
}

export default function YoutubeVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const actions = useVideoActions();
  const me = useMe();
  // A push lands here with ?download=1, so the sheet is already open.
  const [sheetOpen, setSheetOpen] = useState(useSearchParams().get('download') === '1');

  const query = useQuery({
    queryKey: ['youtube', 'video', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/youtube/videos/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load video');
      return (await res.json()) as VideoDetail;
    },
    refetchInterval: (state) => (state.state.data?.activeJob ? 5_000 : false),
    refetchIntervalInBackground: false,
  });
  const video = query.data;

  const unseen = video && !video.seen;
  useEffect(() => {
    if (!unseen) return;
    void fetch(`/api/youtube/videos/${id}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seen: true }),
    }).then(() => queryClient.invalidateQueries({ queryKey: ['youtube', 'feed'] }));
  }, [id, unseen, queryClient]);

  if (query.isError) {
    return (
      <>
        <PageHeader title="Video" backHref="/youtube" />
        <ErrorState message="Couldn't load this video" onRetry={() => void query.refetch()} />
      </>
    );
  }
  if (!video) {
    return (
      <>
        <PageHeader title="Video" backHref="/youtube" />
        <div className="space-y-3 pt-3">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </>
    );
  }

  const thumbnail = toCachedImageSrc(video.thumbnailUrl, undefined, { width: 1280 });
  const status = statusOf(video);
  const groups = actions.groupsFor(video);
  const channelHref = `/youtube/channels/${video.creator.id}`;
  const canDownload = hasCapability(me, 'youtube.download') && !video.downloaded && !video.activeJob && video.availability === 'PUBLISHED';

  return (
    <>
      <PageHeader
        title={video.title}
        backHref="/youtube"
        rightContent={(
          <ActionsMenu
            label={`${video.title} actions`}
            groups={groups}
            className="flex h-11 w-10 items-center justify-center text-primary"
            icon={<MoreHorizontal className="h-5 w-5" />}
          />
        )}
      />
      <div className="space-y-6 animate-content-in">
        <div className="-mx-2 md:-mx-6">
          <div className="relative h-[220px] w-full overflow-hidden bg-muted/40 md:h-[300px]">
            {thumbnail && <HeroImage src={thumbnail} alt="" fill sizes="100vw" className="object-cover" priority unoptimized />}
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent light:via-background/25" />
          </div>
          <div className="relative -mt-[72px] flex gap-3.5 px-2 md:px-6">
            <QuickContextMenu label={`${video.title} actions`} groups={groups}>
              <Link href={channelHref} aria-label={video.creator.displayName} className="block shrink-0 self-end">
                <CreatorAvatar url={video.creator.profileImageUrl} size={64} className="shadow-lg ring-1 ring-border/20" />
              </Link>
            </QuickContextMenu>
            <div className="min-w-0 flex-1">
              <Badge variant="outline" className={cn('mb-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', status.className)}>
                {status.label}
              </Badge>
              <h1 className="line-clamp-3 text-xl font-bold leading-tight">{video.title}</h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                <Link href={channelHref}>{video.creator.displayName}</Link>
                {' · '}{format(new Date(video.sourceCreatedAt), 'PP')}{' · '}{formatDuration(video.durationSeconds)}
              </p>
            </div>
          </div>
        </div>

        <div className="@container">
          <div className="detail-grid detail-grid-movie flex flex-col gap-6">
            <div className="[grid-area:facts]">
              <FactRow label="Type" value={TYPE_LABELS[video.type] ?? 'Video'} />
              <FactRow label="Views" value={video.viewCount.toLocaleString()} />
              {video.liveEndedAt && <FactRow label="Stream ended" value={format(new Date(video.liveEndedAt), 'PPp')} />}
              {video.fileId && (
                <Link href={`/youtube/library/${video.fileId}`} className="flex items-center justify-between py-2.5">
                  <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">File</span>
                  <span className="ml-4 flex min-w-0 items-center gap-1 text-sm">
                    <span className="truncate">Size and cleanup</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </span>
                </Link>
              )}
            </div>

            {video.description && (
              <div className="[grid-area:overview]">
                <ClampedText text={video.description} className="whitespace-pre-wrap" />
              </div>
            )}

            <div className="flex flex-col gap-3 [grid-area:actions]">
              {video.ageRestricted && (
                <div className="flex items-start gap-2.5 rounded-xl bg-card px-3 py-2.5 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>Age-restricted. Saving it needs the spare Google account in Settings.</p>
                </div>
              )}
              {video.jellyfinItemId ? (
                <Button asChild className="h-10 w-full rounded-full">
                  <Link href={`/jellyfin/library/item/${video.jellyfinItemId}`}><Play className="mr-2 h-4 w-4 fill-current" />Play</Link>
                </Button>
              ) : canDownload && (
                <Button className="h-10 w-full rounded-full" onClick={() => setSheetOpen(true)}>
                  <Download className="mr-2 h-4 w-4" />Download
                </Button>
              )}
              <Button asChild variant="secondary" className="h-10 w-full rounded-full">
                <a href={`https://www.youtube.com/watch?v=${video.externalId}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />Open on YouTube
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
      {actions.sheet}
      {canDownload && <YoutubeDownloadSheet video={video} open={sheetOpen} onOpenChange={setSheetOpen} />}
    </>
  );
}
