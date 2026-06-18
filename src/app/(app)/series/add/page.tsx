'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries } from '@/lib/query-invalidation';
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
import { Search, Plus, Loader2, Tv, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { SonarrLookupResult } from '@/types';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

function AddSeriesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [submittedTerm, setSubmittedTerm] = useState('');
  const [targetTvdbId, setTargetTvdbId] = useState<number | null>(null);
  const [targetTmdbId, setTargetTmdbId] = useState<number | null>(null);
  const [selected, setSelected] = useState<SonarrLookupResult | null>(null);
  const [profileId, setProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [monitorOption, setMonitorOption] = useState('all');
  const [searchForMissingEpisodes, setSearchForMissingEpisodes] = useState(true);
  const [seriesType, setSeriesType] = useState('standard');
  const [seasonFolder, setSeasonFolder] = useState(true);
  const [autoSearched, setAutoSearched] = useState(false);
  const [instanceId, setInstanceId] = useState<string | undefined>(undefined);

  const instancesQuery = useQuery({
    queryKey: queryKeys.instances(),
    queryFn: jsonFetcher<Array<{ id: string; type: string; label: string; isDefault: boolean }>>('/api/instances'),
    select: (all) =>
      (Array.isArray(all) ? all : [])
        .filter((c) => c.type === 'SONARR')
        .map((c) => ({ id: c.id, label: c.label, isDefault: c.isDefault })),
  });
  const instances = useMemo(() => instancesQuery.data ?? [], [instancesQuery.data]);

  // Per-instance reference data, shared (and deduped) with the list/edit pages.
  const { data: profiles = [] } = useQualityProfiles('sonarr', instanceId);
  const { data: rootFolders = [] } = useRootFolders('sonarr', instanceId);
  const lastAutoSearchParamsRef = useRef<{ term: string; tvdbId: string | null; tmdbId: string | null }>({
    term: '',
    tvdbId: null,
    tmdbId: null,
  });

  // Search runs against the submitted term; TanStack threads the AbortSignal so
  // an in-flight lookup is cancelled on a new search automatically.
  const lookupQuery = useQuery({
    queryKey: ['sonarr', 'lookup', submittedTerm],
    queryFn: jsonFetcher<SonarrLookupResult[]>(`/api/sonarr/lookup?term=${encodeURIComponent(submittedTerm)}`),
    enabled: submittedTerm.trim().length > 0,
    staleTime: 60_000,
  });
  const results = lookupQuery.data ?? [];
  const searching = lookupQuery.isFetching;

  // Default to the marked-default instance once instances load (picker shows when >1).
  useEffect(() => {
    if (instances.length === 0) return;
    setInstanceId((prev) => prev ?? instances.find((i) => i.isDefault)?.id ?? instances[0]?.id);
  }, [instances]);

  // Auto-select the prefilled result (by tvdbId or tmdbId) once the lookup resolves.
  useEffect(() => {
    if ((targetTvdbId == null && targetTmdbId == null) || !lookupQuery.data) return;
    const matched = lookupQuery.data.find((item) => {
      if (targetTvdbId != null && item.tvdbId === targetTvdbId) return true;
      if (targetTmdbId != null) return item.tmdbId === targetTmdbId;
      return false;
    });
    if (matched) setSelected(matched);
    setTargetTvdbId(null);
    setTargetTmdbId(null);
  }, [lookupQuery.data, targetTvdbId, targetTmdbId]);

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
  useEffect(() => {
    if (profiles.length === 0) return;
    setProfileId((prev) => (prev && profiles.some((p) => String(p.id) === prev) ? prev : String(profiles[0].id)));
  }, [profiles]);
  useEffect(() => {
    if (rootFolders.length === 0) return;
    setRootFolder((prev) => (prev && rootFolders.some((f) => f.path === prev) ? prev : rootFolders[0].path));
  }, [rootFolders]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSelected(null);
    setTargetTvdbId(null);
    setTargetTmdbId(null);
    setSubmittedTerm(term);
  }

  const addMutation = useMutation({
    mutationFn: async (payload: { title: string; [k: string]: unknown }) => {
      const res = await fetch('/api/sonarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new ApiError(res.status, err?.error || 'Failed to add series');
      }
      return res.json();
    },
    onSuccess: (s, payload) => {
      invalidateSeries(queryClient);
      toast.success(`${payload.title} added`);
      router.push(`/series/${s.id}${instanceId ? `?instance=${instanceId}` : ''}`);
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to add series');
    },
  });
  const adding = addMutation.isPending;

  function handleAdd() {
    if (!selected || !profileId || !rootFolder) return;
    if (selected.library?.exists) {
      if (selected.library.id) {
        router.push(`/series/${selected.library.id}${instanceId ? `?instance=${instanceId}` : ''}`);
        return;
      }
      toast.error('Series is already in library, but detail link is unavailable');
      return;
    }

    addMutation.mutate({
      instanceId,
      title: selected.title,
      tvdbId: selected.tvdbId,
      qualityProfileId: Number(profileId),
      rootFolderPath: rootFolder,
      monitored: monitorOption !== 'none',
      tags: selectedTags,
      seriesType,
      seasonFolder,
      titleSlug: selected.titleSlug,
      images: selected.images,
      seasons: selected.seasons,
      year: selected.year,
      addOptions: {
        monitor: monitorOption,
        searchForMissingEpisodes,
        searchForCutoffUnmetEpisodes: false,
      },
    });
  }

  const posterUrl = (images: { coverType: string; remoteUrl: string }[]) =>
    toCachedImageSrc(images.find((i) => i.coverType === 'poster')?.remoteUrl, 'sonarr');

  const MONITOR_OPTIONS = [
    { value: 'all', label: 'All Episodes' },
    { value: 'future', label: 'Future Episodes' },
    { value: 'missing', label: 'Missing Episodes' },
    { value: 'existing', label: 'Existing Episodes' },
    { value: 'recent', label: 'Recent Episodes' },
    { value: 'pilot', label: 'Pilot Episode' },
    { value: 'firstSeason', label: 'First Season' },
    { value: 'lastSeason', label: 'Last Season' },
    { value: 'monitorSpecials', label: 'Monitor Specials' },
    { value: 'unmonitorSpecials', label: 'Unmonitor Specials' },
    { value: 'none', label: 'None' },
  ];

  const SERIES_TYPE_OPTIONS = [
    { value: 'standard', label: 'Standard' },
    { value: 'daily', label: 'Daily' },
    { value: 'anime', label: 'Anime' },
  ];

  function getMonitorLabel(value: string) {
    return MONITOR_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getSeriesTypeLabel(value: string) {
    return SERIES_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
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

  useEffect(() => {
    const prefillTerm = searchParams.get('term');
    const tvdbId = searchParams.get('tvdbId');
    const tmdbId = searchParams.get('tmdbId');
    const nextTerm = prefillTerm ?? '';
    setTerm(nextTerm);

    const previousParams = lastAutoSearchParamsRef.current;
    if (
      previousParams.term !== nextTerm
      || previousParams.tvdbId !== tvdbId
      || previousParams.tmdbId !== tmdbId
    ) {
      setAutoSearched(false);
      setSelected(null);
      lastAutoSearchParamsRef.current = { term: nextTerm, tvdbId, tmdbId };
    }

    const prefillSeriesType = searchParams.get('seriesType');
    if (prefillSeriesType === 'anime' || prefillSeriesType === 'daily' || prefillSeriesType === 'standard') {
      setSeriesType(prefillSeriesType);
    }
  }, [searchParams]);

  useEffect(() => {
    if (autoSearched) return;

    const prefillTerm = searchParams.get('term');
    if (!prefillTerm) return;

    const tvdbIdParam = searchParams.get('tvdbId');
    const tmdbIdParam = searchParams.get('tmdbId');
    const tvdb = tvdbIdParam ? Number(tvdbIdParam) : null;
    const tmdb = tmdbIdParam ? Number(tmdbIdParam) : null;
    setAutoSearched(true);
    setTargetTvdbId(tvdb !== null && Number.isFinite(tvdb) ? tvdb : null);
    setTargetTmdbId(tmdb !== null && Number.isFinite(tmdb) ? tmdb : null);
    setSubmittedTerm(prefillTerm);
  }, [searchParams, autoSearched]);

  return (
    <div className="animate-content-in">
      <PageHeader title="Add Series" />

      <div className="space-y-4 mt-2 pb-8">
        {/* Search form */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <SearchInput
            placeholder="Search for a TV series..."
            value={term}
            onChange={setTerm}
            historyKey="series-add"
            onSubmit={(t) => {
              setSelected(null);
              setTargetTvdbId(null);
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
            {/* Series info */}
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
                  <Tv className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold leading-tight">{selected.title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {selected.year}{selected.network ? ` \u00b7 ${selected.network}` : ''}
                </p>
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
                This series is already in your library.
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
                    <Label className="text-sm shrink-0">Series Type</Label>
                    <Select value={seriesType} onValueChange={setSeriesType}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{getSeriesTypeLabel(seriesType)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SERIES_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Monitor</Label>
                    <Select value={monitorOption} onValueChange={setMonitorOption}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{getMonitorLabel(monitorOption)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {MONITOR_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Season Folders</Label>
                    <Switch checked={seasonFolder} onCheckedChange={setSeasonFolder} />
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Start Search For Missing Episodes</Label>
                    <Switch checked={searchForMissingEpisodes} onCheckedChange={setSearchForMissingEpisodes} />
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Tags</Label>
                    <TagSelector
                      service="sonarr"
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
                    if (selected.library?.id) router.push(`/series/${selected.library.id}${instanceId ? `?instance=${instanceId}` : ''}`);
                    else toast.error('Series is already in library, but detail link is unavailable');
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
                  Add Series
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
              : results.map((r) => (
                  <button
                    key={r.tvdbId}
                    onClick={() => setSelected(r)}
                    className="text-left group"
                  >
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                      {posterUrl(r.images as { coverType: string; remoteUrl: string }[]) ? (
                        <Image
                          src={posterUrl(r.images as { coverType: string; remoteUrl: string }[])!}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw"
                          className="object-cover group-hover:scale-105 transition-transform"
                          unoptimized={isProtectedApiImageSrc(posterUrl(r.images as { coverType: string; remoteUrl: string }[])!)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Tv className="h-8 w-8 text-muted-foreground" />
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
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AddSeriesPage() {
  return (
    <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">Loading add series...</div>}>
      <AddSeriesPageContent />
    </Suspense>
  );
}
