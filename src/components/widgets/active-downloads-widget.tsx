'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, SectionHeader } from '@/components/widgets/shared';
import type { QueueItem } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';

async function fetchQueue(): Promise<QueueItem[]> {
  const res = await fetch('/api/activity/queue');
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

export function ActiveDownloadsWidget({ size, refreshInterval }: WidgetProps) {
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

  if (!queue || queue.length === 0) return null;

  return (
    <div>
      <SectionHeader title="Downloading" href="/activity" />
      <Carousel>
        {queue.slice(0, 8).map((item) => {
          const progress = item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0;
          return (
            <div
              key={item.id}
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
