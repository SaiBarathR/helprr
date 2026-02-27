'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MediaCard } from '@/components/media/media-card';
import { MediaOverviewItem } from '@/components/media/media-overview';
import { MediaTable } from '@/components/media/media-table';
import { ViewSelector } from '@/components/media/view-selector';
import { FieldToggles } from '@/components/media/field-toggles';
import { SearchBar } from '@/components/media/search-bar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Filter, ArrowUpDown, Plus, RefreshCw } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import {
  getCachedListData,
  getListViewState,
  isListDataFresh,
  setCachedListData,
  setListViewState,
} from '@/lib/media-list-cache';
import { useWindowVirtualRange } from '@/hooks/use-window-virtual-range';
import type { RadarrMovieListItem } from '@/types';

import type { MediaViewMode } from '@/lib/store';

interface MoviesPageCacheData {
  movies: RadarrMovieListItem[];
  qualityProfiles: { id: number; name: string }[];
  tags: { id: number; label: string }[];
}

const FIELD_OPTIONS_BY_MODE: Record<MediaViewMode, { value: string; label: string }[]> = {
  posters: [
    { value: 'year', label: 'Year' },
    { value: 'rating', label: 'Rating' },
    { value: 'monitored', label: 'Monitored' },
  ],
  overview: [
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'rating', label: 'Rating' },
    { value: 'studio', label: 'Studio' },
    { value: 'certification', label: 'Certification' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'monitored', label: 'Monitored' },
    { value: 'year', label: 'Year' },
    { value: 'genres', label: 'Genres' },
    { value: 'overview', label: 'Overview' },
    { value: 'images', label: 'Poster' },
  ],
  table: [
    { value: 'monitored', label: 'Monitored' },
    { value: 'year', label: 'Year' },
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'studio', label: 'Studio' },
    { value: 'rating', label: 'Rating' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
  ],
};

const filterOptions = [
  { value: 'all', label: 'All' },
  { value: 'monitored', label: 'Monitored' },
  { value: 'unmonitored', label: 'Unmonitored' },
  { value: 'missing', label: 'Missing' },
  { value: 'hasFile', label: 'On Disk' },
  { value: 'released', label: 'Released' },
  { value: 'inCinemas', label: 'In Cinemas' },
  { value: 'announced', label: 'Announced' },
] as const;

const sortOptions = [
  { value: 'title', label: 'Title' },
  { value: 'originalTitle', label: 'Original Title' },
  { value: 'year', label: 'Year' },
  { value: 'dateAdded', label: 'Added' },
  { value: 'imdbRating', label: 'IMDb Rating' },
  { value: 'tmdbRating', label: 'TMDb Rating' },
  { value: 'tomatoRating', label: 'Tomato Rating' },
  { value: 'traktRating', label: 'Trakt Rating' },
  { value: 'popularity', label: 'Popularity' },
  { value: 'sizeOnDisk', label: 'Size on Disk' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'inCinemas', label: 'In Cinemas' },
  { value: 'digitalRelease', label: 'Digital Release' },
  { value: 'physicalRelease', label: 'Physical Release' },
  { value: 'studio', label: 'Studio' },
  { value: 'qualityProfile', label: 'Quality Profile' },
  { value: 'monitored', label: 'Monitored/Status' },
  { value: 'path', label: 'Path' },
  { value: 'certification', label: 'Certification' },
  { value: 'originalLanguage', label: 'Original Language' },
  { value: 'tags', label: 'Tags' },
] as const;

function getPosterColumns(width: number, posterSize: 'small' | 'medium' | 'large') {
  if (posterSize === 'small') {
    if (width >= 1280) return 8;
    if (width >= 1024) return 7;
    if (width >= 768) return 6;
    if (width >= 640) return 5;
    return 4;
  }

  if (posterSize === 'large') {
    if (width >= 1280) return 5;
    if (width >= 1024) return 4;
    if (width >= 768) return 3;
    return 2;
  }

  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  return 3;
}

