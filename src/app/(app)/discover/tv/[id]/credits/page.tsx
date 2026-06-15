'use no memo';
'use client';

import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CreditsListPage, type CreditPerson } from '@/components/media/credits-list-page';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import type { DiscoverTvFullDetail } from '@/types';

const EMPTY_CREDITS: CreditPerson[] = [];

export default function DiscoverTvCreditsPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const tvId = Number(id);
  const initialTab = searchParams.get('type') === 'crew' ? 'crew' : 'cast';

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.discoverCredits('tv', tvId),
    queryFn: jsonFetcher<DiscoverTvFullDetail>(`/api/discover/tv/${tvId}`),
    enabled: Number.isFinite(tvId) && tvId > 0,
  });

  const cast = useMemo<CreditPerson[]>(
    () =>
      data?.cast.map((c) => ({
        id: c.id,
        name: c.name,
        imagePath: c.profilePath,
        role: c.character,
        episodeCount: c.episodeCount,
      })) ?? EMPTY_CREDITS,
    [data]
  );
  const crew = useMemo<CreditPerson[]>(
    () =>
      data?.crew.map((c) => ({
        id: c.id,
        name: c.name,
        imagePath: c.profilePath,
        role: c.job,
        department: c.department,
      })) ?? EMPTY_CREDITS,
    [data]
  );

  return (
    <CreditsListPage
      mediaTitle={data?.title ?? ''}
      cast={cast}
      crew={crew}
      cacheService="tmdb"
      loading={isLoading}
      initialTab={initialTab}
    />
  );
}
