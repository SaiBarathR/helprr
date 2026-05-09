'use client';

import Link from 'next/link';
import { Plus, Sparkles } from 'lucide-react';
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

  const service = detail.mediaType === 'movie' ? 'Radarr' : 'Sonarr';

  if (detail.addTarget.exists) {
    const targetService = detail.addTarget.service === 'radarr' ? 'Radarr' : 'Sonarr';
    return (
      <div className="absolute top-1 right-1 md:top-2 md:right-1.5 hero-meta-fade">
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 rounded-full bg-black/55 backdrop-blur-md text-white px-3 py-1.5 text-[11px] font-medium hover:bg-black/70 transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="tracking-widest uppercase">Open in {targetService}</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="absolute top-1 right-1 md:top-2 md:right-2 hero-meta-fade">
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 rounded-full bg-black/25 backdrop-blur-md text-white px-2 py-1.5 text-[11px] font-medium hover:bg-black/70 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        <span className="tracking-widest">
          Add to  {service}
        </span>
      </Link>
    </div>
  );
}
