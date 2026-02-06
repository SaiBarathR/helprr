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
import type { RadarrMovie } from '@/types';

export default function MoviesPage() {
  const [movies, setMovies] = useState<RadarrMovie[]>([]);
  const [qualityProfiles, setQualityProfiles] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { 
    mediaView, 
    setMediaView, 
    moviesSort: sort, 
    setMoviesSort: setSort, 
    moviesSortDirection: sortDir,
    setMoviesSortDirection: setSortDir,
    moviesFilter: filter, 
    setMoviesFilter: setFilter 
  } = useUIStore();

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
        <div className="flex gap-2">
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="originalTitle">Original Title</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="dateAdded">Added</SelectItem>
              <SelectItem value="monitored">Monitored/Status</SelectItem>
              <SelectItem value="studio">Studio</SelectItem>
              <SelectItem value="qualityProfile">Quality Profile</SelectItem>
              <SelectItem value="inCinemas">In Cinemas</SelectItem>
              <SelectItem value="digitalRelease">Digital Release</SelectItem>
              <SelectItem value="physicalRelease">Physical Release</SelectItem>
              <SelectItem value="popularity">Popularity</SelectItem>
              <SelectItem value="imdbRating">IMDb Rating</SelectItem>
              <SelectItem value="tmdbRating">TMDb Rating</SelectItem>
              <SelectItem value="tomatoRating">Tomato Rating</SelectItem>
              <SelectItem value="traktRating">Trakt Rating</SelectItem>
              <SelectItem value="sizeOnDisk">Size on Disk</SelectItem>
              <SelectItem value="runtime">Runtime</SelectItem>
              <SelectItem value="path">Path</SelectItem>
              <SelectItem value="certification">Certification</SelectItem>
              <SelectItem value="originalLanguage">Original Language</SelectItem>
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
            <SelectItem value="unmonitored">Unmonitored</SelectItem>
            <SelectItem value="missing">Missing</SelectItem>
            <SelectItem value="hasFile">On Disk</SelectItem>
            <SelectItem value="released">Released</SelectItem>
            <SelectItem value="inCinemas">In Cinemas</SelectItem>
            <SelectItem value="announced">Announced</SelectItem>
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