function ensurePaintedOrHeightReached(targetScrollY: number, timeoutMs = 1200, pollMs = 50) {
  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    let done = false;
    let loadTimeoutId: number | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (loadTimeoutId !== null) window.clearTimeout(loadTimeoutId);
      resolve();
    };

    const waitForHeight = () => {
      if (done) return;
      const reachedHeight = document.body.scrollHeight > targetScrollY;
      const timedOut = Date.now() - startedAt >= timeoutMs;
      if (reachedHeight || timedOut) {
        finish();
        return;
      }
      window.setTimeout(waitForHeight, pollMs);
    };

    if (document.readyState !== 'complete') {
      const onLoad = () => {
        window.removeEventListener('load', onLoad);
        waitForHeight();
      };
      window.addEventListener('load', onLoad, { once: true });
      loadTimeoutId = window.setTimeout(() => {
        window.removeEventListener('load', onLoad);
        waitForHeight();
      }, timeoutMs);
      return;
    }

    waitForHeight();
  });
}

/**
 * Render the Movies management page with client-side data loading, filtering, sorting, and multiple view modes (posters, overview, table).
 *
 * Fetches movies, quality profiles, and tags on mount and maintains local state for search, filters, sort, poster size, and visible fields per view mode.
 * The component derives a filtered, sorted list from the loaded movies and renders one of:
 * - a poster grid,
 * - an overview list,
 * - or a table with a mobile overview fallback.
 *
 * @returns The Movies page JSX element.
 */
