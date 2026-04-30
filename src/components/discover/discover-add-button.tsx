'use client';

import Link from 'next/link';
import { ArrowUpRight, Plus } from 'lucide-react';
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
      <Link
        href={href}
        className="group relative flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/40 backdrop-blur-sm px-5 py-4 transition-all hover:border-emerald-500/40 hover:bg-emerald-950/10 press-feedback"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
          </span>
          <div className="min-w-0">
            <p className="tracked-caps text-emerald-400/90">In Library</p>
            <p className="font-display font-medium text-lg leading-tight">
              Open in {targetService}
            </p>
          </div>
        </div>
        <ArrowUpRight
          className="h-5 w-5 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
          strokeWidth={1.5}
        />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="group relative flex items-center justify-between gap-4 rounded-lg overflow-hidden border border-foreground/15 bg-foreground text-background px-5 py-4 cta-sheen press-feedback transition-shadow shadow-[0_8px_30px_-10px_rgba(0,0,0,0.4)] hover:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.55)]"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/10 ring-1 ring-background/20">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <p className="tracked-caps text-background/55">New Request</p>
          <p className="font-display font-medium text-lg leading-tight">
            Add to {service}
          </p>
        </div>
      </div>
      <ArrowUpRight
        className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        strokeWidth={1.5}
      />
    </Link>
  );
}
