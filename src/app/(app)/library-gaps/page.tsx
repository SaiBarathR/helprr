'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import Link from 'next/link';
import { FadeInImage } from '@/components/media/fade-in-image';
import { toast } from 'sonner';
import { formatDistanceToNow, isValid } from 'date-fns';
import {
  Search, Loader2, Plus, Tv, Film, CalendarClock, Clock, Hourglass, Layers, CheckCircle2, ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { isProtectedApiImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import { reportBulk } from '@/lib/bulk-fan-out';
import { useCan, useMe } from '@/components/permission-provider';
import { useBulkSelection } from '@/lib/use-bulk-selection';
import { BulkActionBar } from '@/components/media/bulk-action-bar';
import { SelectionCheck } from '@/components/media/selection-check';
import type {
  LibraryGapItem,
  LibraryGapSection,
  LibraryGapSectionId,
  LibraryGapsResponse,
} from '@/types';
import { searchUnits } from '@/lib/library-gaps';

const SECTION_META: Record<LibraryGapSectionId, { title: string; icon: LucideIcon; service: string }> = {
  missingSeasons: { title: 'Missing Seasons', icon: Tv, service: 'Sonarr' },
  newUpcoming: { title: 'New & Upcoming Seasons', icon: CalendarClock, service: 'Sonarr' },
  collectionGaps: { title: 'Collection Gaps', icon: Layers, service: 'Radarr' },
  overdue: { title: 'Overdue', icon: Clock, service: 'Sonarr / Radarr' },
  notReleased: { title: 'Not Yet Released', icon: Hourglass, service: 'Sonarr / Radarr' },
};

// One focused poster grid for the active category (mirrors the movies/series
// library grid breakpoints).
const SECTION_GRID =
  'grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2.5';

async function postCommand(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Command failed');
}

function GapCard({
  item,
  imagePriority,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  item: LibraryGapItem;
  imagePriority?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const selectable = item.search.kind !== 'none';
  const FallbackIcon = item.search.kind === 'movie' || item.tmdbId ? Film : Tv;

  // A collection-gap card opens the whole collection (showing owned/missing members) rather
  // than the single movie — but only when that page can actually load: TMDB configured + the
  // user has Discover access. Otherwise fall back to item.href (the movie Discover page).
  const canDiscover = useCan('discover.view');
  const tmdbConfigured = useMe()?.tmdbConfigured ?? false;
  const usesCollection = Boolean(tmdbConfigured && canDiscover && item.collectionTmdbId);
  const effectiveHref = usesCollection ? `/discover/collection/${item.collectionTmdbId}` : item.href;

  async function handleSearch() {
    setSearching(true);
    try {
      const s = item.search;
      if (s.kind === 'episodes') {
        await postCommand(`/api/sonarr/command?instanceId=${encodeURIComponent(s.instanceId)}`, { name: 'EpisodeSearch', episodeIds: s.episodeIds });
      } else if (s.kind === 'seasons') {
        // Fan out one SeasonSearch per season. allSettled (not all) so a single failed
        // season doesn't report the whole card as failed when others succeeded — mirrors
        // the bulk-search path.
        const results = await Promise.allSettled(
          s.seasonNumbers.map((seasonNumber) =>
            postCommand(`/api/sonarr/command?instanceId=${encodeURIComponent(s.instanceId)}`, { name: 'SeasonSearch', seriesId: s.sonarrSeriesId, seasonNumber })
          )
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed === results.length) throw new Error('all season searches failed');
        if (failed > 0) {
          toast.warning(`Search started — ${failed} of ${results.length} seasons failed`);
          return;
        }
      } else if (s.kind === 'movie') {
        await postCommand(`/api/radarr/command?instanceId=${encodeURIComponent(s.instanceId)}`, { name: 'MoviesSearch', movieIds: [s.radarrMovieId] });
      }
      toast.success('Search started');
    } catch {
      toast.error('Search failed');
    } finally {
      setSearching(false);
    }
  }

  // Corner action: in selection mode → checkbox for searchable items; otherwise
  // searchable → Search button; collection film (in TMDB, not Radarr) → Add cue; upcoming → Soon badge.
  let action: React.ReactNode;
  if (selectionMode) {
    action = selectable ? (
      <div className="pointer-events-none absolute right-1.5 top-1.5 z-10">
        <SelectionCheck selected={Boolean(selected)} />
      </div>
    ) : null;
  } else if (item.search.kind !== 'none') {
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
  } else if (usesCollection) {
    // The whole card links to the collection page — decorative cue signalling that, not a nested link.
    action = (
      <div
        aria-hidden="true"
        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-background/70 text-foreground backdrop-blur-sm"
      >
        <Layers className="h-3.5 w-3.5" />
      </div>
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
        <FadeInImage
          src={item.poster}
          alt={item.title}
          fill
          sizes="(max-width: 640px) 35vw, (max-width: 768px) 140px, (max-width: 1024px) 150px, (max-width: 1280px) 164px, (max-width: 1536px) 180px, 196px"
          priority={imagePriority}
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

  const ringClass = selectionMode && selectable && selected ? 'rounded-xl ring-2 ring-primary' : '';

  return (
    <div
      className={cn(
        'group relative w-full',
        selectionMode && !selectable && 'opacity-40'
      )}
    >
      {selectionMode && selectable ? (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={Boolean(selected)}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${item.title}`}
          className={cn('block w-full text-left', ringClass)}
        >
          {poster}
        </button>
      ) : effectiveHref && !selectionMode ? (
        <Link href={effectiveHref} className="block">{poster}</Link>
      ) : (
        <div className={ringClass}>{poster}</div>
      )}
      {action}
    </div>
  );
}

function SectionTile({
  section,
  active,
  onSelect,
}: {
  section: LibraryGapSection;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = SECTION_META[section.id];
  const Icon = meta.icon;
  const empty = section.available && section.count === 0;
  const disabled = !section.available || empty;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'min-w-[8.5rem] shrink-0 rounded-xl border bg-card p-3 text-left transition-colors',
        active ? 'border-primary/60 bg-primary/10' : 'hover:bg-accent/40',
        disabled && 'opacity-45'
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', active ? 'text-primary' : 'text-muted-foreground')} />
        <span
          className="text-lg font-semibold tabular-nums leading-none"
          style={{ fontFamily: 'var(--hpr-font-display)' }}
        >
          {section.available ? section.count : '—'}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground leading-tight">
        {meta.title}
      </p>
      {!section.available && (
        <p className="text-[10px] text-muted-foreground/70">
          {section.error ? `${meta.service} unavailable` : `${meta.service} not connected`}
        </p>
      )}
    </button>
  );
}

export default function LibraryGapsPage() {
  const gapsQuery = useQuery({
    queryKey: queryKeys.libraryGaps(),
    queryFn: jsonFetcher<LibraryGapsResponse>('/api/library-gaps'),
  });
  const data = gapsQuery.data ?? null;
  const loading = gapsQuery.isLoading;
  const error = !data && gapsQuery.isError;
  const canSearch = useCan('activity.manage');
  const {
    selectionMode, selectedKeys, count, toggle, selectMany, clear, enter, exit,
  } = useBulkSelection();
  const [activeId, setActiveId] = useState<LibraryGapSectionId | null>(null);
  const [searchingAll, setSearchingAll] = useState(false);

  // Resolve the active section: the picked tile if it still has gaps, else the
  // first section that does.
  const activeSection = useMemo(() => {
    if (!data) return null;
    const withGaps = data.sections.filter((s) => s.available && s.count > 0);
    return withGaps.find((s) => s.id === activeId) ?? withGaps[0] ?? null;
  }, [data, activeId]);

  // Selection is scoped to the visible section — drop it whenever the active
  // section changes, whether from a tile click or the auto-fallback after a
  // refetch empties the current one.
  const activeSectionId = activeSection?.id ?? null;
  useEffect(() => {
    exit();
  }, [activeSectionId, exit]);

  // The searchable gaps in the active section — drive select-all and "Search all".
  const searchableItems = useMemo(
    () => (activeSection ? activeSection.items.filter((i) => i.search.kind !== 'none') : []),
    [activeSection]
  );
  const searchableByKey = useMemo(
    () => new Map(searchableItems.map((i) => [i.key, i])),
    [searchableItems]
  );

  const allSelected = searchableItems.length > 0 && searchableItems.every((i) => selectedKeys.has(i.key));
  const toggleSelectAll = useCallback(() => {
    if (allSelected) clear();
    else selectMany(searchableItems.map((i) => i.key));
  }, [allSelected, clear, selectMany, searchableItems]);

  // Fan out searches by service/instance/kind: episodes and movies batch into
  // a single array command per instance; seasons have no batch form, so one each.
  const searchItems = useCallback(async (items: LibraryGapItem[]) => {
    const episodesByInstance = new Map<string, number[]>();
    const moviesByInstance = new Map<string, number[]>();
    const seasons: { instanceId: string; seriesId: number; seasonNumber: number }[] = [];

    for (const item of items) {
      const search = item.search;
      if (search.kind === 'episodes') {
        const list = episodesByInstance.get(search.instanceId) ?? [];
        list.push(...search.episodeIds);
        episodesByInstance.set(search.instanceId, list);
      } else if (search.kind === 'movie') {
        const list = moviesByInstance.get(search.instanceId) ?? [];
        list.push(search.radarrMovieId);
        moviesByInstance.set(search.instanceId, list);
      } else if (search.kind === 'seasons') {
        for (const seasonNumber of search.seasonNumbers) {
          seasons.push({ instanceId: search.instanceId, seriesId: search.sonarrSeriesId, seasonNumber });
        }
      }
    }

    const calls: Promise<void>[] = [];
    for (const [instanceId, episodeIds] of episodesByInstance) {
      calls.push(postCommand(`/api/sonarr/command?instanceId=${encodeURIComponent(instanceId)}`, { name: 'EpisodeSearch', episodeIds }));
    }
    for (const [instanceId, movieIds] of moviesByInstance) {
      calls.push(postCommand(`/api/radarr/command?instanceId=${encodeURIComponent(instanceId)}`, { name: 'MoviesSearch', movieIds }));
    }
    for (const s of seasons) {
      calls.push(postCommand(`/api/sonarr/command?instanceId=${encodeURIComponent(s.instanceId)}`, { name: 'SeasonSearch', seriesId: s.seriesId, seasonNumber: s.seasonNumber }));
    }

    // Count what's actually being searched (a grouped card covers many units).
    const total =
      [...episodesByInstance.values()].reduce((n, list) => n + list.length, 0) +
      [...moviesByInstance.values()].reduce((n, list) => n + list.length, 0) +
      seasons.length;
    const results = await Promise.allSettled(calls);
    const failed = results.filter((r) => r.status === 'rejected').length;
    const ok = calls.length - failed;
    if (failed && ok === 0) toast.error(`Search failed for ${failed} batch${failed === 1 ? '' : 'es'}`);
    else if (failed) reportBulk('Search started for', ok, failed, { noun: 'batch', pluralNoun: 'batches' });
    else toast.success(`Search started for ${total} item${total === 1 ? '' : 's'}`);
    return failed === 0;
  }, []);

  const handleBulkSearch = useCallback(async () => {
    const items = [...selectedKeys]
      .map((key) => searchableByKey.get(key))
      .filter((i): i is LibraryGapItem => Boolean(i));
    const ok = await searchItems(items);
    if (ok) exit();
  }, [selectedKeys, searchableByKey, searchItems, exit]);

  const handleSearchAll = useCallback(async () => {
    setSearchingAll(true);
    try {
      await searchItems(searchableItems);
    } finally {
      setSearchingAll(false);
    }
  }, [searchItems, searchableItems]);

  if (loading) return <PageSpinner />;

  if (error || !data) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">Failed to load library gaps</div>
    );
  }

  const allComplete = data.sections.every((s) => s.available && s.count === 0);

  if (allComplete) {
    return (
      <div className="animate-content-in py-16 text-center text-muted-foreground">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
        <p className="text-sm">No gaps — your library is complete</p>
      </div>
    );
  }

  const activeMeta = activeSection ? SECTION_META[activeSection.id] : null;
  // How many seasons/episodes/movies the shown cards actually cover — when the
  // server truncated the section, the count badge exceeds this.
  const shownUnits = activeSection
    ? activeSection.items.reduce((n, item) => n + searchUnits(item), 0)
    : 0;
  const truncated = activeSection ? activeSection.count > shownUnits : false;

  return (
    <div className="animate-content-in space-y-4">
      <div className="page-toolbar page-toolbar-flush app-chrome-bar bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {data.sections.map((section) => (
            <SectionTile
              key={section.id}
              section={section}
              active={activeSection?.id === section.id}
              onSelect={() => setActiveId(section.id)}
            />
          ))}
        </div>
      </div>

      {/* Not allComplete (an unavailable service keeps that false) yet nothing
          selectable — every connected service reports zero gaps. */}
      {!activeSection && (
        <div className="py-16 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No gaps in the connected services</p>
          <p className="text-xs">Sections marked unavailable couldn&apos;t be checked.</p>
        </div>
      )}

      {activeSection && activeMeta && (
        <section className="space-y-2.5 animate-rail-in" key={activeSection.id}>
          <div className="flex min-h-9 items-center gap-2 px-0.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {activeMeta.title}
            </h2>
            <Badge variant="secondary" className="text-[10px]">{activeSection.count}</Badge>
            {truncated && (
              <span className="text-[11px] text-muted-foreground">
                showing first {shownUnits} of {activeSection.count}
              </span>
            )}
            {canSearch && searchableItems.length > 0 && !selectionMode && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSearchAll}
                  disabled={searchingAll}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
                >
                  {searchingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Search all
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={enter}
                      className="p-2 flex items-center justify-center rounded-lg transition-colors hover:bg-accent active:bg-accent/80"
                      aria-label="Select gaps to search"
                    >
                      <ListChecks className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Select to search</TooltipContent>
                </Tooltip>
              </div>
            )}
            {selectionMode && (
              <button
                type="button"
                onClick={exit}
                className="ml-auto text-xs font-medium text-primary hover:underline"
              >
                Cancel
              </button>
            )}
          </div>

          <div className={SECTION_GRID}>
            {activeSection.items.map((item, i) => (
              <GapCard
                key={item.key}
                item={item}
                imagePriority={i < 8}
                selectionMode={selectionMode}
                selected={selectedKeys.has(item.key)}
                onToggleSelect={() => toggle(item.key)}
              />
            ))}
          </div>
        </section>
      )}

      {selectionMode && (
        <>
          {/* Spacer so the floating bar doesn't cover the last row. */}
          <div aria-hidden className="h-24" />
          <BulkActionBar
            count={count}
            allSelected={allSelected}
            onToggleSelectAll={toggleSelectAll}
            onCancel={exit}
            variant="search"
            canSearch={canSearch}
            onSearch={handleBulkSearch}
          />
        </>
      )}
    </div>
  );
}
