'use client';

import { use, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronRight, Download, ExternalLink, MoreHorizontal, Play, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { useMe, hasCapability } from '@/components/permission-provider';
import { HeroImage } from '@/components/media/hero-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ErrorState } from '@/components/ui/error-state';
import { Progress } from '@/components/ui/progress';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionsMenu } from '@/components/twitch/actions-menu';
import { DownloadSheet } from '@/components/twitch/download-sheet';
import { StreamerAvatar } from '@/components/twitch/streamer-avatar';
import { daysUntil, formatDuration, stageLabel, VIDEO_TYPE_LABELS, type TwitchVideo } from '@/components/twitch/types';
import { useVideoActions } from '@/components/twitch/use-video-actions';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';

type VideoDetail = TwitchVideo & {
  autoDownload: { enabled: boolean; reason: string; trace: Record<string, string> };
};

const POLICY_FIELDS: Record<string, string> = {
  autoDownload: 'Download automatically',
  notify: 'Notify about new videos',
  quality: 'Quality',
  chat: 'Archive chat',
  chapters: 'Chapters from games',
  reencode: 'Re-encode at night',
  keepForever: 'Keep forever',
  keepLatest: 'Keep the latest',
  deleteAfterDays: 'Delete after days',
  deleteAfterWatchedDays: 'Delete after watched',
  conditions: 'Conditions',
};

const POLICY_LAYERS: Record<string, string> = {
  builtIn: 'Default',
  global: 'Global rules',
  type: 'Video type rules',
  streamer: 'Streamer rules',
  streamerType: 'Streamer type rules',
  manual: 'This download',
};

function autoDownloadReason(reason: string): string {
  if (reason === 'master-switch') return 'Auto-download is off in Settings';
  const layer = /^(on|off) in (\w+)$/.exec(reason);
  if (layer) return `${layer[1] === 'on' ? 'On' : 'Off'} in ${(POLICY_LAYERS[layer[2]] ?? layer[2]).toLowerCase()}`;
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

// Three lines on a phone: anything shorter has nothing to reveal.
const READ_MORE_AT = 140;

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
  if (video.availability === 'RECORDING') return { label: 'Recording', className: 'bg-red-500/20 text-red-400 border-red-500/30' };
  return { label: 'Not downloaded', className: 'bg-foreground/10 text-muted-foreground border-border' };
}

