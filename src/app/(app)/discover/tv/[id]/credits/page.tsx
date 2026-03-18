'use no memo';
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { CreditsListPage, type CreditPerson } from '@/components/media/credits-list-page';
import type { DiscoverTvFullDetail } from '@/types';

export default function DiscoverTvCreditsPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const tvId = Number(id);
  const initialTab = searchParams.get('type') === 'crew' ? 'crew' : 'cast';

  const [cast, setCast] = useState<CreditPerson[]>([]);
  const [crew, setCrew] = useState<CreditPerson[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (signal: AbortSignal) => {
    if (!Number.isFinite(tvId) || tvId <= 0) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/discover/tv/${tvId}`, { signal });
      if (!res.ok) throw new Error('Failed to load');
      const data: DiscoverTvFullDetail = await res.json();
      if (signal.aborted) return;

      setTitle(data.title);
      setCast(
        data.cast.map((c) => ({
          id: c.id,
          name: c.name,
          imagePath: c.profilePath,
          role: c.character,
          episodeCount: c.episodeCount,
        }))
      );
      setCrew(
        data.crew.map((c) => ({
          id: c.id,
          name: c.name,
          imagePath: c.profilePath,
          role: c.job,
          department: c.department,
        }))
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [tvId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

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
