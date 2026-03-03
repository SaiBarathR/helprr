'use client';

import { Download, Film, Tv, AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatDistanceToNowSafe } from '@/lib/format';
import { SectionHeader } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface HistoryRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle?: string;
  source?: 'sonarr' | 'radarr';
  mediaType?: 'episode' | 'movie';
  series?: { title: string };
  episode?: { title: string; seasonNumber: number; episodeNumber: number };
  movie?: { title: string };
}

async function fetchHistory(): Promise<HistoryRecord[]> {
  const res = await fetch('/api/activity/history?pageSize=8');
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'grabbed':
      return <Download className="h-3.5 w-3.5 text-blue-400" />;
    case 'downloadFolderImported':
    case 'imported':
      return <Download className="h-3.5 w-3.5 text-green-400" />;
    case 'downloadFailed':
    case 'importFailed':
      return <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />;
    default:
      return <Download className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function getTitle(record: HistoryRecord): string {
  if (record.movie?.title) return record.movie.title;
  if (record.series?.title) {
    const ep = record.episode;
    if (ep) return `${record.series.title} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
    return record.series.title;
  }
  return record.sourceTitle || 'Unknown';
}

export function ActivityHistoryWidget({ size, refreshInterval }: WidgetProps) {
  const { data: records, loading } = useWidgetData({ fetchFn: fetchHistory, refreshInterval });

  if (loading) {
    return (
      <div>
        <SectionHeader title="Activity" href="/activity/history" />
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div>
        <SectionHeader title="Activity" href="/activity/history" />
        <div className="rounded-xl bg-card py-6 text-center">
          <p className="text-xs text-muted-foreground">No recent activity</p>
        </div>
      </div>
    );
  }

  const limit = size === 'large' ? 8 : 5;

  return (
    <div>
      <SectionHeader title="Activity" href="/activity/history" />
      <div className="space-y-1">
        {records.slice(0, limit).map((record) => (
          <div
            key={`${record.source}-${record.id}`}
            className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2"
          >
            {getEventIcon(record.eventType)}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{getTitle(record)}</p>
              <p className="text-[10px] text-muted-foreground">
                {record.eventType === 'grabbed' ? 'Grabbed' : record.eventType === 'downloadFolderImported' ? 'Imported' : record.eventType}
                {' · '}
                {formatDistanceToNowSafe(record.date)}
              </p>
            </div>
            {record.mediaType === 'movie'
              ? <Film className="h-3 w-3 text-blue-400/50 shrink-0" />
              : <Tv className="h-3 w-3 text-purple-400/50 shrink-0" />
            }
          </div>
        ))}
      </div>
    </div>
  );
}
