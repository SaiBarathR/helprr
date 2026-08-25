'use client';

import Link from 'next/link';
import { ArrowUpRight, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/components/permission-provider';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { jsonFetcher } from '@/lib/query-fetch';
import { formatBytes } from '@/lib/format';
import {
  summarizeMediaDownloads,
  trackTransferSpeeds,
  type MediaDownloadItem,
  type MediaDownloadSummary,
  type MediaDownloadTone,
  type MediaQueueSource,
  type SpeedSample,
} from '@/lib/media-download-progress';
import type { QueueItem } from '@/types';

interface MediaQueueResponse {
  records: QueueItem[];
  totalRecords: number;
}

interface MediaQueueView {
  summary: MediaDownloadSummary | null;
  speeds: Record<string, number>;
}

// Previous poll per media target, kept outside React so speed survives
// remounts and needs no render-time ref access.
const speedSamples = new Map<string, Record<string, SpeedSample>>();

const TONE_BADGE: Record<MediaDownloadTone, string> = {
  downloading: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  queued: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  importing: 'bg-green-500/10 text-green-500 border-green-500/20',
  warning: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  error: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export function MediaDownloadProgress({
  source,
  mediaId,
  instanceId,
}: {
  source: MediaQueueSource;
  mediaId: number;
  instanceId?: string;
}) {
  const canViewActivity = useCan('activity.view');
  const params = new URLSearchParams({ source, mediaId: String(mediaId) });
  if (instanceId) params.set('instanceId', instanceId);

  const queueQuery = useQuery({
    queryKey: ['activity', 'queue', 'media', source, mediaId, instanceId ?? 'default'],
    queryFn: async (context): Promise<MediaQueueView> => {
      const data = await jsonFetcher<MediaQueueResponse>(
        `/api/activity/queue?${params.toString()}`,
      )(context);
      const summary = summarizeMediaDownloads(data.records ?? []);
      const sampleKey = `${source}:${instanceId ?? 'default'}:${mediaId}`;
      const samples = trackTransferSpeeds(
        speedSamples.get(sampleKey),
        summary?.items ?? [],
        Date.now(),
      );
      speedSamples.set(sampleKey, samples);
      const speeds: Record<string, number> = {};
      for (const [key, sample] of Object.entries(samples)) {
        if (sample.speed !== null) speeds[key] = sample.speed;
      }
      return { summary, speeds };
    },
    enabled: canViewActivity && Number.isInteger(mediaId) && mediaId > 0,
    staleTime: 2_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const summary = queueQuery.data?.summary ?? null;
  const speeds = queueQuery.data?.speeds ?? {};
  if (!canViewActivity || !summary) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b border-primary/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Download className="h-3.5 w-3.5 text-primary" />
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:2.5s]" />
          </span>
          <p className="truncate text-sm font-medium">
            {summary.count === 1 ? 'Downloading' : `Downloading · ${summary.count} releases`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {summary.progress !== null && summary.count > 1 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatPercent(summary.progress)} overall
            </span>
          )}
          <Link
            href="/activity?tab=queue"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            Activity
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
      <div className="divide-y divide-primary/10">
        {summary.items.map((item) => (
          <DownloadRow key={item.key} item={item} speed={speeds[item.key] ?? null} />
        ))}
      </div>
    </section>
  );
}

function DownloadRow({ item, speed }: { item: MediaDownloadItem; speed: number | null }) {
  const downloaded = Math.max(0, item.size - item.sizeleft);
  const stats = [
    item.size > 0 ? `${formatBytes(downloaded)} of ${formatBytes(item.size)}` : null,
    speed !== null && speed > 0 ? `${formatBytes(speed)}/s` : null,
    item.downloadClient,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className={`px-1.5 py-0 text-[10px] ${TONE_BADGE[item.tone]}`}>
          {item.statusLabel}
        </Badge>
        {item.episodeLabel && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {item.episodeLabel}
          </Badge>
        )}
        {item.quality && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {item.quality}
          </Badge>
        )}
      </div>
      <p className="mt-1.5 truncate text-xs text-muted-foreground" title={item.title}>
        {item.title}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <Progress value={item.progress} className="h-1.5 flex-1" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatPercent(item.progress)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="truncate">{stats.join(' · ')}</span>
        {item.timeLeft && <span className="shrink-0 tabular-nums">{item.timeLeft} left</span>}
      </div>
      {item.message && (
        <p className="mt-1 line-clamp-2 text-[11px] text-orange-500/90">{item.message}</p>
      )}
    </div>
  );
}

function formatPercent(progress: number): string {
  if (progress > 0 && progress < 1) return '<1%';
  return `${Math.round(progress)}%`;
}

