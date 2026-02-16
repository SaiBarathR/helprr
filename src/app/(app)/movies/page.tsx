'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { Filter, ArrowUpDown, Plus } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import type { RadarrMovie } from '@/types';

import type { MediaViewMode } from '@/lib/store';

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

export default function MoviesPage() {
  const [movies, setMovies] = useState<RadarrMovie[]>([]);
  const [qualityProfiles, setQualityProfiles] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
  } = useUIStore();

  const visibleFields = visibleFieldsByMode[viewMode];
  const setVisibleFields = useCallback(
    (fields: string[]) => setVisibleFieldsForMode(viewMode, fields),
    [viewMode, setVisibleFieldsForMode]
  );

  useEffect(() => {
    Promise.all([
      fetch('/api/radarr').then((r) => r.ok ? r.json() : []),
      fetch('/api/radarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/radarr/tags').then((r) => r.ok ? r.json() : []),
    ]).then(([m, q, t]) => {
      setMovies(m);
      setQualityProfiles(q);
      setTags(t);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v), []);

  const filtered = useMemo(() => {
    let list = movies;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q));
    }

    // Filters
    if (filter === 'monitored') list = list.filter((m) => m.monitored);
    else if (filter === 'unmonitored') list = list.filter((m) => !m.monitored);
    else if (filter === 'missing') list = list.filter((m) => m.monitored && !m.hasFile);
    else if (filter === 'hasFile') list = list.filter((m) => m.hasFile);
    else if (filter === 'released') list = list.filter((m) => m.status === 'released');
    else if (filter === 'inCinemas') list = list.filter((m) => m.status === 'inCinemas');
    else if (filter === 'announced') list = list.filter((m) => m.status === 'announced');

    // Sorting
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
        case 'qualityProfile':
          const qA = qualityProfiles.find(q => q.id === a.qualityProfileId)?.name || '';
          const qB = qualityProfiles.find(q => q.id === b.qualityProfileId)?.name || '';
          result = qA.localeCompare(qB);
          break;
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
        case 'tags':
          const tA = a.tags.map(id => tags.find(t => t.id === id)?.label || '').sort().join(',');
          const tB = b.tags.map(id => tags.find(t => t.id === id)?.label || '').sort().join(',');
          result = tA.localeCompare(tB);
          break;
        default:
          result = 0;
      }

      return sortDir === 'asc' ? result : -result;
    });

    return list;
  }, [movies, search, sort, sortDir, filter, qualityProfiles, tags]);

  const activeFilterLabel = filterOptions.find((o) => o.value === filter)?.label ?? 'All';
  const activeSortLabel = sortOptions.find((o) => o.value === sort)?.label ?? 'Title';

  return (
    <div className="space-y-3">
      {/* Top action bar */}
      <div className="flex items-center gap-2">
        {/* Filter dropdown */}
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

        {/* Sort dropdown */}
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

        {/* View selector */}
        <ViewSelector value={viewMode} onChange={setViewMode} />
        <FieldToggles
          available={FIELD_OPTIONS_BY_MODE[viewMode]}
          selected={visibleFields}
          onChange={setVisibleFields}
          posterSize={viewMode !== 'table' ? posterSize : undefined}
          onPosterSizeChange={viewMode !== 'table' ? setPosterSize : undefined}
        />

        <div className="flex-1" />

        {/* Add movie button */}
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

      {/* Search bar */}
      <SearchBar value={search} onChange={handleSearch} placeholder="Search movies..." />

      {/* Content */}
      {(() => {
        // On mobile, table isn't available — fall back to overview for rendering
        const effectiveView = viewMode === 'table' ? 'table' : viewMode;

        const posterGridClass = posterSize === 'small'
          ? 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2'
          : posterSize === 'large'
            ? 'grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
            : 'grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';

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
          ) : (
            <>
              {/* Table skeleton on desktop, overview skeleton on mobile */}
              <div className="hidden md:block"><Skeleton className="h-96 rounded-xl" /></div>
              <div className="md:hidden space-y-2">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            </>
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

        const movieRating = (m: RadarrMovie) => m.ratings?.imdb?.value || m.ratings?.tmdb?.value;
        const movieQuality = (m: RadarrMovie) => qualityProfiles.find((q) => q.id === m.qualityProfileId)?.name;

        if (effectiveView === 'posters') {
          return (
            <div className={posterGridClass}>
              {filtered.map((movie) => (
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
                  rating={movieRating(movie)}
                />
              ))}
            </div>
          );
        }

        if (effectiveView === 'overview') {
          return (
            <div className="space-y-2">
              {filtered.map((movie) => (
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
                  qualityProfile={movieQuality(movie)}
                  studio={movie.studio}
                  certification={movie.certification}
                  overview={movie.overview}
                  rating={movieRating(movie)}
                  sizeOnDisk={movie.sizeOnDisk}
                  runtime={movie.runtime}
                  genres={movie.genres}
                />
              ))}
            </div>
          );
        }

        // Table view - show table on md+, overview fallback on mobile
        const tableRows = filtered.map((movie) => ({
          id: movie.id,
          title: movie.title,
          year: movie.year,
          href: `/movies/${movie.id}`,
          monitored: movie.monitored,
          hasFile: movie.hasFile,
          status: movie.status,
          images: movie.images,
          qualityProfile: movieQuality(movie),
          studio: movie.studio,
          rating: movieRating(movie),
          sizeOnDisk: movie.sizeOnDisk,
          runtime: movie.runtime,
          certification: movie.certification,
          genres: movie.genres,
        }));

        const mobileOverviewFields = visibleFieldsByMode.overview;
        return (
          <>
            <div className="hidden md:block">
              <MediaTable type="movie" visibleFields={visibleFields} rows={tableRows} />
            </div>
            {/* Mobile fallback: overview */}
            <div className="md:hidden space-y-2">
              {filtered.map((movie) => (
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
                  qualityProfile={movieQuality(movie)}
                  studio={movie.studio}
                  certification={movie.certification}
                  overview={movie.overview}
                  rating={movieRating(movie)}
                  sizeOnDisk={movie.sizeOnDisk}
                  runtime={movie.runtime}
                  genres={movie.genres}
                />
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}
