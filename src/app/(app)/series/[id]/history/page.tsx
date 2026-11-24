'use client';

import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { NotFoundState } from '@/components/ui/not-found-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ArrHistoryList } from '@/components/media/arr-history-list';
import { TitleBlocklist } from '@/components/media/title-blocklist';
import { useArrInstanceId } from '@/lib/hooks/use-arr-instance-id';
import { queryKeys } from '@/lib/query-keys';
import { ensureArray, jsonFetcher, nullOn404 } from '@/lib/query-fetch';
import type { HistoryItem, SonarrEpisode, SonarrSeries } from '@/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Every history record of a series, across its episodes, like Sonarr's series History. */
export default function SeriesHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const seriesId = Number(id);
  const instance = useSearchParams().get('instance') ?? undefined;
  const enabled = Number.isInteger(seriesId) && seriesId > 0;
  // Mark as failed and the blocklist name the instance; a page opened without
  // ?instance= is on the default one.
  const instanceId = useArrInstanceId('SONARR', instance, enabled);

  // The series and its episodes share the detail page's cache keys, so arriving
  // from the series is warm.
  const seriesQuery = useQuery({
    queryKey: queryKeys.detail('sonarr', seriesId, instance),
    queryFn: (ctx): Promise<SonarrSeries | null> =>
      nullOn404(jsonFetcher<SonarrSeries>(`/api/sonarr/${seriesId}`, instance)(ctx)),
    enabled,
  });
  const series = seriesQuery.data ?? null;

  const episodesQuery = useQuery({
    queryKey: queryKeys.episodes(seriesId, instance),
    queryFn: jsonFetcher<SonarrEpisode[]>(`/api/sonarr/${seriesId}/episodes`, instance),
    enabled,
    select: ensureArray,
  });

  const historyQuery = useQuery({
    queryKey: ['sonarr', 'history', 'series', instance ?? 'default', seriesId],
    queryFn: jsonFetcher<HistoryItem[]>(`/api/sonarr/history/series?seriesId=${seriesId}`, instance),
    enabled,
    select: ensureArray,
  });

  // Sonarr's series history carries only episode ids; the episode list names them.
  const episodeCodes = useMemo(() => {
    const codes = new Map<number, string>();
    for (const episode of episodesQuery.data ?? []) {
      codes.set(episode.id, `S${pad(episode.seasonNumber)}E${pad(episode.episodeNumber)}`);
    }
    return codes;
  }, [episodesQuery.data]);

  if (seriesQuery.isLoading && !series) {
    return <><PageHeader title="History" /><PageSpinner /></>;
  }

  if (!series) {
    return (
      <div>
        <PageHeader title="History" />
        <NotFoundState message="Series not found" />
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={series.title} />

      <div className="space-y-6 pb-8">
        <section className="space-y-2">
          <h2 className="text-lg font-bold leading-tight">History</h2>
          {historyQuery.isError ? (
            <div className="rounded-2xl border px-4 py-6 text-center text-sm text-muted-foreground">
              Could not load the history
            </div>
          ) : (
            <ArrHistoryList
              items={historyQuery.data ?? []}
              loading={historyQuery.isLoading}
              episodeLabel={(item) => (item.episodeId ? episodeCodes.get(item.episodeId) ?? null : null)}
              source="sonarr"
              instanceId={instanceId}
            />
          )}
        </section>

        <TitleBlocklist source="sonarr" mediaId={seriesId} instanceId={instanceId} />
      </div>
    </div>
  );
}
