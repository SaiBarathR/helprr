'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { DEFAULT_DISCOVER_FILTERS, type DiscoverFiltersState, useUIStore } from '@/lib/store';
import { ActiveFilterBar, type ActiveFilter } from '@/components/ui/active-filter-bar';
import type { DiscoverItem, DiscoverSection } from '@/types';
import type { DiscoverLayoutSection } from '@/lib/discover-layout-config';
import { useIsMobile } from '@/hooks/use-is-mobile';
import {
  SECTION_TO_BROWSE,
  discoverFilterChips,
  discoverLinkQuery,
  discoverLinkView,
  toReleaseState,
  type DiscoverView,
} from './_components/link-view';
import { discoverSortPresetNote, isFixedListSection } from '@/lib/discover-sort-presets';
import { useHistoryEntryState } from '@/lib/hooks/use-history-entry-state';
import {
  RateLimitError,
  computeCarouselItemLimit,
  countActiveAdvancedFilters,
  isDefaultFilters,
  type RateLimitInfo,
} from './_components/discover-data';
import { useDiscoverHome } from './_components/use-discover-home';
import { useDiscoverGrid } from './_components/use-discover-grid';
import { DiscoverToolbar } from './_components/discover-toolbar';
import { DiscoverHomeSections } from './_components/discover-home-sections';
import { DiscoverResults } from './_components/discover-results';
import { DiscoverFilterSheet } from './_components/discover-filter-sheet';