export default function TwitchVodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const me = useMe();
  const actions = useVideoActions();
  // A push lands here with ?download=1, so the sheet is already open.
  const [sheetOpen, setSheetOpen] = useState(useSearchParams().get('download') === '1');
  const [whyOpen, setWhyOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const query = useQuery({
    queryKey: ['twitch', 'video', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/videos/${id}`, { signal });
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
    void fetch(`/api/twitch/videos/${id}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seen: true }),
    }).then(() => queryClient.invalidateQueries({ queryKey: ['twitch', 'feed'] }));
  }, [id, unseen, queryClient]);

  if (query.isError) {
    return (
      <div className="animate-content-in">
        <PageHeader title="Video" backHref="/twitch" />
        <ErrorState message="Couldn't load this video" onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (!video) {
    return (
      <>
        <PageHeader title="Video" backHref="/twitch" />
        <div className="space-y-4">
          <Skeleton className="-mx-2 h-[220px] rounded-none md:-mx-6" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-10 w-full rounded-full" />
        </div>
      </>
    );
  }

  const thumbnail = toCachedImageSrc(video.thumbnailUrl, undefined, { width: 1280 });
  const expiresIn = daysUntil(video.estimatedExpiresAt);
  const mutedSegments = video.mutedSegments ?? [];
  const muted = mutedSegments.reduce((total, segment) => total + segment.duration, 0);
  const status = statusOf(video);
  const groups = actions.groupsFor(video);
  const canDelete = hasCapability(me, 'twitch.manage') && Boolean(video.fileId) && !video.activeJob;
  const canDownload = hasCapability(me, 'twitch.download') && !video.downloaded && !video.activeJob && video.availability === 'PUBLISHED';
  const twitchUrl = `https://www.twitch.tv/videos/${video.twitchVideoId}`;
  const progress = Math.round((video.activeJob?.progress ?? 0) * 100);

  return (
    <>
      <PageHeader
        title={video.title}
        backHref="/twitch"
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
              <Link href={`/twitch/streamers/${video.streamer.id}`} aria-label={video.streamer.displayName} className="block shrink-0 self-end">
                <StreamerAvatar url={video.streamer.profileImageUrl} size={64} className="shadow-lg ring-1 ring-border/20" />
              </Link>
            </QuickContextMenu>
            <div className="min-w-0 flex-1">
              <Badge variant="outline" className={cn('mb-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', status.className)}>
                {status.label}
              </Badge>
              <h1 className="line-clamp-3 text-xl font-bold leading-tight">{video.title}</h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                <Link href={`/twitch/streamers/${video.streamer.id}`}>{video.streamer.displayName}</Link>
                {' · '}{format(new Date(video.twitchCreatedAt), 'PP')}{' · '}{formatDuration(video.durationSeconds)}
              </p>
            </div>
          </div>
        </div>

        <div className="@container">
          <div className="detail-grid detail-grid-movie flex flex-col gap-6">
            {video.activeJob && (
              <Link href="/twitch/queue" className="block rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5 [grid-area:progress]">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Download className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">{video.activeJob.stage ? stageLabel(video.activeJob.stage) : 'In the queue'}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </span>
                <Progress value={progress} className="mt-2 h-1.5" />
              </Link>
            )}

            <div className="[grid-area:facts]">
              <FactRow label="Type" value={VIDEO_TYPE_LABELS[video.type]} />
              {video.category && <FactRow label="Category" value={video.category} />}
              <FactRow label="Views" value={video.viewCount.toLocaleString()} />
              {expiresIn !== null && expiresIn >= 0 && !video.downloaded && (
                <FactRow label="Expires" value={expiresIn === 0 ? 'Today, estimated' : `In ${expiresIn} ${expiresIn === 1 ? 'day' : 'days'}, estimated`} />
              )}
              <button type="button" onClick={() => setWhyOpen(true)} className="flex w-full items-center justify-between py-2.5 text-left">
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">Auto-download</span>
                <span className="ml-4 flex min-w-0 items-center gap-1 text-sm">
                  <span className="truncate">{video.autoDownload.enabled ? 'Would save' : 'Would skip'}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </span>
              </button>
            </div>

            {video.description && (
              <div className="[grid-area:overview]">
                <p className={cn('whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground', !aboutOpen && 'line-clamp-3')}>{video.description}</p>
                {video.description.length > READ_MORE_AT && (
                  <button type="button" onClick={() => setAboutOpen(!aboutOpen)} className="mt-1 text-sm font-medium text-primary">
                    {aboutOpen ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 [grid-area:actions]">
              {muted > 0 && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p>Twitch muted {formatDuration(muted)} of the audio. It cannot be recovered.</p>
                    <p className="mt-0.5 text-xs tabular-nums opacity-80">
                      {mutedSegments.map((segment) => `${formatDuration(segment.offset)}–${formatDuration(segment.offset + segment.duration)}`).join(', ')}
                    </p>
                  </div>
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
              <div className="flex gap-3">
                <Button asChild variant="secondary" className="h-10 flex-1 rounded-full">
                  <a href={twitchUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open on Twitch</a>
                </Button>
                {canDelete && (
                  <Button variant="secondary" className="h-10 flex-1 rounded-full text-destructive" onClick={() => actions.deleteFiles([video])}>
                    <Trash2 className="mr-2 h-4 w-4" />Delete the file
                  </Button>
                )}
              </div>
            </div>

            {(video.chapters?.length ?? 0) > 0 && (
              <section aria-label="Chapters" className="[grid-area:cast]">
                <h2 className="mb-2 text-base font-semibold">Chapters</h2>
                <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
                  {video.chapters!.map((chapter) => (
                    <div key={`${chapter.start}-${chapter.title}`} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(chapter.start)}</span>
                      <span className="min-w-0 truncate text-sm">{chapter.title}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      <Drawer open={whyOpen} onOpenChange={setWhyOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{video.autoDownload.enabled ? 'Auto-download would save this' : 'Auto-download would skip this'}</DrawerTitle>
            <DrawerDescription>{autoDownloadReason(video.autoDownload.reason)}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            <div className="grouped-section-content overflow-hidden">
              {Object.entries(video.autoDownload.trace).map(([field, layer]) => (
                <div key={field} className="grouped-row gap-3">
                  <span className="min-w-0 truncate text-sm">{POLICY_FIELDS[field] ?? field}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">{POLICY_LAYERS[layer] ?? layer}</span>
                </div>
              ))}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {actions.sheet}
      {canDownload && <DownloadSheet video={video} open={sheetOpen} onOpenChange={setSheetOpen} />}
    </>
  );
}
