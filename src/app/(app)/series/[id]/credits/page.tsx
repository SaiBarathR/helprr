'use no memo';
'use client';

import { useCallback, useEffect, useState } from 'react';
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

  const [cast, setCast] = useState<CreditPerson[]>([]);
  const [crew, setCrew] = useState<CreditPerson[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (signal: AbortSignal) => {
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      setLoading(false);
      return;
    }

    try {
      const [seriesRes, creditsRes] = await Promise.all([
        fetch(`/api/sonarr/${seriesId}`, { signal }),
        fetch(`/api/sonarr/${seriesId}/credits`, { signal }),
      ]);

      if (signal.aborted) return;

      if (seriesRes.ok) {
        const seriesData = await seriesRes.json();
        setTitle(seriesData.title);
      }

      if (creditsRes.ok) {
        const credits: SeriesCreditsResponse = await creditsRes.json();
        setCast(
          credits.cast.map((c) => ({
            id: c.id,
            name: c.name,
            imagePath: c.profilePath,
            role: c.character,
            episodeCount: c.episodeCount,
          }))
        );
        setCrew(
          credits.crew.map((c) => ({
            id: c.id,
            name: c.name,
            imagePath: c.profilePath,
            role: c.job,
          }))
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [seriesId]);

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
