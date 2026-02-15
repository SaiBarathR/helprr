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
import type { SonarrSeries } from '@/types';

const SERIES_FIELD_OPTIONS = [
  { value: 'qualityProfile', label: 'Quality Profile' },
  { value: 'rating', label: 'Rating' },
  { value: 'network', label: 'Network' },
  { value: 'sizeOnDisk', label: 'Size on Disk' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'monitored', label: 'Monitored' },
  { value: 'year', label: 'Year' },
  { value: 'episodeProgress', label: 'Episode Progress' },
  { value: 'genres', label: 'Genres' },
  { value: 'overview', label: 'Overview' },
  { value: 'images', label: 'Poster' },
];

const filterOptions = [
  { value: 'all', label: 'All' },
  { value: 'monitored', label: 'Monitored' },
  { value: 'unmonitored', label: 'Unmonitored' },
  { value: 'continuing', label: 'Continuing' },
  { value: 'ended', label: 'Ended' },
  { value: 'missing', label: 'Missing' },
  { value: 'upcoming', label: 'Upcoming' },
] as const;

const sortOptions = [
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Year' },
  { value: 'dateAdded', label: 'Added' },
  { value: 'rating', label: 'Rating' },
  { value: 'sizeOnDisk', label: 'Size on Disk' },
  { value: 'nextAiring', label: 'Next Airing' },
  { value: 'previousAiring', label: 'Previous Airing' },
  { value: 'network', label: 'Network' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'qualityProfile', label: 'Quality Profile' },
  { value: 'monitored', label: 'Monitored/Status' },
  { value: 'originalLanguage', label: 'Original Language' },
  { value: 'seasons', label: 'Seasons' },
  { value: 'episodes', label: 'Episodes' },
  { value: 'episodeCount', label: 'Episode Count' },
  { value: 'path', label: 'Path' },
  { value: 'tags', label: 'Tags' },
] as const;

