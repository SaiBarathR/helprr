'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { InteractiveSearch } from '@/components/media/interactive-search';

export default function EpisodeInteractiveSearchPage() {
  const { id, seasonNumber, episodeId } = useParams<{ id: string; seasonNumber: string; episodeId: string }>();
  const sp = useSearchParams();
  const instance = sp.get('instance');
  return (
    <InteractiveSearch
      service="sonarr"
      subtitle={sp.get('title') ?? 'Episode'}
      searchParams={{ episodeId, ...(instance ? { instanceId: instance } : {}) }}
      searchedItem={{ seriesId: id, seasonNumber, episodeId }}
    />
  );
}
