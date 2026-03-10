'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Plus } from 'lucide-react';
import type { DiscoverDetail } from '@/types';

interface DiscoverAddButtonProps {
  detail: DiscoverDetail;
}

function buildAddHref(detail: DiscoverDetail): string | null {
  if (detail.addTarget.exists && detail.addTarget.id) {
    return detail.addTarget.service === 'radarr'
      ? `/movies/${detail.addTarget.id}`
      : `/series/${detail.addTarget.id}`;
  }

  if (detail.mediaType === 'movie') {
    const params = new URLSearchParams();
    params.set('term', detail.title);
    params.set('tmdbId', String(detail.tmdbId));
    return `/movies/add?${params.toString()}`;
  }

  const params = new URLSearchParams();
  params.set('term', detail.title);
  params.set('tmdbId', String(detail.tmdbId));
  if (detail.tvdbId) params.set('tvdbId', String(detail.tvdbId));
  params.set('seriesType', 'standard');
  return `/series/add?${params.toString()}`;
}

export function DiscoverAddButton({ detail }: DiscoverAddButtonProps) {
  const href = buildAddHref(detail);
  if (!href) return null;

  if (detail.addTarget.exists) {
    return (
      <div className="px-4">
        <Button asChild variant="secondary" className="w-full h-11 gap-2">
          <Link href={href}>
            <Badge className="bg-green-600/90 text-white gap-1">
              <Check className="h-3 w-3" />
              In Library
            </Badge>
            <span>Open in {detail.addTarget.service === 'radarr' ? 'Radarr' : 'Sonarr'}</span>
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4">
      <Button asChild className="w-full h-11 gap-2">
        <Link href={href}>
          <Plus className="h-4 w-4" />
          Add to {detail.mediaType === 'movie' ? 'Radarr' : 'Sonarr'}
        </Link>
      </Button>
    </div>
  );
}