export default function SeriesPage() {
  const [series, setSeries] = useState<SonarrSeries[]>([]);
  const [qualityProfiles, setQualityProfiles] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const {
    seriesView: viewMode,
    setSeriesView: setViewMode,
    seriesPosterSize: posterSize,
    setSeriesPosterSize: setPosterSize,
    seriesSort: sort,
    setSeriesSort: setSort,
    seriesSortDirection: sortDir,
    setSeriesSortDirection: setSortDir,
    seriesFilter: filter,
    setSeriesFilter: setFilter,
    seriesVisibleFields: visibleFields,
    setSeriesVisibleFields: setVisibleFields,
  } = useUIStore();

  useEffect(() => {
    Promise.all([
      fetch('/api/sonarr').then((r) => r.ok ? r.json() : []),
      fetch('/api/sonarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/sonarr/tags').then((r) => r.ok ? r.json() : []),
    ]).then(([s, q, t]) => {
      setSeries(s);
      setQualityProfiles(q);
      setTags(t);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v), []);

  const filtered = useMemo(() => {
    let list = series;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }

    // Filters
    if (filter === 'monitored') list = list.filter((s) => s.monitored);
    else if (filter === 'unmonitored') list = list.filter((s) => !s.monitored);
    else if (filter === 'continuing') list = list.filter((s) => s.status === 'continuing');
    else if (filter === 'ended') list = list.filter((s) => s.status === 'ended');
    else if (filter === 'missing') list = list.filter((s) => s.monitored && s.statistics.episodeCount < s.statistics.totalEpisodeCount);
    else if (filter === 'upcoming') list = list.filter((s) => s.status === 'upcoming');

    // Sorting
    list = [...list].sort((a, b) => {
      let result = 0;
      switch (sort) {
        case 'title':
          result = a.sortTitle.localeCompare(b.sortTitle);
          break;
        case 'year':
          result = a.year - b.year;
          break;
        case 'dateAdded':
          result = new Date(a.added).getTime() - new Date(b.added).getTime();
          break;
        case 'network':
          result = (a.network || '').localeCompare(b.network || '');
          break;
        case 'runtime':
          result = a.runtime - b.runtime;
          break;
        case 'rating':
          result = (a.ratings?.value || 0) - (b.ratings?.value || 0);
          break;
        case 'monitored':
          result = (a.monitored === b.monitored) ? 0 : a.monitored ? -1 : 1;
          break;
        case 'qualityProfile':
          const qA = qualityProfiles.find(q => q.id === a.qualityProfileId)?.name || '';
          const qB = qualityProfiles.find(q => q.id === b.qualityProfileId)?.name || '';
          result = qA.localeCompare(qB);
          break;
        case 'originalLanguage':
          result = (a.originalLanguage?.name || '').localeCompare(b.originalLanguage?.name || '');
          break;
        case 'nextAiring':
          result = new Date(a.nextAiring || '9999').getTime() - new Date(b.nextAiring || '9999').getTime();
          break;
        case 'previousAiring':
          result = new Date(a.previousAiring || 0).getTime() - new Date(b.previousAiring || 0).getTime();
          break;
        case 'seasons':
          result = a.statistics.seasonCount - b.statistics.seasonCount;
          break;
        case 'episodes':
          result = a.statistics.episodeCount - b.statistics.episodeCount;
          break;
        case 'episodeCount':
          result = a.statistics.totalEpisodeCount - b.statistics.totalEpisodeCount;
          break;
        case 'path':
          result = (a.path || '').localeCompare(b.path || '');
          break;
        case 'sizeOnDisk':
          result = a.statistics.sizeOnDisk - b.statistics.sizeOnDisk;
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
  }, [series, search, sort, sortDir, filter, qualityProfiles, tags]);

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
          available={SERIES_FIELD_OPTIONS}
          selected={visibleFields}
          onChange={setVisibleFields}
          posterSize={viewMode !== 'table' ? posterSize : undefined}
          onPosterSizeChange={viewMode !== 'table' ? setPosterSize : undefined}
        />

        <div className="flex-1" />

        {/* Add series button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/series/add"
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
              aria-label="Add Series"
            >
              <Plus className="h-5 w-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Add Series</TooltipContent>
        </Tooltip>
      </div>

      {/* Search bar */}
      <SearchBar value={search} onChange={handleSearch} placeholder="Search series..." />

      {/* Content */}
      {(() => {
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
              {series.length === 0
                ? 'No series found. Add your Sonarr connection in Settings.'
                : 'No series match your filters.'}
            </div>
          );
        }

        const seriesQuality = (s: SonarrSeries) => qualityProfiles.find((q) => q.id === s.qualityProfileId)?.name;
        const seriesEpProgress = (s: SonarrSeries) => `${s.statistics.episodeCount}/${s.statistics.totalEpisodeCount}`;

        if (effectiveView === 'posters') {
          return (
            <div className={posterGridClass}>
              {filtered.map((s) => (
                <MediaCard
                  key={s.id}
                  title={s.title}
                  year={s.year}
                  images={s.images}
                  status={s.status}
                  monitored={s.monitored}
                  type="series"
                  href={`/series/${s.id}`}
                  visibleFields={visibleFields}
                  rating={s.ratings?.value}
                />
              ))}
            </div>
          );
        }

        const renderOverview = (items: SonarrSeries[]) => (
          <div className="space-y-2">
            {items.map((s) => (
              <MediaOverviewItem
                key={s.id}
                title={s.title}
                year={s.year}
                images={s.images}
                href={`/series/${s.id}`}
                type="series"
                monitored={s.monitored}
                status={s.status}
                visibleFields={visibleFields}
                posterSize={posterSize}
                qualityProfile={seriesQuality(s)}
                network={s.network}
                overview={s.overview}
                rating={s.ratings?.value}
                sizeOnDisk={s.statistics.sizeOnDisk}
                runtime={s.runtime}
                episodeProgress={seriesEpProgress(s)}
                genres={s.genres}
              />
            ))}
          </div>
        );

        if (effectiveView === 'overview') {
          return renderOverview(filtered);
        }

        // Table view - table on md+, overview fallback on mobile
        const tableRows = filtered.map((s) => ({
          id: s.id,
          title: s.title,
          year: s.year,
          href: `/series/${s.id}`,
          monitored: s.monitored,
          status: s.status,
          images: s.images,
          qualityProfile: seriesQuality(s),
          network: s.network,
          rating: s.ratings?.value,
          sizeOnDisk: s.statistics.sizeOnDisk,
          episodeProgress: seriesEpProgress(s),
          runtime: s.runtime,
          genres: s.genres,
        }));

        return (
          <>
            <div className="hidden md:block">
              <MediaTable type="series" visibleFields={visibleFields} rows={tableRows} />
            </div>
            <div className="md:hidden">
              {renderOverview(filtered)}
            </div>
          </>
        );
      })()}
    </div>
  );
}
