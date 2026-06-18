'use no memo';
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useParams, useSearchParams } from 'next/navigation';
import { CreditsListPage, type CreditPerson } from '@/components/media/credits-list-page';
import { crewRolePriority } from '@/lib/crew-priority';
import type { RadarrCredit, RadarrMovie } from '@/types';

export default function MovieCreditsPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const movieId = Number(id);
  const instance = searchParams.get('instance') ?? undefined;
  const initialTab = searchParams.get('type') === 'crew' ? 'crew' : 'cast';
  const enabled = Number.isFinite(movieId) && movieId > 0;

  const movieQuery = useQuery({
    queryKey: queryKeys.detail('radarr', movieId, instance),
    queryFn: jsonFetcher<RadarrMovie>(`/api/radarr/${movieId}`, instance),
    enabled,
  });
  const creditsQuery = useQuery({
    queryKey: queryKeys.credits('radarr', movieId, instance),
    queryFn: jsonFetcher<RadarrCredit[]>(`/api/radarr/credit?movieId=${movieId}`, instance),
    enabled,
    select: ensureArray,
  });

  const title = movieQuery.data?.title ?? '';
  const credits = creditsQuery.data ?? [];
  // First-load-only: once credits are cached, a background refetch must not
  // re-blank CreditsListPage to a full-screen spinner.
  const loading = (movieQuery.isLoading || creditsQuery.isLoading) && !creditsQuery.data;
  const error = creditsQuery.error;

  const { cast, crew } = useMemo((): { cast: CreditPerson[]; crew: CreditPerson[] } => {
    const castItems: CreditPerson[] = credits
      .filter((c) => c.type === 'cast')
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        id: c.personTmdbId,
        name: c.personName,
        imagePath: c.images.find((img) => img.coverType === 'headshot')?.remoteUrl ?? null,
        role: c.character || '',
      }));

    const seenCrew = new Set<string>();
    const crewItems: CreditPerson[] = credits
      .filter((c) => c.type === 'crew')
      .filter((c) => {
        const key = `${c.personTmdbId}-${c.job}`;
        if (seenCrew.has(key)) return false;
        seenCrew.add(key);
        return true;
      })
      .sort((a, b) => crewRolePriority(a.job || '') - crewRolePriority(b.job || ''))
      .map((c) => ({
        id: c.personTmdbId,
        name: c.personName,
        imagePath: c.images.find((img) => img.coverType === 'headshot')?.remoteUrl ?? null,
        role: c.job || '',
        department: c.department,
      }));

    return { cast: castItems, crew: crewItems };
  }, [credits]);

  return (
    <CreditsListPage
      mediaTitle={title}
      cast={cast}
      crew={crew}
      cacheService="radarr"
      loading={loading}
      initialTab={initialTab}
      error={error?.message ?? null}
    />
  );
}
