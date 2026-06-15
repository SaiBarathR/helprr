'use no memo';
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useParams, useSearchParams } from 'next/navigation';
import { CreditsListPage, type CreditPerson } from '@/components/media/credits-list-page';

interface SeriesCreditsResponse {
  cast: { id: number; name: string; profilePath: string | null; character: string; episodeCount?: number }[];
  crew: { id: number; name: string; profilePath: string | null; job: string }[];
}

export default function SeriesCreditsPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const seriesId = Number(id);
  const initialTab = searchParams.get('type') === 'crew' ? 'crew' : 'cast';
  const instance = searchParams.get('instance') ?? undefined;
  const enabled = Number.isFinite(seriesId) && seriesId > 0;

  const seriesQuery = useQuery({
    queryKey: queryKeys.detail('sonarr', seriesId, instance),
    queryFn: jsonFetcher<{ title: string }>(`/api/sonarr/${seriesId}`, instance),
    enabled,
  });
  const creditsQuery = useQuery({
    queryKey: queryKeys.credits('sonarr', seriesId, instance),
    queryFn: jsonFetcher<SeriesCreditsResponse>(`/api/sonarr/${seriesId}/credits`, instance),
    enabled,
  });

  const title = seriesQuery.data?.title ?? '';
  const loading = seriesQuery.isLoading || creditsQuery.isLoading;

  const { cast, crew } = useMemo((): { cast: CreditPerson[]; crew: CreditPerson[] } => {
    const credits = creditsQuery.data;
    if (!credits) return { cast: [], crew: [] };
    return {
      cast: credits.cast.map((c) => ({
        id: c.id,
        name: c.name,
        imagePath: c.profilePath,
        role: c.character,
        episodeCount: c.episodeCount,
      })),
      crew: credits.crew.map((c) => ({
        id: c.id,
        name: c.name,
        imagePath: c.profilePath,
        role: c.job,
      })),
    };
  }, [creditsQuery.data]);

  return (
    <CreditsListPage
      mediaTitle={title}
      cast={cast}
      crew={crew}
      cacheService="tmdb"
      loading={loading}
      initialTab={initialTab}
    />
  );
}
