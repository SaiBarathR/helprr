'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/components/permission-provider';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { jsonFetcher } from '@/lib/query-fetch';
import { formatBytes } from '@/lib/format';
import {
  summarizeMediaDownloads,
  type MediaDownloadItem,
  type MediaDownloadTone,
  type MediaQueueSource,
} from '@/lib/media-download-progress';
import type { QueueItem } from '@/types';

interface MediaQueueResponse {
  records: QueueItem[];
  totalRecords: number;
}

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
  const [expanded, setExpanded] = useState(false);
  const params = new URLSearchParams({ source, mediaId: String(mediaId) });
  if (instanceId) params.set('instanceId', instanceId);

  const queueQuery = useQuery({
    queryKey: ['activity', 'queue', 'media', source, mediaId, instanceId ?? 'default'],
    queryFn: jsonFetcher<MediaQueueResponse>(`/api/activity/queue?${params.toString()}`),
    enabled: canViewActivity && Number.isInteger(mediaId) && mediaId > 0,
    staleTime: 2_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const summary = summarizeMediaDownloads(queueQuery.data?.records ?? []);
  if (!canViewActivity || !summary) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="block w-full px-3 py-2.5 text-left active:bg-primary/[0.06]"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Download className="h-3.5 w-3.5 text-primary" />
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:2.5s]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            Downloading
            {summary.count > 1 && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {summary.count} releases
              </span>
            )}
          </span>
          {summary.progress !== null && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatPercent(summary.progress)}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
        <Progress value={summary.progress ?? 0} className="mt-2 h-1" />
      </button>
      {expanded && (
        <div className="divide-y divide-primary/10 border-t border-primary/10">
          {summary.items.map((item) => (
            <DownloadRow key={item.key} item={item} />
          ))}
          <Link
            href="/activity?tab=queue"
            className="flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-primary active:bg-primary/[0.06]"
          >
            Open Activity
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </section>
  );
}

function DownloadRow({ item }: { item: MediaDownloadItem }) {
  const downloaded = Math.max(0, item.size - item.sizeleft);

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
      <p className="mt-1.5 hidden truncate text-xs text-muted-foreground sm:block" title={item.title}>
        {item.title}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <Progress value={item.progress} className="h-1.5 flex-1" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatPercent(item.progress)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>
          {item.size > 0 ? `${formatBytes(downloaded)} / ${formatBytes(item.size)}` : null}
        </span>
        {item.timeLeft && <span className="tabular-nums">{item.timeLeft} left</span>}
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
