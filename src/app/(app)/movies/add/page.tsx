'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Plus, Loader2, Film, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { RadarrLookupResult, QualityProfile, RootFolder, Tag } from '@/types';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

function AddMoviePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<RadarrLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<RadarrLookupResult | null>(null);
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [profileId, setProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [monitor, setMonitor] = useState<'movieOnly' | 'movieAndCollection' | 'none'>('movieOnly');
  const [searchForMovie, setSearchForMovie] = useState(true);
  const [minAvailability, setMinAvailability] = useState('released');
  const [adding, setAdding] = useState(false);
  const [autoSearched, setAutoSearched] = useState(false);
  const lastPrefillTermRef = useRef<string | null>(null);
  const lastPrefillTmdbIdRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/radarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/radarr/rootfolders').then((r) => r.ok ? r.json() : []),
      fetch('/api/radarr/tags').then((r) => r.ok ? r.json() : []),
    ]).then(([p, r, t]) => {
      setProfiles(p);
      setRootFolders(r);
      setTags(t);
      if (p.length > 0) setProfileId(String(p[0].id));
      if (r.length > 0) setRootFolder(r[0].path);
    });
  }, []);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  const runSearch = useCallback(async (searchTerm: string, targetTmdbId?: number) => {
    searchAbortRef.current?.abort();

    if (!searchTerm.trim()) {
      searchAbortRef.current = null;
      setResults([]);
      setSelected(null);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    searchAbortRef.current = controller;

    setSearching(true);
    try {
      const res = await fetch(`/api/radarr/lookup?term=${encodeURIComponent(searchTerm)}`, { signal });
      if (signal.aborted || searchAbortRef.current !== controller) return;

      if (!res.ok) {
        setResults([]);
        setSelected(null);
        toast.error(`Search failed (${res.status}${res.statusText ? ` ${res.statusText}` : ''})`);
        return;
      }

      const data: RadarrLookupResult[] = await res.json();
      if (signal.aborted || searchAbortRef.current !== controller) return;
      setResults(data);

      if (targetTmdbId) {
        const matched = data.find((item) => item.tmdbId === targetTmdbId);
        setSelected(matched ?? null);
      }
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError' || signal.aborted) {
        return;
      }
      setResults([]);
      setSelected(null);
      toast.error('Search failed');
    } finally {
      if (!signal.aborted && searchAbortRef.current === controller) {
        setSearching(false);
        searchAbortRef.current = null;
      }
    }
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(term);
  }

  async function handleAdd() {
    if (!selected || !profileId || !rootFolder) return;
    if (selected.library?.exists) {
      if (selected.library.id) {
        router.push(`/movies/${selected.library.id}`);
        return;
      }
      toast.error('Movie is already in library, but detail link is unavailable');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch('/api/radarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selected.title,
          tmdbId: selected.tmdbId,
          qualityProfileId: Number(profileId),
          rootFolderPath: rootFolder,
          monitored: monitor !== 'none',
          tags: selectedTags,
          minimumAvailability: minAvailability,
          addOptions: { searchForMovie, monitor: monitor },
          titleSlug: selected.titleSlug,
          images: selected.images,
          year: selected.year,
        }),
      });
      if (res.ok) {
        const movie = await res.json();
        toast.success(`${selected.title} added`);
        router.push(`/movies/${movie.id}`);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add movie');
      }
    } catch { toast.error('Failed to add movie'); }
    finally { setAdding(false); }
  }

  const posterUrl = (images: { coverType: string; remoteUrl: string }[]) =>
    toCachedImageSrc(images.find((i) => i.coverType === 'poster')?.remoteUrl, 'radarr');

  const MONITOR_OPTIONS = [
    { value: 'movieOnly', label: 'Movie Only' },
    { value: 'movieAndCollection', label: 'Movie and Collection' },
    { value: 'none', label: 'None' },
  ];

  const MIN_AVAILABILITY_OPTIONS = [
    { value: 'announced', label: 'Announced' },
    { value: 'inCinemas', label: 'In Cinemas' },
    { value: 'released', label: 'Released' },
  ];

  function getMonitorLabel(value: string) {
    return MONITOR_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getMinAvailLabel(value: string) {
    return MIN_AVAILABILITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getProfileLabel(id: string) {
    return profiles.find((p) => String(p.id) === id)?.name ?? id;
  }

  function getRootFolderLabel(path: string) {
    return path || 'Select folder';
  }

  function toggleTag(tagId: number, checked: boolean) {
    setSelectedTags((prev) => {
      if (checked) {
        if (prev.includes(tagId)) return prev;
        return [...prev, tagId];
      }
      return prev.filter((id) => id !== tagId);
    });
  }

  function getTagsLabel() {
    if (selectedTags.length === 0) return 'No tags';
    if (selectedTags.length === 1) {
      return tags.find((tag) => tag.id === selectedTags[0])?.label ?? '1 tag';
    }
    return `${selectedTags.length} tags`;
  }

  const selectedInLibrary = selected?.library?.exists === true;
  const selectedPoster = selected
    ? posterUrl(selected.images as { coverType: string; remoteUrl: string }[])
    : null;

  useEffect(() => {
    const prefillTerm = searchParams.get('term');
    if (prefillTerm) setTerm(prefillTerm);
  }, [searchParams]);

  useEffect(() => {
    const prefillTerm = searchParams.get('term');
    const tmdbIdRaw = searchParams.get('tmdbId');
    const parsedTmdbId = tmdbIdRaw !== null ? Number(tmdbIdRaw) : null;
    const targetTmdbId = parsedTmdbId !== null && Number.isFinite(parsedTmdbId) ? parsedTmdbId : null;

    const hasPrefillChanged = (
      prefillTerm !== lastPrefillTermRef.current
      || targetTmdbId !== lastPrefillTmdbIdRef.current
    );

    if (!hasPrefillChanged) return;

    lastPrefillTermRef.current = prefillTerm;
    lastPrefillTmdbIdRef.current = targetTmdbId;
    setAutoSearched(false);
  }, [searchParams]);

  useEffect(() => {
    if (autoSearched) return;

    const prefillTerm = searchParams.get('term');
    if (!prefillTerm) return;

    const tmdbIdRaw = searchParams.get('tmdbId');
    const parsedTmdbId = tmdbIdRaw !== null ? Number(tmdbIdRaw) : null;
    const targetTmdbId = parsedTmdbId !== null && Number.isFinite(parsedTmdbId) ? parsedTmdbId : undefined;
    setAutoSearched(true);
    runSearch(prefillTerm, targetTmdbId);
  }, [searchParams, autoSearched, runSearch]);

  return (
    <div>
      <PageHeader title="Add Movie" />

      <div className="space-y-4 mt-1 pb-8">
        {/* Search form */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            placeholder="Search for a movie..."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="flex-1 h-10"
          />
          <Button type="submit" disabled={searching} className="h-10 w-10 p-0 shrink-0">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>

        {selected ? (
          <div className="space-y-5">
            {/* Movie info */}
            <div className="flex gap-4">
              {selectedPoster ? (
                <Image
                  src={selectedPoster}
                  alt=""
                  width={96}
                  height={144}
                  className="w-24 h-auto aspect-[2/3] object-cover rounded-lg shrink-0"
                  unoptimized={isProtectedApiImageSrc(selectedPoster)}
                />
              ) : (
                <div className="w-24 aspect-[2/3] bg-muted rounded-lg flex items-center justify-center shrink-0">
                  <Film className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold leading-tight">{selected.title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{selected.year}</p>
                {selectedInLibrary && (
                  <Badge className="mt-2 bg-green-600/90 text-white">
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Added
                  </Badge>
                )}
                {selected.overview && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-3 leading-snug">
                    {selected.overview}
                  </p>
                )}
              </div>
            </div>

            {selectedInLibrary ? (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
                This movie is already in your library.
              </div>
            ) : (
              <div className="grouped-section">
                <div className="grouped-section-title">Options</div>
                <div className="grouped-section-content">
                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Quality Profile</Label>
                    <Select value={profileId} onValueChange={setProfileId}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{getProfileLabel(profileId)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Root Folder</Label>
                    <Select value={rootFolder} onValueChange={setRootFolder}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5 max-w-[180px]">
                        <SelectValue>{getRootFolderLabel(rootFolder)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {rootFolders.map((f) => (
                          <SelectItem key={f.id} value={f.path}>{f.path}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Minimum Availability</Label>
                    <Select value={minAvailability} onValueChange={setMinAvailability}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{getMinAvailLabel(minAvailability)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {MIN_AVAILABILITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Monitor</Label>
                    <Select value={monitor} onValueChange={(v) => setMonitor(v as 'movieOnly' | 'movieAndCollection' | 'none')}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{getMonitorLabel(monitor)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {MONITOR_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div
                    className="grouped-row"
                    style={tags.length === 0 ? { borderBottom: 'none' } : undefined}
                  >
                    <Label className="text-sm shrink-0">Start Search For Missing Movie</Label>
                    <Switch checked={searchForMovie} onCheckedChange={setSearchForMovie} />
                  </div>

                  {tags.length > 0 && (
                    <div className="grouped-row" style={{ borderBottom: 'none' }}>
                      <Label className="text-sm shrink-0">Tags</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-end rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/40 transition-colors"
                          >
                            {getTagsLabel()}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {tags.map((tag) => (
                            <DropdownMenuCheckboxItem
                              key={tag.id}
                              checked={selectedTags.includes(tag.id)}
                              onCheckedChange={(checked) => toggleTag(tag.id, checked === true)}
                            >
                              {tag.label}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              {selectedInLibrary ? (
                <Button
                  className="flex-1 h-11"
                  onClick={() => {
                    if (selected.library?.id) router.push(`/movies/${selected.library.id}`);
                    else toast.error('Movie is already in library, but detail link is unavailable');
                  }}
                >
                  Open in Library
                </Button>
              ) : (
                <Button className="flex-1 h-11" onClick={handleAdd} disabled={adding}>
                  {adding ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add Movie
                </Button>
              )}
              <Button variant="ghost" className="flex-1 h-11" onClick={() => setSelected(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
            {searching
              ? [...Array(9)].map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-lg" />)
              : results.map((r) => {
                const poster = posterUrl(r.images as { coverType: string; remoteUrl: string }[]);
                return (
                  <button
                    key={r.tmdbId}
                    onClick={() => setSelected(r)}
                    className="text-left group"
                  >
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                      {poster ? (
                        <Image
                          src={poster}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw"
                          className="object-cover group-hover:scale-105 transition-transform"
                          unoptimized={isProtectedApiImageSrc(poster)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Film className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      {r.library?.exists && (
                        <div className="absolute top-1.5 right-1.5">
                          <Badge className="bg-green-600/90 text-white text-[10px]">
                            <Check className="mr-1 h-3 w-3" />
                            Added
                          </Badge>
                        </div>
                      )}
                      <div className="absolute bottom-0 p-1.5">
                        <p className="text-[11px] font-medium text-white truncate leading-tight">{r.title}</p>
                        <p className="text-[10px] text-white/70">{r.year}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AddMoviePage() {
  return (
    <Suspense fallback={<div className="px-4 py-6 text-sm text-muted-foreground">Loading add movie...</div>}>
      <AddMoviePageContent />
    </Suspense>
  );
}
