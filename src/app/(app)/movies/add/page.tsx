'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { invalidateMovies } from '@/lib/query-invalidation';
import { FadeInImage } from '@/components/media/fade-in-image';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/media/search-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PageSpinner } from '@/components/ui/page-spinner';
import { TagSelector } from '@/components/media/tag-selector';
import { Search, Plus, Loader2, Film, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { RadarrLookupResult } from '@/types';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

function AddMoviePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [submittedTerm, setSubmittedTerm] = useState('');
  const [targetTmdbId, setTargetTmdbId] = useState<number | null>(null);
  const [selected, setSelected] = useState<RadarrLookupResult | null>(null);
  const [profileId, setProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [monitor, setMonitor] = useState<'movieOnly' | 'movieAndCollection' | 'none'>('movieOnly');
  const [searchForMovie, setSearchForMovie] = useState(true);
  const [minAvailability, setMinAvailability] = useState('released');
  const [instanceId, setInstanceId] = useState<string | undefined>(undefined);

  const instancesQuery = useQuery({
    queryKey: queryKeys.instances(),
    queryFn: jsonFetcher<Array<{ id: string; type: string; label: string; isDefault: boolean }>>('/api/instances'),
    select: (all) =>
      (Array.isArray(all) ? all : [])
        .filter((c) => c.type === 'RADARR')
        .map((c) => ({ id: c.id, label: c.label, isDefault: c.isDefault })),
  });
  const instances = useMemo(() => instancesQuery.data ?? [], [instancesQuery.data]);

  // Per-instance reference data, shared (and deduped) with the list/edit pages.
  const { data: profiles = [] } = useQualityProfiles('radarr', instanceId);
  const { data: rootFolders = [] } = useRootFolders('radarr', instanceId);

  // Search runs against the submitted term (form submit / URL prefill set it).
  // TanStack threads the AbortSignal, so an in-flight lookup is cancelled on a
  // new search automatically (no manual abort ref needed).
  const lookupQuery = useQuery({
    queryKey: ['radarr', 'lookup', submittedTerm],
    queryFn: jsonFetcher<RadarrLookupResult[]>(`/api/radarr/lookup?term=${encodeURIComponent(submittedTerm)}`),
    enabled: submittedTerm.trim().length > 0,
    staleTime: 60_000,
  });
  const results = lookupQuery.data ?? [];
  const searching = lookupQuery.isFetching;

  // The blocks below adjust state during render (guarded so they converge)
  // instead of via setState-in-effect — see React's "adjusting state when
  // props change" pattern.

  // Default to the marked-default instance once instances load (picker shows when >1).
  if (instanceId === undefined && instances.length > 0) {
    setInstanceId(instances.find((i) => i.isDefault)?.id ?? instances[0]?.id);
  }

  // Tag ids are instance-local, so clear the selection when the instance changes —
  // otherwise a stale id from the previous instance gets POSTed. (Profile and root
  // folder re-default from the new instance's reference data below.)
  const [prevInstanceId, setPrevInstanceId] = useState(instanceId);
  if (instanceId !== prevInstanceId) {
    setPrevInstanceId(instanceId);
    setSelectedTags([]);
  }

  // Auto-select the prefilled result once the lookup resolves.
  if (targetTmdbId != null && lookupQuery.data) {
    setSelected(lookupQuery.data.find((item) => item.tmdbId === targetTmdbId) ?? null);
    setTargetTmdbId(null);
  }

  // Surface a non-401 lookup failure (a 401 is handled globally → redirect).
  useEffect(() => {
    if (!lookupQuery.isError) return;
    if (lookupQuery.error instanceof ApiError && lookupQuery.error.status === 401) return;
    toast.error('Search failed');
  }, [lookupQuery.isError, lookupQuery.error]);

  // Default the profile / root-folder selection to the first option when the
  // instance's reference data arrives. Keep a still-valid user choice on a
  // background refetch; re-default only when the current value is missing from
  // the fresh list (e.g. after switching instances).
  if (profiles.length > 0 && !(profileId && profiles.some((p) => String(p.id) === profileId))) {
    setProfileId(String(profiles[0].id));
  }
  if (rootFolders.length > 0 && !(rootFolder && rootFolders.some((f) => f.path === rootFolder))) {
    setRootFolder(rootFolders[0].path);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSelected(null);
    setTargetTmdbId(null);
    setSubmittedTerm(term);
  }

  const addMutation = useMutation({
    mutationFn: async (payload: { title: string; [k: string]: unknown }) => {
      const res = await fetch('/api/radarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new ApiError(res.status, err?.error || 'Failed to add movie');
      }
      return res.json();
    },
    onSuccess: (movie, payload) => {
      invalidateMovies(queryClient);
      toast.success(`${payload.title} added`);
      router.push(`/movies/${movie.id}${instanceId ? `?instance=${instanceId}` : ''}`);
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to add movie');
    },
  });
  const adding = addMutation.isPending;

  function handleAdd() {
    if (!selected || !profileId || !rootFolder) return;
    if (selected.library?.exists) {
      if (selected.library.id) {
        router.push(`/movies/${selected.library.id}${instanceId ? `?instance=${instanceId}` : ''}`);
        return;
      }
      toast.error('Movie is already in library, but detail link is unavailable');
      return;
    }

    addMutation.mutate({
      instanceId,
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
    });
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

  const selectedInLibrary = selected?.library?.exists === true;
  const selectedPoster = selected
    ? posterUrl(selected.images as { coverType: string; remoteUrl: string }[])
    : null;

  // Prefill from the URL (?term=&tmdbId=): fill the search box and fire the
  // lookup once per distinct prefill; re-fires if the params change in place.
  // Guarded during render.
  const prefillTerm = searchParams.get('term');
  const prefillTmdbRaw = searchParams.get('tmdbId');
  const parsedPrefillTmdbId = prefillTmdbRaw !== null ? Number(prefillTmdbRaw) : null;
  const prefillTmdbId =
    parsedPrefillTmdbId !== null && Number.isFinite(parsedPrefillTmdbId) ? parsedPrefillTmdbId : null;
  const [prevPrefill, setPrevPrefill] = useState<{ term: string | null; tmdbId: number | null } | null>(null);
  if (!prevPrefill || prevPrefill.term !== prefillTerm || prevPrefill.tmdbId !== prefillTmdbId) {
    setPrevPrefill({ term: prefillTerm, tmdbId: prefillTmdbId });
    if (prefillTerm) {
      setTerm(prefillTerm);
      setTargetTmdbId(prefillTmdbId);
      setSubmittedTerm(prefillTerm);
    }
  }

  return (
    <div className="animate-content-in">
      <PageHeader title="Add Movie" />

      <div className="space-y-4 mt-1 pb-8">
        {/* Search form */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <SearchInput
            placeholder="Search for a movie..."
            value={term}
            onChange={setTerm}
            historyKey="movies-add"
            onSubmit={(t) => {
              setSelected(null);
              setTargetTmdbId(null);
              setSubmittedTerm(t);
            }}
            wrapperClassName="flex-1"
            className="h-10"
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
                  <Badge className="mt-2 bg-green-600/90 text-foreground">
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
                  {instances.length > 1 && (
                    <div className="grouped-row">
                      <Label className="text-sm shrink-0">Instance</Label>
                      <Select value={instanceId ?? ''} onValueChange={setInstanceId}>
                        <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                          <SelectValue>{instances.find((i) => i.id === instanceId)?.label ?? 'Select'}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {instances.map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
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

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Start Search For Missing Movie</Label>
                    <Switch checked={searchForMovie} onCheckedChange={setSearchForMovie} />
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Tags</Label>
                    <TagSelector
                      service="radarr"
                      instanceId={instanceId}
                      value={selectedTags}
                      onChange={setSelectedTags}
                      className="justify-end"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              {selectedInLibrary ? (
                <Button
                  className="flex-1 h-11"
                  onClick={() => {
                    if (selected.library?.id) router.push(`/movies/${selected.library.id}${instanceId ? `?instance=${instanceId}` : ''}`);
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
              ? (
                  <div className="col-span-full flex justify-center">
                    <PageSpinner />
                  </div>
                )
              : results.map((r, i) => {
                const poster = posterUrl(r.images as { coverType: string; remoteUrl: string }[]);
                return (
                  <button
                    key={r.tmdbId}
                    onClick={() => setSelected(r)}
                    className="text-left group"
                  >
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                      {poster ? (
                        <FadeInImage
                          src={poster}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw"
                          priority={i < 4}
                          className="object-cover group-hover:scale-105 transition-transform"
                          unoptimized={isProtectedApiImageSrc(poster)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Film className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
                      {r.library?.exists && (
                        <div className="absolute top-1.5 right-1.5">
                          <Badge className="bg-green-600/90 text-foreground text-[10px]">
                            <Check className="mr-1 h-3 w-3" />
                            Added
                          </Badge>
                        </div>
                      )}
                      <div className="absolute bottom-0 p-1.5">
                        <p className="text-[11px] font-medium text-foreground truncate leading-tight">{r.title}</p>
                        <p className="text-[10px] text-foreground/70">{r.year}</p>
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
    <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">Loading add movie...</div>}>
      <AddMoviePageContent />
    </Suspense>
  );
}
