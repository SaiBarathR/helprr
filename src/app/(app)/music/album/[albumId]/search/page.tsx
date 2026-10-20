'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { InteractiveSearch } from '@/components/media/interactive-search';

export default function AlbumInteractiveSearchPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const sp = useSearchParams();
  const instance = sp.get('instance');
  return (
    <InteractiveSearch
      service="lidarr"
      subtitle={sp.get('title') ?? 'Album'}
      searchParams={{ albumId, ...(instance ? { instanceId: instance } : {}) }}
    />
  );
}
