'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, EditModePlaceholder, SectionHeader } from '@/components/widgets/shared';
import type { QueueItem } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';

type QueueWidgetItem = QueueItem & {
  source?: string;
  service?: string;
  backend?: string;
};

interface QueueApiResponse {
  records: QueueWidgetItem[];
  totalRecords: number;
}

function getQueueItemKey(item: QueueWidgetItem): string {
  return `${item.source ?? item.service ?? item.backend ?? 'unknown'}-${item.id}`;
}

async function fetchQueue(): Promise<QueueWidgetItem[]> {
  const res = await fetch('/api/activity/queue?pageSize=8');
  if (!res.ok) return [];
  const data: QueueApiResponse = await res.json();
  return data.records || [];
}

function getProgressPercent(item: QueueWidgetItem): number {
  if (item.size <= 0) return 0;
  const rawProgress = ((item.size - item.sizeleft) / item.size) * 100;
  return Math.max(0, Math.min(100, rawProgress));
}

export function ActiveDownloadsWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data: queue, loading } = useWidgetData({ fetchFn: fetchQueue, refreshInterval });

  if (loading) {
    return (
      <div>
        <SectionHeader title="Downloading" href="/activity" />
        <div className="flex gap-3 overflow-hidden">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-[90px] w-[200px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!queue || queue.length === 0) {
    return editMode ? <EditModePlaceholder title="Downloading" message="No active downloads" /> : null;
  }

  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title="Downloading" href="/activity" />
        <div className="space-y-1.5">
          {queue.slice(0, 3).map((item) => {
            const progress = getProgressPercent(item);
            return (
              <div
                key={getQueueItemKey(item)}
                className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.title}</p>
                  <Progress value={progress} className="h-1 mt-1.5" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold tabular-nums text-green-400">{progress.toFixed(0)}%</span>
                  {item.timeleft && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">{item.timeleft}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Downloading" href="/activity" />
      <Carousel>
        {queue.slice(0, 8).map((item) => {
          const progress = getProgressPercent(item);
          return (
            <div
              key={getQueueItemKey(item)}
              className="snap-start shrink-0 w-[200px] rounded-xl bg-card p-3 flex flex-col justify-between"
            >
              <div>
                <p className="text-[12px] font-medium line-clamp-2 leading-snug mb-2">{item.title}</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[20px] font-bold tabular-nums text-green-400">{progress.toFixed(0)}%</span>
                  {item.timeleft && (
                    <span className="text-[10px] text-muted-foreground">{item.timeleft}</span>
                  )}
                </div>
                <Progress value={progress} className="h-1" />
              </div>
            </div>
          );
        })}
      </Carousel>
    </div>
  );
}
