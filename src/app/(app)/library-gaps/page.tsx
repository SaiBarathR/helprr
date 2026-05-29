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
import { Button } from '@/components/ui/button';
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

async function postCommand(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Command failed');
}

function Thumb({ item, fallback: Icon }: { item: LibraryGapItem; fallback: LucideIcon }) {
  if (item.poster) {
    return (
      <div className="relative h-[54px] w-9 shrink-0 overflow-hidden rounded bg-muted">
        <Image
          src={item.poster}
          alt=""
          fill
          sizes="36px"
          className="object-cover"
          unoptimized={isProtectedApiImageSrc(item.poster)}
        />
      </div>
    );
  }
  return (
    <div className="flex h-[54px] w-9 shrink-0 items-center justify-center rounded bg-muted">
      <Icon className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function GapRow({ item }: { item: LibraryGapItem }) {
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

  // Trailing action: searchable item → Search button; collection film (not in Radarr) → Add link; upcoming → badge.
  let action: React.ReactNode;
  if (item.search.kind !== 'none') {
    action = (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0"
        onClick={handleSearch}
        disabled={searching}
        aria-label="Search"
      >
        {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
      </Button>
    );
  } else if (item.tmdbId && item.href) {
    action = (
      <Button asChild size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0">
        <Link href={item.href} aria-label="Add from Discover">
          <Plus className="h-3.5 w-3.5" />
        </Link>
      </Button>
    );
  } else {
    action = (
      <Badge variant="outline" className="shrink-0 text-[10px]">Soon</Badge>
    );
  }

  const titleEl = <p className="truncate text-sm">{item.title}</p>;

  // Guard against malformed API dates: formatDistanceToNow throws on an invalid Date.
  const dateObj = item.date ? new Date(item.date) : null;
  const relativeDate = dateObj && isValid(dateObj) ? formatDistanceToNow(dateObj, { addSuffix: true }) : null;

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50 active:bg-muted/50">
      {item.href ? (
        // Decorative: the title link below navigates to the same target, so keep this
        // text-less thumbnail link out of the a11y tree / tab order to avoid a duplicate.
        <Link href={item.href} className="shrink-0" aria-hidden="true" tabIndex={-1}>
          <Thumb item={item} fallback={FallbackIcon} />
        </Link>
      ) : (
        <Thumb item={item} fallback={FallbackIcon} />
      )}
      <div className="min-w-0 flex-1">
        {item.href ? <Link href={item.href} className="block">{titleEl}</Link> : titleEl}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {item.subtitle && <span className="truncate">{item.subtitle}</span>}
          {relativeDate && <span className="shrink-0">{relativeDate}</span>}
        </div>
      </div>
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
    <section className="space-y-1">
      <div className="flex items-center gap-2 px-3 pt-1">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{meta.title}</h2>
        {section.available ? (
          <Badge variant="secondary" className="text-[10px]">{section.count}</Badge>
        ) : section.error ? (
          <Badge variant="outline" className="text-[10px]">{meta.service} unavailable</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">{meta.service} not connected</Badge>
        )}
      </div>
      {section.available && (
        <div className="space-y-0.5">
          {section.items.map((item) => (
            <GapRow key={item.key} item={item} />
          ))}
          {section.count > section.items.length && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">
              +{section.count - section.items.length} more
            </p>
          )}
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
      <div className="mb-4 px-3">
        <h1 className="text-lg font-semibold">Library Gaps</h1>
        <p className="text-sm text-muted-foreground">
          Missing seasons, collection gaps, and overdue items across your library.
        </p>
      </div>

      {allComplete ? (
        <div className="py-16 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No gaps — your library is complete</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.sections.map((section) => (
            <GapSectionView key={section.id} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}
