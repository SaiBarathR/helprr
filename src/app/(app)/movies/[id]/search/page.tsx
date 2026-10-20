'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { InteractiveSearch } from '@/components/media/interactive-search';

export default function MovieInteractiveSearchPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const instance = sp.get('instance');
  return (
    <InteractiveSearch
      service="radarr"
      subtitle={sp.get('title') ?? 'Movie'}
      searchParams={{ movieId: id, ...(instance ? { instanceId: instance } : {}) }}
    />
  );
}
