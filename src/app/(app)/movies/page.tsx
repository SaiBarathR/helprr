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
import type { RadarrMovie } from '@/types';

export default function MoviesPage() {
  const [movies, setMovies] = useState<RadarrMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('title');
  const [filter, setFilter] = useState('all');
  const { mediaView, setMediaView } = useUIStore();

  useEffect(() => {
    fetch('/api/radarr')
      .then((r) => r.ok ? r.json() : [])
      .then(setMovies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = useCallback((v: string) => setSearch(v), []);

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

    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.sortTitle.localeCompare(b.sortTitle);
      if (sort === 'year') return b.year - a.year;
      if (sort === 'dateAdded') return new Date(b.added).getTime() - new Date(a.added).getTime();
      if (sort === 'sizeOnDisk') return b.sizeOnDisk - a.sizeOnDisk;
      return 0;
    });

    return list;
  }, [movies, search, sort, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Movies</h1>
        <Button asChild>
          <Link href="/movies/add">
            <Plus className="mr-2 h-4 w-4" /> Add Movie
          </Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SearchBar value={search} onChange={handleSearch} placeholder="Search movies..." />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="year">Year</SelectItem>
            <SelectItem value="dateAdded">Date Added</SelectItem>
            <SelectItem value="sizeOnDisk">Size</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="monitored">Monitored</SelectItem>
            <SelectItem value="unmonitored">Unmonitored</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
            <SelectItem value="hasFile">On Disk</SelectItem>
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
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
          ))}
        </MediaGrid>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {movies.length === 0 ? 'No movies found. Add your Radarr connection in Settings.' : 'No movies match your filters.'}
        </div>
      ) : (
        <MediaGrid view={mediaView}>
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
            />
          ))}
        </MediaGrid>
      )}
    </div>
  );
}
