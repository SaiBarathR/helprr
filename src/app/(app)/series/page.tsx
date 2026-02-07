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
import { SearchBar } from '@/components/media/search-bar';
import { Filter, ArrowUpDown, Plus } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import type { SonarrSeries } from '@/types';

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
    seriesSort: sort,
    setSeriesSort: setSort,
    seriesSortDirection: sortDir,
    setSeriesSortDirection: setSortDir,
    seriesFilter: filter,
    setSeriesFilter: setFilter,
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

        <div className="flex-1" />

        {/* Add series button */}
        <Link
          href="/series/add"
          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
          aria-label="Add Series"
        >
          <Plus className="h-5 w-5" />
        </Link>
      </div>

      {/* Search bar */}
      <SearchBar value={search} onChange={handleSearch} placeholder="Search series..." />

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {series.length === 0
            ? 'No series found. Add your Sonarr connection in Settings.'
            : 'No series match your filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
