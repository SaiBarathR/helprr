'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MediaCard } from '@/components/media/media-card';
import { MediaGrid } from '@/components/media/media-grid';
import { SearchBar } from '@/components/media/search-bar';
import { Plus, LayoutGrid, List } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import type { SonarrSeries } from '@/types';

export default function SeriesPage() {
  const [series, setSeries] = useState<SonarrSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('title');
  const [filter, setFilter] = useState('all');
  const { mediaView, setMediaView } = useUIStore();

  useEffect(() => {
    fetch('/api/sonarr')
      .then((r) => r.ok ? r.json() : [])
      .then(setSeries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v), []);

  const filtered = useMemo(() => {
    let list = series;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }
    if (filter === 'monitored') list = list.filter((s) => s.monitored);
    else if (filter === 'continuing') list = list.filter((s) => s.status === 'continuing');
    else if (filter === 'ended') list = list.filter((s) => s.status === 'ended');

    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.sortTitle.localeCompare(b.sortTitle);
      if (sort === 'year') return b.year - a.year;
      if (sort === 'dateAdded') return new Date(b.added).getTime() - new Date(a.added).getTime();
      if (sort === 'network') return (a.network || '').localeCompare(b.network || '');
      return 0;
    });

    return list;
  }, [series, search, sort, filter]);

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
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="year">Year</SelectItem>
            <SelectItem value="dateAdded">Date Added</SelectItem>
            <SelectItem value="network">Network</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="monitored">Monitored</SelectItem>
            <SelectItem value="continuing">Continuing</SelectItem>
            <SelectItem value="ended">Ended</SelectItem>
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
