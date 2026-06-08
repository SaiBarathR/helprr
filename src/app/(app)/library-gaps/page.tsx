'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { formatDistanceToNow, isValid } from 'date-fns';
import {
  Search, Loader2, Plus, Tv, Film, CalendarClock, Clock, Layers, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { isProtectedApiImageSrc } from '@/lib/image';
import type {
  LibraryGapItem,
  LibraryGapSection,
  LibraryGapSectionId,
  LibraryGapsResponse,
} from '@/types';

const SECTION_META: Record<LibraryGapSectionId, { title: string; icon: LucideIcon; service: string }> = {
  missingSeasons: { title: 'Missing Seasons', icon: Tv, service: 'Sonarr' },
  newUpcoming: { title: 'New & Upcoming Seasons', icon: CalendarClock, service: 'Sonarr' },
  collectionGaps: { title: 'Collection Gaps', icon: Layers, service: 'Radarr' },
  overdue: { title: 'Overdue', icon: Clock, service: 'Sonarr / Radarr' },
};

// Mirrors the Discover rail card breakpoints so every gap section scrolls horizontally.
const RAIL_CARD =
  'min-w-[110px] w-[110px] sm:min-w-[140px] sm:w-[140px] md:min-w-[150px] md:w-[150px] lg:min-w-[164px] lg:w-[164px] xl:min-w-[180px] xl:w-[180px] 2xl:min-w-[196px] 2xl:w-[196px]';

async function postCommand(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Command failed');
}

function GapCard({ item }: { item: LibraryGapItem }) {
  const [searching, setSearching] = useState(false);
  const FallbackIcon = item.search.kind === 'movie' || item.tmdbId ? Film : Tv;

  async function handleSearch() {
    setSearching(true);
    try {
      const s = item.search;
      if (s.kind === 'episode') {
        await postCommand('/api/sonarr/command', { name: 'EpisodeSearch', episodeIds: [s.episodeId] });
      } else if (s.kind === 'season') {
        await postCommand('/api/sonarr/command', { name: 'SeasonSearch', seriesId: s.sonarrSeriesId, seasonNumber: s.seasonNumber });
      } else if (s.kind === 'movie') {
        await postCommand('/api/radarr/command', { name: 'MoviesSearch', movieIds: [s.radarrMovieId] });
      }
      toast.success('Search started');
    } catch {
      toast.error('Search failed');
    } finally {
      setSearching(false);
    }
  }

  // Corner action: searchable → Search button; collection film (in TMDB, not Radarr) → Add cue; upcoming → Soon badge.
  let action: React.ReactNode;
  if (item.search.kind !== 'none') {
    action = (
      <button
        type="button"
        onClick={handleSearch}
        disabled={searching}
        aria-label="Search"
        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-background/70 text-foreground backdrop-blur-sm transition-colors hover:bg-background/90 disabled:opacity-60"
      >
        {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
      </button>
    );
  } else if (item.tmdbId && item.href) {
    // The whole card already links to item.href (a Discover detail page where it can be added),
    // so this is a decorative "addable" cue — not a second, nested link.
    action = (
      <div
        aria-hidden="true"
        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-background/70 text-foreground backdrop-blur-sm"
      >
        <Plus className="h-3.5 w-3.5" />
      </div>
    );
  } else {
    action = (
      <Badge variant="outline" className="absolute right-1.5 top-1.5 z-10 text-[10px]">Soon</Badge>
    );
  }

  // Guard against malformed API dates: formatDistanceToNow throws on an invalid Date.
  const dateObj = item.date ? new Date(item.date) : null;
  const relativeDate = dateObj && isValid(dateObj) ? formatDistanceToNow(dateObj, { addSuffix: true }) : null;
  const meta = [item.subtitle ?? (item.year ? String(item.year) : null), relativeDate]
    .filter(Boolean)
    .join(' · ');

  const poster = (
    <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-border/40 bg-muted/60">
      {item.poster ? (
        <Image
          src={item.poster}
          alt={item.title}
          fill
          sizes="(max-width: 640px) 35vw, (max-width: 768px) 140px, (max-width: 1024px) 150px, (max-width: 1280px) 164px, (max-width: 1536px) 180px, 196px"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          unoptimized={isProtectedApiImageSrc(item.poster)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <FallbackIcon className="h-7 w-7" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background/75 via-background/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <p className="line-clamp-2 text-xs font-medium leading-tight text-foreground">{item.title}</p>
        {meta && <p className="mt-1 line-clamp-1 text-[10px] text-foreground/80">{meta}</p>}
      </div>
    </div>
  );

  return (
    <div className={`group relative shrink-0 ${RAIL_CARD}`}>
      {item.href ? <Link href={item.href} className="block">{poster}</Link> : poster}
      {action}
    </div>
  );
}

function GapSectionView({ section }: { section: LibraryGapSection }) {
  const meta = SECTION_META[section.id];
  const Icon = meta.icon;

  // Omit available-but-empty sections to keep the page focused.
  if (section.available && section.count === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{meta.title}</h2>
        {section.available ? (
          <Badge variant="secondary" className="text-[10px]">{section.count}</Badge>
        ) : section.error ? (
          <Badge variant="outline" className="text-[10px]">{meta.service} unavailable</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">{meta.service} not connected</Badge>
        )}
      </div>
      {section.available && (
        <div className="-mx-2 flex gap-2.5 overflow-x-auto px-2 pb-1 scrollbar-hide animate-rail-in md:-mx-6 md:px-6">
          {section.items.map((item) => (
            <GapCard key={item.key} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function LibraryGapsPage() {
  const [data, setData] = useState<LibraryGapsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/library-gaps');
        if (!res.ok) throw new Error('Failed');
        const json = (await res.json()) as LibraryGapsResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <PageSpinner />;

  if (error || !data) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Failed to load library gaps</div>
    );
  }

  const allComplete = data.sections.every((s) => s.available && s.count === 0);

  return (
    <div className="animate-content-in">
      {allComplete ? (
        <div className="py-16 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No gaps — your library is complete</p>
        </div>
      ) : (
        <div className="space-y-5">
          {data.sections.map((section) => (
            <GapSectionView key={section.id} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}
