'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries } from '@/lib/query-invalidation';
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
import { AddPageInstanceSelect } from '@/components/media/add-page-instance-select';
import { Search, Plus, Loader2, Tv, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { SonarrLookupResult } from '@/types';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { resolveAddPageInstance } from '@/lib/add-page-instances';

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

  // Search runs against the submitted term; TanStack threads the AbortSignal so
  // an in-flight lookup is cancelled on a new search automatically.
  const lookupQuery = useQuery({
    queryKey: ['sonarr', 'lookup', instanceId ?? 'default', submittedTerm],
    queryFn: jsonFetcher<SonarrLookupResult[]>(`/api/sonarr/lookup?term=${encodeURIComponent(submittedTerm)}`, instanceId),
    enabled: submittedTerm.trim().length > 0,
    staleTime: 60_000,
  });
  const results = lookupQuery.data ?? [];
  const searching = lookupQuery.isFetching;

  // The blocks below adjust state during render (guarded so they converge)
  // instead of via setState-in-effect — see React's "adjusting state when
  // props change" pattern.

  // Respect instance-targeted links, then fall back to the marked default.
  if (instanceId === undefined && instances.length > 0) {
    setInstanceId(resolveAddPageInstance(instances, searchParams.get('instance')));
  }

  // Switching instances invalidates the previously-picked (instance-local)
  // profile/folder/tag ids — clear them so a stale value can't be POSTed before
  // the new instance's reference data arrives (the defaults below re-apply).
  const [prevInstanceId, setPrevInstanceId] = useState(instanceId);
  if (instanceId !== prevInstanceId) {
    setPrevInstanceId(instanceId);
    setProfileId('');
    setRootFolder('');
    setSelectedTags([]);
  }

  // Auto-select the prefilled result (by tvdbId or tmdbId) once the lookup resolves.
  if ((targetTvdbId != null || targetTmdbId != null) && lookupQuery.data) {
    const matched = lookupQuery.data.find((item) => {
      if (targetTvdbId != null && item.tvdbId === targetTvdbId) return true;
      if (targetTmdbId != null) return item.tmdbId === targetTmdbId;
      return false;
    });
    if (matched) setSelected(matched);
    setTargetTvdbId(null);
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
    setTargetTvdbId(null);
    setTargetTmdbId(null);
    setSubmittedTerm(term);
  }

  function handleInstanceChange(nextInstanceId: string) {
    if (nextInstanceId === instanceId) return;
    if (selected) {
      setTargetTvdbId(selected.tvdbId);
      setTargetTmdbId(selected.tmdbId ?? null);
    }
    setSelected(null);
    setInstanceId(nextInstanceId);
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
  const selectedInstanceLabel = instances.find((instance) => instance.id === instanceId)?.label;
  const selectedPoster = selected
    ? posterUrl(selected.images as { coverType: string; remoteUrl: string }[])
    : null;

  // Prefill from the URL (?term=&tvdbId=&tmdbId=): fill the search box and
  // fire the lookup once per distinct prefill; re-fires if the params change
  // in place. Guarded during render.
  const prefillTerm = searchParams.get('term') ?? '';
  const prefillTvdbRaw = searchParams.get('tvdbId');
  const prefillTmdbRaw = searchParams.get('tmdbId');
  const [prevPrefill, setPrevPrefill] = useState<{ term: string; tvdbId: string | null; tmdbId: string | null }>({
    term: '',
    tvdbId: null,
    tmdbId: null,
  });
  if (
    prevPrefill.term !== prefillTerm
    || prevPrefill.tvdbId !== prefillTvdbRaw
    || prevPrefill.tmdbId !== prefillTmdbRaw
  ) {
    setPrevPrefill({ term: prefillTerm, tvdbId: prefillTvdbRaw, tmdbId: prefillTmdbRaw });
    setTerm(prefillTerm);
    setSelected(null);
    if (prefillTerm) {
      const tvdb = prefillTvdbRaw ? Number(prefillTvdbRaw) : null;
      const tmdb = prefillTmdbRaw ? Number(prefillTmdbRaw) : null;
      setTargetTvdbId(tvdb !== null && Number.isFinite(tvdb) ? tvdb : null);
      setTargetTmdbId(tmdb !== null && Number.isFinite(tmdb) ? tmdb : null);
      setSubmittedTerm(prefillTerm);
    }
  }

  // Series-type prefill (?seriesType=), tracked separately so it applies even
  // when the search prefill hasn't changed.
  const prefillSeriesType = searchParams.get('seriesType');
  const [prevSeriesTypeParam, setPrevSeriesTypeParam] = useState<string | null>(null);
  if (prevSeriesTypeParam !== prefillSeriesType) {
    setPrevSeriesTypeParam(prefillSeriesType);
    if (prefillSeriesType === 'anime' || prefillSeriesType === 'daily' || prefillSeriesType === 'standard') {
      setSeriesType(prefillSeriesType);
    }
  }

  return (
    <div className="animate-content-in">
      <PageHeader
        title="Add Series"
        rightContent={
          <AddPageInstanceSelect
            instances={instances}
            value={instanceId}
            onChange={handleInstanceChange}
            disabled={adding}
          />
        }
      />

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
                This series is already in {selectedInstanceLabel ?? 'the selected instance'}.
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
              : results.map((r, i) => (
                  <button
                    key={r.tvdbId}
                    onClick={() => setSelected(r)}
                    className="text-left group"
                  >
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                      {posterUrl(r.images as { coverType: string; remoteUrl: string }[]) ? (
                        <FadeInImage
                          src={posterUrl(r.images as { coverType: string; remoteUrl: string }[])!}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw"
                          priority={i < 4}
                          className="object-cover group-hover:scale-105 transition-transform"
                          unoptimized={isProtectedApiImageSrc(posterUrl(r.images as { coverType: string; remoteUrl: string }[])!)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Tv className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
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
                        <p className="text-[10px] text-white/75">{r.year}</p>
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