export default function MoviesPage() {
  const [movies, setMovies] = useState<RadarrMovieListItem[]>([]);
  const [qualityProfiles, setQualityProfiles] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [containerWidth, setContainerWidth] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const hasRestoredSearchRef = useRef(false);

  const {
    moviesView: viewMode,
    setMoviesView: setViewMode,
    moviesPosterSize: posterSize,
    setMoviesPosterSize: setPosterSize,
    moviesSort: sort,
    setMoviesSort: setSort,
    moviesSortDirection: sortDir,
    setMoviesSortDirection: setSortDir,
    moviesFilter: filter,
    setMoviesFilter: setFilter,
    moviesVisibleFields: visibleFieldsByMode,
    setMoviesVisibleFields: setVisibleFieldsForMode,
    moviesSearch: search,
    setMoviesSearch: setSearch,
  } = useUIStore();

  const visibleFields = visibleFieldsByMode[viewMode];
  const setVisibleFields = useCallback(
    (fields: string[]) => setVisibleFieldsForMode(viewMode, fields),
    [viewMode, setVisibleFieldsForMode]
  );

  const persistViewState = useCallback((scrollY = window.scrollY, searchValue = search) => {
    setListViewState('movies', { scrollY, search: searchValue });
  }, [search]);

  const fetchData = useCallback(async (force = false) => {
    const cached = force ? null : getCachedListData<MoviesPageCacheData>('movies');
    const hasCachedData = Boolean(cached?.data);

    if (cached?.data) {
      setMovies(cached.data.movies);
      setQualityProfiles(cached.data.qualityProfiles);
      setTags(cached.data.tags);
      setLoading(false);

      if (isListDataFresh(cached)) {
        setRefreshing(false);
        return;
      }

      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }

    try {
      const [m, q, t] = await Promise.all([
        fetch('/api/radarr').then((r) => r.ok ? r.json() : []),
        fetch('/api/radarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
        fetch('/api/radarr/tags').then((r) => r.ok ? r.json() : []),
      ]);

      const next: MoviesPageCacheData = {
        movies: m,
        qualityProfiles: q,
        tags: t,
      };

      setMovies(next.movies);
      setQualityProfiles(next.qualityProfiles);
      setTags(next.tags);
      setCachedListData('movies', next);
    } catch {
      if (!hasCachedData) {
        setMovies([]);
        setQualityProfiles([]);
        setTags([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    if (hasRestoredSearchRef.current) return;
    hasRestoredSearchRef.current = true;

    const saved = getListViewState('movies');
    if (!saved) return;
    if (!search && saved.search) setSearch(saved.search);
  }, [search, setSearch]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const measure = () => setContainerWidth(container.getBoundingClientRect().width);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);

    return () => observer.disconnect();
  }, [viewMode, posterSize]);

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) return;

    const saved = getListViewState('movies');
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      await ensurePaintedOrHeightReached(saved.scrollY);
      if (cancelled) return;
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      hasRestoredScrollRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [loading]);

  useEffect(() => {
    persistViewState(window.scrollY, search);
  }, [search, persistViewState]);

  useEffect(() => {
    let lastSaved = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastSaved < 150) return;
      lastSaved = now;
      persistViewState(window.scrollY, search);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [persistViewState, search]);

  const handleSearch = useCallback((v: string) => setSearch(v), [setSearch]);
  const handleNavigateToDetail = useCallback(() => {
    persistViewState(window.scrollY, search);
  }, [persistViewState, search]);

  const qualityProfileMap = useMemo(
    () => new Map(qualityProfiles.map((profile) => [profile.id, profile.name])),
    [qualityProfiles]
  );
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.label])), [tags]);

  const filtered = useMemo(() => {
    let list = movies;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q));
    }

    if (filter === 'monitored') list = list.filter((m) => m.monitored);
    else if (filter === 'unmonitored') list = list.filter((m) => !m.monitored);
    else if (filter === 'missing') list = list.filter((m) => m.monitored && !m.hasFile);
    else if (filter === 'hasFile') list = list.filter((m) => m.hasFile);
    else if (filter === 'released') list = list.filter((m) => m.status === 'released');
    else if (filter === 'inCinemas') list = list.filter((m) => m.status === 'inCinemas');
    else if (filter === 'announced') list = list.filter((m) => m.status === 'announced');

    list = [...list].sort((a, b) => {
      let result = 0;

      switch (sort) {
        case 'title':
          result = a.sortTitle.localeCompare(b.sortTitle);
          break;
        case 'originalTitle':
          result = (a.originalTitle || a.title).localeCompare(b.originalTitle || b.title);
          break;
        case 'year':
          result = a.year - b.year;
          break;
        case 'dateAdded':
          result = new Date(a.added).getTime() - new Date(b.added).getTime();
          break;
        case 'sizeOnDisk':
          result = a.sizeOnDisk - b.sizeOnDisk;
          break;
        case 'runtime':
          result = a.runtime - b.runtime;
          break;
        case 'studio':
          result = (a.studio || '').localeCompare(b.studio || '');
          break;
        case 'qualityProfile': {
          const qA = qualityProfileMap.get(a.qualityProfileId) || '';
          const qB = qualityProfileMap.get(b.qualityProfileId) || '';
          result = qA.localeCompare(qB);
          break;
        }
        case 'monitored':
          result = (a.monitored === b.monitored) ? 0 : a.monitored ? -1 : 1;
          break;
        case 'inCinemas':
          result = new Date(a.inCinemas || 0).getTime() - new Date(b.inCinemas || 0).getTime();
          break;
        case 'digitalRelease':
          result = new Date(a.digitalRelease || 0).getTime() - new Date(b.digitalRelease || 0).getTime();
          break;
        case 'physicalRelease':
          result = new Date(a.physicalRelease || 0).getTime() - new Date(b.physicalRelease || 0).getTime();
          break;
        case 'popularity':
          result = (a.popularity || 0) - (b.popularity || 0);
          break;
        case 'imdbRating':
          result = (a.ratings?.imdb?.value || 0) - (b.ratings?.imdb?.value || 0);
          break;
        case 'tmdbRating':
          result = (a.ratings?.tmdb?.value || 0) - (b.ratings?.tmdb?.value || 0);
          break;
        case 'tomatoRating':
          result = (a.ratings?.rottenTomatoes?.value || 0) - (b.ratings?.rottenTomatoes?.value || 0);
          break;
        case 'traktRating':
          result = (a.ratings?.trakt?.value || 0) - (b.ratings?.trakt?.value || 0);
          break;
        case 'path':
          result = (a.path || '').localeCompare(b.path || '');
          break;
        case 'certification':
          result = (a.certification || '').localeCompare(b.certification || '');
          break;
        case 'originalLanguage':
          result = (a.originalLanguage?.name || '').localeCompare(b.originalLanguage?.name || '');
          break;
        case 'tags': {
          const tA = a.tags.map((id) => tagMap.get(id) || '').sort().join(',');
          const tB = b.tags.map((id) => tagMap.get(id) || '').sort().join(',');
          result = tA.localeCompare(tB);
          break;
        }
        default:
          result = 0;
      }

      return sortDir === 'asc' ? result : -result;
    });

    return list;
  }, [movies, search, sort, sortDir, filter, qualityProfileMap, tagMap]);

  const isDesktop = viewportWidth >= 768;
  const effectiveView = viewMode === 'table' ? 'table' : viewMode;
  const useVirtualization = filtered.length > 120 && !loading;

  const posterGridClass = posterSize === 'small'
    ? 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2'
    : posterSize === 'large'
      ? 'grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
      : 'grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';

  const posterColumns = getPosterColumns(viewportWidth, posterSize);
  const posterGap = posterSize === 'small' ? 8 : 12;
  const posterRowHeight = useMemo(() => {
    if (containerWidth <= 0) {
      if (posterSize === 'small') return 148;
      if (posterSize === 'large') return 264;
      return 216;
    }

    const cardWidth = Math.max(1, (containerWidth - posterGap * (posterColumns - 1)) / posterColumns);
    return cardWidth * 1.5 + posterGap;
  }, [containerWidth, posterColumns, posterGap, posterSize]);

  const posterRowCount = Math.ceil(filtered.length / posterColumns);
  const posterVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: posterRowCount,
    itemSize: posterRowHeight,
    enabled: useVirtualization && effectiveView === 'posters',
    overscan: 2,
  });

  const overviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (visibleFields.includes('overview')) base += 24;
    if (!visibleFields.includes('images')) base -= 20;
    return base;
  }, [posterSize, visibleFields]);

  const overviewVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: filtered.length,
    itemSize: overviewRowHeight,
    enabled: useVirtualization && effectiveView === 'overview',
    overscan: 6,
  });

  const tableRowHeight = 44;
  const tableRows = useMemo(() => (
    filtered.map((movie) => ({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      href: `/movies/${movie.id}`,
      monitored: movie.monitored,
      hasFile: movie.hasFile,
      status: movie.status,
      images: movie.images,
      qualityProfile: qualityProfileMap.get(movie.qualityProfileId),
      studio: movie.studio,
      rating: movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value,
      sizeOnDisk: movie.sizeOnDisk,
      runtime: movie.runtime,
      certification: movie.certification,
      genres: movie.genres,
    }))
  ), [filtered, qualityProfileMap]);

  const tableVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: tableRows.length,
    itemSize: tableRowHeight,
    enabled: useVirtualization && effectiveView === 'table' && isDesktop,
    overscan: 12,
  });

  const mobileOverviewFields = visibleFieldsByMode.overview;
  const tableMobileOverviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (mobileOverviewFields.includes('overview')) base += 24;
    if (!mobileOverviewFields.includes('images')) base -= 20;
    return base;
  }, [mobileOverviewFields, posterSize]);

  const tableMobileVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: filtered.length,
    itemSize: tableMobileOverviewRowHeight,
    enabled: useVirtualization && effectiveView === 'table' && !isDesktop,
    overscan: 6,
  });

  const activeFilterLabel = filterOptions.find((o) => o.value === filter)?.label ?? 'All';
  const activeSortLabel = sortOptions.find((o) => o.value === sort)?.label ?? 'Title';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label={`Filter: ${activeFilterLabel}`}
            >
              <Filter className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Filter</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {filterOptions.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={filter === opt.value}
                onCheckedChange={() => setFilter(opt.value)}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label={`Sort: ${activeSortLabel} ${sortDir === 'asc' ? 'Ascending' : 'Descending'}`}
            >
              <ArrowUpDown className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Sort By</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sortOptions.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={sort === opt.value}
                onCheckedChange={() => setSort(opt.value)}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={sortDir === 'asc'}
              onCheckedChange={() => setSortDir('asc')}
            >
              Ascending
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={sortDir === 'desc'}
              onCheckedChange={() => setSortDir('desc')}
            >
              Descending
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ViewSelector value={viewMode} onChange={setViewMode} />
        <FieldToggles
          available={FIELD_OPTIONS_BY_MODE[viewMode]}
          selected={visibleFields}
          onChange={setVisibleFields}
          posterSize={viewMode !== 'table' ? posterSize : undefined}
          onPosterSizeChange={viewMode !== 'table' ? setPosterSize : undefined}
        />

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label="Refresh Movies"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh Movies</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/movies/add"
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
              aria-label="Add Movie"
            >
              <Plus className="h-5 w-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Add Movie</TooltipContent>
        </Tooltip>
      </div>

      <SearchBar value={search} onChange={handleSearch} placeholder="Search movies..." />

      {(() => {
        if (loading) {
          return effectiveView === 'posters' ? (
            <div className={posterGridClass}>
              {[...Array(12)].map((_, i) => (
                <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
              ))}
            </div>
          ) : effectiveView === 'overview' ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : isDesktop ? (
            <div className="block"><Skeleton className="h-96 rounded-xl" /></div>
          ) : (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          );
        }

        if (filtered.length === 0) {
          return (
            <div className="text-center py-12 text-muted-foreground">
              {movies.length === 0
                ? 'No movies found. Add your Radarr connection in Settings.'
                : 'No movies match your filters.'}
            </div>
          );
        }

        if (effectiveView === 'posters') {
          const startIndex = posterVirtual.startIndex * posterColumns;
          const endIndex = Math.min(filtered.length, posterVirtual.endIndex * posterColumns);
          const visibleMovies = filtered.slice(startIndex, endIndex);

          return (
            <div ref={contentRef}>
              {posterVirtual.topSpacerHeight > 0 && <div style={{ height: posterVirtual.topSpacerHeight }} />}
              <div className={posterGridClass}>
                {visibleMovies.map((movie) => (
                  <MediaCard
                    key={movie.id}
                    title={movie.title}
                    year={movie.year}
                    images={movie.images}
                    hasFile={movie.hasFile}
                    monitored={movie.monitored}
                    type="movie"
                    href={`/movies/${movie.id}`}
                    visibleFields={visibleFields}
                    rating={movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value}
                    onNavigate={handleNavigateToDetail}
                  />
                ))}
              </div>
              {posterVirtual.bottomSpacerHeight > 0 && <div style={{ height: posterVirtual.bottomSpacerHeight }} />}
            </div>
          );
        }

        if (effectiveView === 'overview') {
          const visibleMovies = filtered.slice(overviewVirtual.startIndex, overviewVirtual.endIndex);

          return (
            <div ref={contentRef} className="space-y-2">
              {overviewVirtual.topSpacerHeight > 0 && <div style={{ height: overviewVirtual.topSpacerHeight }} />}
              {visibleMovies.map((movie) => (
                <MediaOverviewItem
                  key={movie.id}
                  title={movie.title}
                  year={movie.year}
                  images={movie.images}
                  href={`/movies/${movie.id}`}
                  type="movie"
                  monitored={movie.monitored}
                  hasFile={movie.hasFile}
                  status={movie.status}
                  visibleFields={visibleFields}
                  posterSize={posterSize}
                  qualityProfile={qualityProfileMap.get(movie.qualityProfileId)}
                  studio={movie.studio}
                  certification={movie.certification}
                  overview={movie.overview}
                  rating={movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value}
                  sizeOnDisk={movie.sizeOnDisk}
                  runtime={movie.runtime}
                  genres={movie.genres}
                  onNavigate={handleNavigateToDetail}
                />
              ))}
              {overviewVirtual.bottomSpacerHeight > 0 && <div style={{ height: overviewVirtual.bottomSpacerHeight }} />}
            </div>
          );
        }

        if (isDesktop) {
          const visibleRows = tableRows.slice(tableVirtual.startIndex, tableVirtual.endIndex);
          return (
            <div ref={contentRef}>
              <MediaTable
                type="movie"
                visibleFields={visibleFields}
                rows={visibleRows}
                topSpacerHeight={tableVirtual.topSpacerHeight}
                bottomSpacerHeight={tableVirtual.bottomSpacerHeight}
                onNavigate={handleNavigateToDetail}
              />
            </div>
          );
        }

        const visibleMovies = filtered.slice(tableMobileVirtual.startIndex, tableMobileVirtual.endIndex);

        return (
          <div ref={contentRef} className="space-y-2">
            {tableMobileVirtual.topSpacerHeight > 0 && <div style={{ height: tableMobileVirtual.topSpacerHeight }} />}
            {visibleMovies.map((movie) => (
              <MediaOverviewItem
                key={movie.id}
                title={movie.title}
                year={movie.year}
                images={movie.images}
                href={`/movies/${movie.id}`}
                type="movie"
                monitored={movie.monitored}
                hasFile={movie.hasFile}
                status={movie.status}
                visibleFields={mobileOverviewFields}
                posterSize={posterSize}
                qualityProfile={qualityProfileMap.get(movie.qualityProfileId)}
                studio={movie.studio}
                certification={movie.certification}
                overview={movie.overview}
                rating={movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value}
                sizeOnDisk={movie.sizeOnDisk}
                runtime={movie.runtime}
                genres={movie.genres}
                onNavigate={handleNavigateToDetail}
              />
            ))}
            {tableMobileVirtual.bottomSpacerHeight > 0 && <div style={{ height: tableMobileVirtual.bottomSpacerHeight }} />}
          </div>
        );
      })()}
    </div>
  );
}
