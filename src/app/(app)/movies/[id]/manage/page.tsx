'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { ManageMediaFlow } from '@/components/media/manage-media-flow';

export default function MovieManagePage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  return (
    <ManageMediaFlow
      service="radarr"
      mediaId={Number(id)}
      mediaTitle={sp.get('title') ?? 'Movie'}
      instanceId={sp.get('instance') ?? undefined}
    />
  );
}
