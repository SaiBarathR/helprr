'use no memo';
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { CreditsListPage, type CreditPerson } from '@/components/media/credits-list-page';
import { crewRolePriority } from '@/lib/crew-priority';
import type { RadarrCredit } from '@/types';

export default function MovieCreditsPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const movieId = Number(id);
  const initialTab = searchParams.get('type') === 'crew' ? 'crew' : 'cast';

  const [credits, setCredits] = useState<RadarrCredit[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (signal: AbortSignal) => {
    if (!Number.isFinite(movieId) || movieId <= 0) {
      setLoading(false);
      return;
    }

    try {
      const [movieRes, creditsRes] = await Promise.all([
        fetch(`/api/radarr/${movieId}`, { signal }),
        fetch(`/api/radarr/credit?movieId=${movieId}`, { signal }),
      ]);

      if (signal.aborted) return;

      if (movieRes.ok) {
        const movieData = await movieRes.json();
        setTitle(movieData.title);
      }

      if (creditsRes.ok) {
        const data: RadarrCredit[] = await creditsRes.json();
        setCredits(data);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [movieId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

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
    />
  );
}