export default function DiscoverPage() {
  const searchParams = useSearchParams();
  const savedContentType = useUIStore((s) => s.discoverContentType);
  const setDiscoverContentType = useUIStore((s) => s.setDiscoverContentType);
  const savedSort = useUIStore((s) => s.discoverSort);
  const setDiscoverSort = useUIStore((s) => s.setDiscoverSort);
  const savedSortDirection = useUIStore((s) => s.discoverSortDirection);
  const setDiscoverSortDirection = useUIStore((s) => s.setDiscoverSortDirection);
  const savedFilters = useUIStore((s) => s.discoverFilters);
  const setDiscoverFilters = useUIStore((s) => s.setDiscoverFilters);

  const isMobile = useIsMobile();
  const [typedQuery, setQuery] = useRouteViewState<string | null>('query', null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // A grid opened only by a pill (or typing, then clearing, a search) is for
  // that visit only: kept per history entry, it comes back with Back, while a
  // new plain visit opens on the home carousels.
  const [savedManualBrowseMode, setSavedManualBrowseMode] = useHistoryEntryState('helprr:discoverManualBrowse', false);
  const [savedSectionKey, setSavedSectionKey] = useRouteViewState<string | null>('activeSectionKey', null);

  // A link (cast credit, widget "View all", genre/studio/network chip, search)
  // opens its own view. It applies to that URL only and never touches the saved
  // filters, so following one can't leave every later plain visit filtered.
  // Changes made on it stay with it too; route view state is keyed by the full
  // URL, so they survive back-navigation and plain /discover keeps its own.
  const searchParamsKey = searchParams.toString();
  const linkView = useMemo(() => discoverLinkView(new URLSearchParams(searchParamsKey)), [searchParamsKey]);
  const [linkEdits, setLinkEdits] = useRouteViewState<DiscoverView | null>('linkView', null);
  // A search link's `?q=` fills the box until something is typed on that URL.
  // It is only the fallback: typed text is never re-read from the URL, so an
  // edited or cleared box stays that way.
  const linkQuery = useMemo(() => discoverLinkQuery(new URLSearchParams(searchParamsKey)), [searchParamsKey]);
  const query = typedQuery ?? linkQuery;
  const savedView = useMemo<DiscoverView>(() => ({
    contentType: savedContentType,
    sort: savedSort,
    sortDirection: savedSortDirection,
    filters: savedFilters,
    section: savedSectionKey,
    manualBrowseMode: savedManualBrowseMode,
    person: null,
    names: {},
  }), [savedContentType, savedSort, savedSortDirection, savedFilters, savedSectionKey, savedManualBrowseMode]);
  const view = linkView ? (linkEdits ?? linkView) : savedView;
  const {
    contentType: discoverContentType,
    sort: discoverSort,
    sortDirection: discoverSortDirection,
    filters: discoverFilters,
    section: activeSectionKey,
    manualBrowseMode,
    person: personFilter,
  } = view;

  const updateView = useCallback((patch: Partial<DiscoverView>) => {
    if (linkView) {
      setLinkEdits((current) => ({ ...(current ?? linkView), ...patch }));
      return;
    }
    if (patch.contentType !== undefined) setDiscoverContentType(patch.contentType);
    if (patch.sort !== undefined) setDiscoverSort(patch.sort);
    if (patch.sortDirection !== undefined) setDiscoverSortDirection(patch.sortDirection);
    if (patch.filters !== undefined) setDiscoverFilters(patch.filters);
    if (patch.section !== undefined) setSavedSectionKey(patch.section);
    if (patch.manualBrowseMode !== undefined) setSavedManualBrowseMode(patch.manualBrowseMode);
  }, [
    linkView,
    setLinkEdits,
    setDiscoverContentType,
    setDiscoverSort,
    setDiscoverSortDirection,
    setDiscoverFilters,
    setSavedSectionKey,
    setSavedManualBrowseMode,
  ]);

  const [draftFilters, setDraftFilters] = useState<DiscoverFiltersState>(discoverFilters);
  const [draftSort, setDraftSort] = useState(discoverSort);
  const [draftSortDirection, setDraftSortDirection] = useState(discoverSortDirection);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number | null>(null);
  const [carouselItemLimit] = useState(computeCarouselItemLimit);

  const router = useRouter();

  const hasAdvancedFilters = useMemo(() => !isDefaultFilters(discoverFilters), [discoverFilters]);
  const activeAdvancedFilterCount = useMemo(
    () => countActiveAdvancedFilters(discoverFilters),
    [discoverFilters]
  );


  const gridMode = useMemo(() => {
    return Boolean(
      manualBrowseMode ||
      query.trim()
      || hasAdvancedFilters
      || activeSectionKey
      || discoverSort !== 'trending'
      || discoverContentType !== 'all'
      || personFilter
    );
  }, [manualBrowseMode, query, hasAdvancedFilters, activeSectionKey, discoverSort, discoverContentType, personFilter]);

  const {
    sectionsQuery,
    filtersMetaQuery,
    customResults,
    filtersMeta,
    layoutConfig,
    loadingSections,
    visibleSections,
    heroItems,
    customCarouselItems,
    customCarouselLoading,
  } = useDiscoverHome(discoverContentType, carouselItemLimit);

  const { gridQuery, items } = useDiscoverGrid({
    query,
    discoverContentType,
    discoverSort,
    discoverSortDirection,
    discoverFilters,
    activeSectionKey,
    personFilter,
    gridMode,
  });

  const { fetchNextPage, refetch: refetchGrid, isFetchingNextPage, isLoading: gridIsLoading } = gridQuery;
  const hasNextPage = gridQuery.hasNextPage;
  const loadingItems = gridIsLoading;
  const loadingMore = isFetchingNextPage;

  // TMDB rate-limit banner, derived from query state (replaces the rateLimitInfo
  // useState + applyRateLimit + per-fetch set/clear). Any discover query carrying
  // a RateLimitError shows the banner; it clears when that query next succeeds
  // (error/failureReason reset). failureReason covers infinite-scroll next-page
  // 429s, where the query keeps its data and status stays 'success'.
  const rateLimitInfo: RateLimitInfo | null = (() => {
    const rl = (e: unknown) => (e instanceof RateLimitError ? e : null);
    const found =
      rl(sectionsQuery.error) ?? rl(sectionsQuery.failureReason) ??
      rl(filtersMetaQuery.error) ?? rl(filtersMetaQuery.failureReason) ??
      // Only let the grid drive the banner while it's the active view: a disabled
      // grid (sections view) keeps its last RateLimitError, which would otherwise
      // make the banner linger after returning from a rate-limited browse.
      (gridMode ? rl(gridQuery.error) ?? rl(gridQuery.failureReason) : null) ??
      customResults.reduce<RateLimitError | null>(
        (acc, r) => acc ?? rl(r.error) ?? rl(r.failureReason),
        null,
      );
    if (!found) return null;
    const data = found.payload as {
      error?: string;
      retryAfterSeconds?: number | null;
      retryAt?: string | null;
    } | null;
    return {
      message: data?.error || 'TMDB rate limit reached',
      retryAfterSeconds: Number.isFinite(data?.retryAfterSeconds as number)
        ? Math.max(1, Number(data?.retryAfterSeconds))
        : null,
      retryAt: data?.retryAt || null,
    };
  })();

  // Countdown for the rate-limit banner: it restarts from each new retry-after
  // value (set while rendering), and the interval only ticks it down.
  const retryAfterSeconds = rateLimitInfo?.retryAfterSeconds ?? null;
  const [countdownFrom, setCountdownFrom] = useState<number | null>(null);
  if (retryAfterSeconds !== countdownFrom) {
    setCountdownFrom(retryAfterSeconds);
    setRateLimitCountdown(retryAfterSeconds);
  }
  useEffect(() => {
    if (!retryAfterSeconds) return;
    const timer = setInterval(() => {
      setRateLimitCountdown((current) => {
        if (current == null) return null;
        return current <= 0 ? 0 : current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [retryAfterSeconds]);

  // Opening the sheet seeds the drafts (handleOpenFilters); while it is open,
  // they follow the committed filters when those change. Adjusted while rendering.
  const [draftsFollow, setDraftsFollow] = useState({ discoverFilters, discoverSort, discoverSortDirection });
  if (
    draftsFollow.discoverFilters !== discoverFilters
    || draftsFollow.discoverSort !== discoverSort
    || draftsFollow.discoverSortDirection !== discoverSortDirection
  ) {
    setDraftsFollow({ discoverFilters, discoverSort, discoverSortDirection });
    if (filtersOpen) {
      setDraftFilters(discoverFilters);
      setDraftSort(discoverSort);
      setDraftSortDirection(discoverSortDirection);
    }
  }

  const handleOpenItem = useCallback((item: DiscoverItem) => {
    router.push(`/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`);
  }, [router]);

  const handleOpenFilters = useCallback(() => {
    setDraftFilters(discoverFilters);
    setDraftSort(discoverSort);
    setDraftSortDirection(discoverSortDirection);
    setFiltersOpen(true);
  }, [discoverFilters, discoverSort, discoverSortDirection]);

  const handleSelectContentType = useCallback((type: 'all' | 'movie' | 'show') => {
    // Clicking the already-active content type while browsing forces a refresh.
    if (discoverContentType === type && gridMode) {
      void refetchGrid();
      return;
    }
    updateView({ contentType: type, section: null, manualBrowseMode: true });
  }, [discoverContentType, gridMode, refetchGrid, updateView]);

  const handleSelectSort = useCallback((sort: string) => {
    if (discoverSort === sort && gridMode) {
      void refetchGrid();
      return;
    }
    updateView({ sort, section: null, manualBrowseMode: true });
  }, [discoverSort, gridMode, refetchGrid, updateView]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!gridMode) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !loadingMore && !loadingItems) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [gridMode, hasNextPage, loadingMore, loadingItems, fetchNextPage, items.length]);

  const goToDiscoverHome = useCallback(() => {
    // Leaving a link's view returns to the saved Discover instead of resetting it.
    if (linkView) {
      router.replace('/discover');
      return;
    }
    setDiscoverFilters({ ...DEFAULT_DISCOVER_FILTERS });
    setDiscoverSort('trending');
    setDiscoverSortDirection('desc');
    setDiscoverContentType('all');
    setSavedSectionKey(null);
    setQuery('');
    setSavedManualBrowseMode(false);
  }, [linkView, router, setDiscoverFilters, setDiscoverSort, setDiscoverSortDirection, setDiscoverContentType, setSavedSectionKey, setQuery, setSavedManualBrowseMode]);

  const handleSeeAll = useCallback((section: DiscoverSection) => {
    const mapped = SECTION_TO_BROWSE[section.key];
    updateView({
      section: section.key,
      manualBrowseMode: true,
      ...(mapped && {
        sort: mapped.sort,
        contentType: mapped.contentType,
        sortDirection: mapped.sort === 'upcoming' ? 'asc' : 'desc',
      }),
    });
  }, [updateView]);

  const handleSeeAllCustom = useCallback((layoutSection: DiscoverLayoutSection) => {
    const f = layoutSection.filters;
    if (!f) return;
    const ct: 'all' | 'movie' | 'show' =
      f.contentType === 'movie' || f.contentType === 'show' ? f.contentType : 'all';

    updateView({
      section: null,
      contentType: ct,
      sort: f.sortBy,
      sortDirection: f.sortOrder,
      manualBrowseMode: true,
      filters: {
      ...DEFAULT_DISCOVER_FILTERS,
      genres: f.genres ?? [],
      providers: f.providers ?? [],
      networks: f.networks ?? [],
      companies: f.companies ?? [],
      yearFrom: f.yearFrom ?? '',
      yearTo: f.yearTo ?? '',
      runtimeMin: f.runtimeMin ?? '',
      runtimeMax: f.runtimeMax ?? '',
      ratingMin: f.ratingMin ?? '',
      ratingMax: f.ratingMax ?? '',
      voteCountMin: f.voteCountMin ?? '',
      language: f.language ?? '',
      region: f.region ?? DEFAULT_DISCOVER_FILTERS.region,
      releaseState: toReleaseState(f.releaseState),
      },
    });
  }, [updateView]);

  const pickGenre = useCallback((genreId: number, type: 'movie' | 'show') => {
    updateView({
      filters: {
        ...discoverFilters,
        genres: discoverFilters.genres.includes(genreId)
          ? discoverFilters.genres
          : [...discoverFilters.genres, genreId],
      },
      contentType: type,
      section: null,
      manualBrowseMode: true,
    });
  }, [updateView, discoverFilters]);

  const pickProvider = useCallback((providerId: number, type: 'movie' | 'show') => {
    updateView({
      filters: {
        ...discoverFilters,
        providers: discoverFilters.providers.includes(providerId)
          ? discoverFilters.providers
          : [...discoverFilters.providers, providerId],
      },
      contentType: type,
      section: null,
      manualBrowseMode: true,
    });
  }, [updateView, discoverFilters]);

  const resetFilters = useCallback(() => {
    goToDiscoverHome();
  }, [goToDiscoverHome]);

  // Search keeps only the content type, and the fixed TMDB list sections
  // ignore the filters, so other chips would claim a narrowing those results
  // don't have.
  // Upcoming replaces the release state with "not out yet", so a saved one
  // isn't narrowing anything either.
  const searching = Boolean(query.trim());
  const activeFilters: ActiveFilter[] = isFixedListSection(activeSectionKey)
    ? []
    : discoverFilterChips(view, filtersMeta)
      .filter((chip) => !searching || chip.id === 'contentType')
      .filter((chip) => !(chip.id === 'releaseState' && discoverSort === 'upcoming'))
      .map((chip) => ({
        id: chip.id,
        label: chip.label,
        onRemove: () => updateView(chip.patch),
      }));
  const clearAllFilters = () => updateView({ contentType: 'all', filters: { ...DEFAULT_DISCOVER_FILTERS } });
  // Search results ignore the sort, so its preset rule only names browse results.
  const sortPresetNote = searching ? null : discoverSortPresetNote(discoverSort, discoverFilters.voteCountMin, activeSectionKey);
  // TMDB only filters movies by cast and crew, and search ignores it, so the
  // person banner only shows over results it actually narrowed.
  const shownPerson = personFilter && !searching && discoverContentType === 'movie' ? personFilter : null;

  const genreChoices = useMemo(() => {
    if (!filtersMeta) return [];
    if (discoverContentType === 'movie') return filtersMeta.genres.filter((genre) => genre.type === 'movie');
    if (discoverContentType === 'show') return filtersMeta.genres.filter((genre) => genre.type === 'tv');
    return filtersMeta.genres;
  }, [filtersMeta, discoverContentType]);

  const providerChoices = useMemo(() => {
    if (!filtersMeta) return [];
    if (discoverContentType === 'movie') return filtersMeta.providers.filter((provider) => provider.type === 'movie');
    if (discoverContentType === 'show') return filtersMeta.providers.filter((provider) => provider.type === 'tv');
    return filtersMeta.providers;
  }, [filtersMeta, discoverContentType]);

  const handleQueryChange = (value: string) => {
    // The box reports its own text back after its debounce. That
    // is not typing, and must leave an untouched link as it is.
    if (value === query) return;
    setQuery(value);
    // Typing a query is an explicit browse intent: leave any active
    // section and switch to grid mode (was a query-watching effect).
    if (value.trim() && (activeSectionKey !== null || !manualBrowseMode)) {
      updateView({ section: null, manualBrowseMode: true });
    }
  };

  return (
    <div className="space-y-4 animate-content-in">
      <h1 className="sr-only">Discover</h1>
      <DiscoverToolbar
        searchParamsKey={searchParamsKey}
        query={query}
        handleQueryChange={handleQueryChange}
        discoverContentType={discoverContentType}
        handleSelectContentType={handleSelectContentType}
        handleOpenFilters={handleOpenFilters}
        activeAdvancedFilterCount={activeAdvancedFilterCount}
        discoverSort={discoverSort}
        handleSelectSort={handleSelectSort}
        rateLimitInfo={rateLimitInfo}
        rateLimitCountdown={rateLimitCountdown}
      />

      <ActiveFilterBar filters={activeFilters} onClearAll={clearAllFilters} />

      {!gridMode && (
        <DiscoverHomeSections
          loadingSections={loadingSections}
          heroItems={heroItems}
          layoutConfig={layoutConfig}
          discoverContentType={discoverContentType}
          customCarouselItems={customCarouselItems}
          customCarouselLoading={customCarouselLoading}
          visibleSections={visibleSections}
          handleOpenItem={handleOpenItem}
          handleSeeAll={handleSeeAll}
          handleSeeAllCustom={handleSeeAllCustom}
          pickGenre={pickGenre}
          pickProvider={pickProvider}
        />
      )}

      {gridMode && (
        <DiscoverResults
          shownPerson={shownPerson}
          updateView={updateView}
          activeSectionKey={activeSectionKey}
          sortPresetNote={sortPresetNote}
          goToDiscoverHome={goToDiscoverHome}
          loadingItems={loadingItems}
          items={items}
          resetFilters={resetFilters}
          handleOpenItem={handleOpenItem}
          hasNextPage={hasNextPage}
          sentinelRef={sentinelRef}
          loadingMore={loadingMore}
        />
      )}

      <DiscoverFilterSheet
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        isMobile={isMobile}
        draftSort={draftSort}
        setDraftSort={setDraftSort}
        draftSortDirection={draftSortDirection}
        setDraftSortDirection={setDraftSortDirection}
        draftFilters={draftFilters}
        setDraftFilters={setDraftFilters}
        filtersMeta={filtersMeta}
        genreChoices={genreChoices}
        providerChoices={providerChoices}
        query={query}
        updateView={updateView}
        discoverContentType={discoverContentType}
      />

    </div>
  );
}
