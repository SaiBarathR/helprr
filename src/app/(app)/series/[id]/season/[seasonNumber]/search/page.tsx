'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { InteractiveSearch } from '@/components/media/interactive-search';

export default function SeasonInteractiveSearchPage() {
  const { id, seasonNumber } = useParams<{ id: string; seasonNumber: string }>();
  const sp = useSearchParams();
  const instance = sp.get('instance');
  return (
    <InteractiveSearch
      service="sonarr"
      subtitle={sp.get('title') ?? `Season ${seasonNumber}`}
      searchParams={{ seriesId: id, seasonNumber, ...(instance ? { instanceId: instance } : {}) }}
      showSeasonPackFilter
    />
  );
}
