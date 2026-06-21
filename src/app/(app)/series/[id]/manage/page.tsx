'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { ManageMediaFlow } from '@/components/media/manage-media-flow';

export default function SeriesManagePage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  return (
    <ManageMediaFlow
      service="sonarr"
      mediaId={Number(id)}
      mediaTitle={sp.get('title') ?? 'Series'}
      instanceId={sp.get('instance') ?? undefined}
    />
  );
}
