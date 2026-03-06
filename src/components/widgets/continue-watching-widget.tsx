'use client';

import Image from 'next/image';
import { MonitorPlay } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, EditModePlaceholder, SectionHeader } from '@/components/widgets/shared';
import { isProtectedApiImageSrc } from '@/lib/image';
import type { JellyfinItem } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';

async function fetchResumeItems(): Promise<JellyfinItem[]> {
  const res = await fetch('/api/jellyfin/resume');
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

export function ContinueWatchingWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data: resumeItems, loading } = useWidgetData({ fetchFn: fetchResumeItems, refreshInterval });

  if (loading) {
    return (
      <div>
        <SectionHeader title="Continue Watching" />
        <div className="flex gap-3 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[170px] w-[110px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!resumeItems || resumeItems.length === 0) {
    return editMode ? <EditModePlaceholder title="Continue Watching" message="Nothing to resume" /> : null;
  }

  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title="Continue Watching" />
        <div className="space-y-1.5">
          {resumeItems.slice(0, 4).map((item) => {
            const progress = item.UserData?.PlayedPercentage ?? 0;
            return (
              <div
                key={item.Id}
                className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5"
              >
                <MonitorPlay className="h-3.5 w-3.5 text-[#00a4dc] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.SeriesName || item.Name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {item.Type === 'Episode' && item.ParentIndexNumber != null
                      ? `S${item.ParentIndexNumber}E${item.IndexNumber} · ${item.Name}`
                      : item.Name !== (item.SeriesName || item.Name) ? item.Name : ''}
                  </p>
                </div>
                <div className="w-12 shrink-0">
                  <div className="h-1 rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[#00a4dc]" style={{ width: `${progress}%` }} />
                  </div>
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
      <SectionHeader title="Continue Watching" />
      <Carousel>
        {resumeItems.map((item) => {
          const progress = item.UserData?.PlayedPercentage ?? 0;
          const imageId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
          const hasImage = item.ImageTags?.Primary || (item.Type === 'Episode' && item.SeriesId);
          const jellyfinPosterSrc = `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=220&quality=90`;

          return (
            <div key={item.Id} className="snap-start shrink-0 w-[110px]">
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
                {hasImage ? (
                  <Image
                    src={jellyfinPosterSrc}
                    alt={item.Name}
                    fill
                    sizes="110px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(jellyfinPosterSrc)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <MonitorPlay className="h-6 w-6 text-muted-foreground/20" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
                  <div className="h-full bg-[#00a4dc]" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <p className="text-[11px] font-medium truncate leading-tight">{item.SeriesName || item.Name}</p>
              {item.Type === 'Episode' && item.ParentIndexNumber != null && (
                <p className="text-[10px] text-muted-foreground truncate">
                  S{item.ParentIndexNumber}E{item.IndexNumber}
                </p>
              )}
            </div>
          );
        })}
      </Carousel>
    </div>
  );
}
