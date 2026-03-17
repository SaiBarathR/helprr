'use client';

import Link from 'next/link';
import { Download, Film, Tv, AlertTriangle, Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatDistanceToNowShort, formatBytes } from '@/lib/format';
import { SectionHeader } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface HistoryRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle?: string;
  source?: 'sonarr' | 'radarr';
  mediaType?: 'episode' | 'movie';
  seriesId?: number;
  movieId?: number;
  episodeId?: number;
  series?: { title: string; id: number };
  episode?: { title: string; seasonNumber: number; episodeNumber: number; id: number };
  movie?: { title: string; id: number };
  quality?: { quality: { name: string } };
  customFormats?: { id: number; name: string }[];
  languages?: { id: number; name: string }[];
  data?: {
    indexer?: string;
    releaseGroup?: string;
    size?: string;
  };
}

async function fetchHistory(): Promise<HistoryRecord[]> {
  const res = await fetch('/api/activity/history?pageSize=10');
  if (!res.ok) return [];
  const data = await res.json();
  return data.records || [];
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'grabbed':
      return <Download className="h-3.5 w-3.5 text-blue-400" />;
    case 'downloadFolderImported':
    case 'episodeFileImported':
    case 'movieFileImported':
    case 'imported':
      return <Download className="h-3.5 w-3.5 text-green-400" />;
    case 'downloadFailed':
    case 'importFailed':
      return <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />;
    case 'deleted':
    case 'episodeFileDeleted':
    case 'movieFileDeleted':
      return <Trash2 className="h-3.5 w-3.5 text-rose-400" />;
    default:
      return <Download className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function getEventLabel(eventType: string): string {
  switch (eventType) {
    case 'grabbed': return 'Grabbed';
    case 'downloadFolderImported': return 'Imported';
    case 'episodeFileImported': return 'Imported';
    case 'movieFileImported': return 'Imported';
    case 'imported': return 'Imported';
    case 'downloadFailed': return 'Failed';
    case 'importFailed': return 'Import Failed';
    case 'renamed': return 'Renamed';
    case 'deleted':
    case 'episodeFileDeleted':
    case 'movieFileDeleted': return 'Deleted';
    case 'ignored': return 'Ignored';
    default: return eventType.replace(/([a-z])([A-Z])/g, '$1 $2');
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

function getHref(record: HistoryRecord): string | null {
  if (record.source === 'radarr' && (record.movieId || record.movie?.id)) {
    return `/movies/${record.movieId || record.movie?.id}`;
  }
  if (record.source === 'sonarr') {
    const seriesId = record.seriesId || record.series?.id;
    const ep = record.episode;
    if (seriesId && ep) {
      return `/series/${seriesId}/season/${ep.seasonNumber}/episode/${ep.id}`;
    }
    if (seriesId) return `/series/${seriesId}`;
  }
  return null;
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

  const limit = size === 'large' ? 10 : 5;

  return (
    <div>
      <SectionHeader title="Activity" href="/activity/history" />
      <div className="space-y-1">
        {records.slice(0, limit).map((record) => {
          const href = getHref(record);
          const qualityName = record.quality?.quality?.name;
          const releaseGroup = record.data?.releaseGroup;
          const indexer = record.data?.indexer;
          const fileSize = record.data?.size ? formatBytes(Number(record.data.size)) : null;
          const customFormats = record.customFormats?.filter((cf) => cf.name) || [];

          const mediaIcon = record.mediaType === 'movie'
            ? <Film className="h-3.5 w-3.5 text-blue-400/70" />
            : <Tv className="h-3.5 w-3.5 text-purple-400/70" />;

          const mediaIndicator = (
            <span className={`shrink-0 ${href ? '' : 'opacity-50'}`}>
              {mediaIcon}
            </span>
          );

          const content = (
            <>
              {getEventIcon(record.eventType)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{getTitle(record)}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {getEventLabel(record.eventType)}
                  {' · '}
                  {formatDistanceToNowShort(record.date)}
                  {qualityName && <> · {qualityName}</>}
                  {fileSize && <> · {fileSize}</>}
                </p>
                {size === 'large' && (releaseGroup || indexer || customFormats.length > 0) && (
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {releaseGroup && (
                      <span className="text-[9px] px-1.5 py-0 rounded bg-muted text-muted-foreground">{releaseGroup}</span>
                    )}
                    {indexer && (
                      <span className="text-[9px] px-1.5 py-0 rounded bg-muted text-muted-foreground">{indexer}</span>
                    )}
                    {customFormats.slice(0, 3).map((cf) => (
                      <span key={cf.id} className="text-[9px] px-1.5 py-0 rounded bg-purple-500/10 text-purple-400">{cf.name}</span>
                    ))}
                    {customFormats.length > 3 && (
                      <span className="text-[9px] text-muted-foreground">+{customFormats.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
              {mediaIndicator}
            </>
          );

          if (href) {
            return (
              <Link
                key={`${record.source}-${record.id}`}
                href={href}
                className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2 hover:bg-muted/30 transition-colors"
              >
                {content}
              </Link>
            );
          }

          return (
            <div
              key={`${record.source}-${record.id}`}
              className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2"
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
