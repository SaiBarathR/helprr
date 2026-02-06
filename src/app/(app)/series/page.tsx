'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MediaCard } from '@/components/media/media-card';
import { MediaGrid } from '@/components/media/media-grid';
import { SearchBar } from '@/components/media/search-bar';
import { Plus, LayoutGrid, List, ArrowUp, ArrowDown } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import type { SonarrSeries } from '@/types';

export default function SeriesPage() {
  const [series, setSeries] = useState<SonarrSeries[]>([]);
  const [qualityProfiles, setQualityProfiles] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { 
    mediaView, 
    setMediaView, 
    seriesSort: sort, 
    setSeriesSort: setSort, 
    seriesSortDirection: sortDir,
    setSeriesSortDirection: setSortDir,
    seriesFilter: filter, 
    setSeriesFilter: setFilter 
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
    else if (filter === 'continuing') list = list.filter((s) => s.status === 'continuing');
    else if (filter === 'ended') list = list.filter((s) => s.status === 'ended');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">TV Series</h1>
        <Button asChild>
          <Link href="/series/add"><Plus className="mr-2 h-4 w-4" /> Add Series</Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SearchBar value={search} onChange={handleSearch} placeholder="Search series..." />
        </div>
        <div className="flex gap-2">
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="dateAdded">Added</SelectItem>
              <SelectItem value="monitored">Monitored/Status</SelectItem>
              <SelectItem value="network">Network</SelectItem>
              <SelectItem value="qualityProfile">Quality Profile</SelectItem>
              <SelectItem value="originalLanguage">Original Language</SelectItem>
              <SelectItem value="nextAiring">Next Airing</SelectItem>
              <SelectItem value="previousAiring">Previous Airing</SelectItem>
              <SelectItem value="seasons">Seasons</SelectItem>
              <SelectItem value="episodes">Episodes</SelectItem>
              <SelectItem value="episodeCount">Episode Count</SelectItem>
              <SelectItem value="path">Path</SelectItem>
              <SelectItem value="sizeOnDisk">Size on Disk</SelectItem>
              <SelectItem value="runtime">Runtime</SelectItem>
              <SelectItem value="rating">Rating</SelectItem>
              <SelectItem value="tags">Tags</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </Button>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="monitored">Monitored</SelectItem>
            <SelectItem value="continuing">Continuing</SelectItem>
            <SelectItem value="ended">Ended</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button variant={mediaView === 'grid' ? 'secondary' : 'ghost'} size="icon" onClick={() => setMediaView('grid')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={mediaView === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setMediaView('list')}>
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <MediaGrid>
          {[...Array(12)].map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-lg" />)}
        </MediaGrid>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {series.length === 0 ? 'No series found. Add your Sonarr connection in Settings.' : 'No series match your filters.'}
        </div>
      ) : (
        <MediaGrid view={mediaView}>
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
        </MediaGrid>
      )}
    </div>
  );
}
