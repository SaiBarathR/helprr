'use client';

import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import {
  Drawer, DrawerContent, DrawerTitle,
} from '@/components/ui/drawer';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/media/search-input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Download, Loader2, AlertTriangle, ArrowUpDown, Users, HardDrive,
  Clock, ShieldAlert, Search, Filter, X, Copy, ExternalLink,
  SlidersHorizontal, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Release, DownloadClient } from '@/types';

interface InteractiveSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  service: 'sonarr' | 'radarr' | 'lidarr';
  searchParams: Record<string, string | number>;
  showSeasonPackFilter?: boolean;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function protocolBadge(protocol: string) {
  if (protocol === 'usenet') return <Badge variant="secondary" className="text-[10px]">Usenet</Badge>;
  return <Badge variant="outline" className="text-[10px]">Torrent</Badge>;
}

// CF score badge — neutral at 0, green when positive, red when negative.
// Matched custom-format names (if any) surface as a tooltip to keep the row light.
function cfScoreBadge(score: number, formatNames?: string[]) {
  const tone = score > 0
    ? 'text-emerald-500 border-emerald-500/40'
    : score < 0
      ? 'text-rose-500 border-rose-500/40'
      : 'text-muted-foreground';
  return (
    <Badge
      variant="outline"
      className={`text-[10px] tabular-nums ${tone}`}
      title={formatNames && formatNames.length > 0 ? formatNames.join(', ') : undefined}
    >
      CF {score > 0 ? `+${score}` : score}
    </Badge>
  );
}

// Up to two language chips, then a "+k" overflow marker to protect the mobile row.
function languageChips(languages?: { id: number; name: string }[]) {
  const named = (languages ?? []).filter((l) => l.name);
  if (named.length === 0) return null;
  const shown = named.slice(0, 2);
  const extra = named.length - shown.length;
  return (
    <>
      {shown.map((lang, i) => (
        <Badge key={`${lang.id}-${i}`} variant="secondary" className="text-[10px]">{lang.name}</Badge>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-muted-foreground" title={named.map((l) => l.name).join(', ')}>+{extra}</span>
      )}
    </>
  );
}

type SortKey = 'quality' | 'size' | 'seeders' | 'age' | 'customFormatScore';

const SORT_LABELS: Record<SortKey, string> = {
  quality: 'Quality',
  size: 'Size',
  seeders: 'Seeders',
  age: 'Age',
  customFormatScore: 'CF Score',
};

/**
 * Renders a dialog UI for searching, filtering, sorting, and grabbing releases from Sonarr or Radarr.
 *
 * The component performs searches using the provided search parameters, displays results with filtering
 * and sorting controls, and supports adding releases to the download queue or overriding the download
 * client for a specific release.
 *
 * @param open - Whether the dialog is open
 * @param onOpenChange - Callback invoked when the dialog open state changes
 * @param title - Dialog title shown in the header
 * @param service - Service to query; either `'sonarr'` or `'radarr'`
 * @param searchParams - Key/value map of query parameters used when performing the indexer search
 * @param showSeasonPackFilter - When true, exposes controls to filter between season packs and single episodes
 * @returns A React element rendering the interactive search dialog UI
 */
export function InteractiveSearchDialog({
  open,
  onOpenChange,
  title,
  service,
  searchParams,
  showSeasonPackFilter = false,
}: InteractiveSearchDialogProps) {
  const [searched, setSearched] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('quality');
  const [sortAsc, setSortAsc] = useState(false);

  // Filters
  const [textFilter, setTextFilter] = useState('');
  const [indexerFilter, setIndexerFilter] = useState<string[]>([]);
  const [qualityFilter, setQualityFilter] = useState<string[]>([]);
  const [languageFilter, setLanguageFilter] = useState<string[]>([]);
  const [seasonPackFilter, setSeasonPackFilter] = useState<'any' | 'seasonPack' | 'singleEpisode'>('any');

  // Override state
  const [overrideRelease, setOverrideRelease] = useState<Release | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const searchQueryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) params.set(k, String(v));
    return params.toString();
  }, [searchParams]);
  const releaseUrl = `/api/${service}/release?${searchQueryString}`;

  // Release search is manual (button-triggered) — enabled:false, run via refetch.
  // jsonFetcher throws on !ok so a 401 (revoked session) redirects via the global
  // handler; other failures surface below as a "Search failed" toast.
  const releasesQuery = useQuery({
    queryKey: ['release-search', service, searchQueryString],
    queryFn: jsonFetcher<Release[]>(releaseUrl),
    enabled: false,
  });
  const releases = useMemo(() => releasesQuery.data ?? [], [releasesQuery.data]);
  const loading = releasesQuery.isFetching;

  useEffect(() => {
    if (releasesQuery.isError && !(releasesQuery.error instanceof ApiError && releasesQuery.error.status === 401)) {
      toast.error('Search failed');
    }
  }, [releasesQuery.isError, releasesQuery.error]);

  // Download clients load lazily when the override sheet opens (cached after).
  const clientsQuery = useQuery({
    queryKey: [service, 'downloadclients', searchQueryString],
    queryFn: jsonFetcher<DownloadClient[]>(`/api/${service}/downloadclient?${searchQueryString}`),
    enabled: overrideRelease !== null,
    select: (d) => (Array.isArray(d) ? d.filter((c) => c.enable) : []),
  });
  const downloadClients = clientsQuery.data ?? [];
  const loadingClients = clientsQuery.isLoading;

  useEffect(() => {
    if (clientsQuery.isError && !(clientsQuery.error instanceof ApiError && clientsQuery.error.status === 401)) {
      toast.error('Failed to load download clients');
    }
  }, [clientsQuery.isError, clientsQuery.error]);

  const grabMutation = useMutation({
    mutationFn: async (release: Release) => {
      const res = await fetch(releaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid: release.guid, indexerId: release.indexerId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error || 'Grab failed');
      }
    },
    onSuccess: () => toast.success('Added to download queue'),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Grab failed');
    },
  });
  // Per-release spinner: the guid of the release currently being grabbed (or null).
  const grabbing = grabMutation.isPending ? (grabMutation.variables?.guid ?? null) : null;

  const overrideGrabMutation = useMutation({
    mutationFn: async (vars: { release: Release; clientId: number | null }) => {
      const body: Record<string, unknown> = { guid: vars.release.guid, indexerId: vars.release.indexerId };
      if (vars.clientId !== null) body.downloadClientId = vars.clientId;
      const res = await fetch(releaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error || 'Grab failed');
      }
    },
    onSuccess: () => {
      toast.success('Added to download queue');
      setOverrideRelease(null);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Grab failed');
    },
  });
  const overriding = overrideGrabMutation.isPending;

  // Derive available indexers and qualities from results
  const indexers = useMemo(() => {
    const set = new Set<string>();
    releases.forEach((r) => { if (r.indexer) set.add(r.indexer); });
    return [...set].sort();
  }, [releases]);

  const qualities = useMemo(() => {
    const set = new Set<string>();
    releases.forEach((r) => {
      const name = r.quality?.quality?.name;
      if (name) set.add(name);
    });
    return [...set].sort();
  }, [releases]);

  const languageFacets = useMemo(() => {
    const set = new Set<string>();
    releases.forEach((r) => {
      r.languages?.forEach((l) => { if (l.name) set.add(l.name); });
    });
    return [...set].sort();
  }, [releases]);

  // Only surface CF-score UI when at least one release actually has a non-zero
  // score — otherwise every value is 0 and the badge/sort key would be noise.
  const hasCfScores = useMemo(
    () => releases.some((r) => (r.customFormatScore ?? 0) !== 0),
    [releases],
  );

  function doSearch() {
    setSearched(true);
    void releasesQuery.refetch();
  }

  function handleGrab(release: Release) {
    grabMutation.mutate(release);
  }

  function openOverride(release: Release) {
    setOverrideRelease(release);
    setSelectedClientId(null);
  }

  function handleOverrideGrab() {
    if (!overrideRelease) return;
    overrideGrabMutation.mutate({ release: overrideRelease, clientId: selectedClientId });
  }

  function copyToClipboard(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      toast.success('Link copied');
    }).catch(() => {
      toast.error('Failed to copy');
    });
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      queryClient.removeQueries({ queryKey: ['release-search', service, searchQueryString] });
      setSearched(false);
      setTextFilter('');
      setIndexerFilter([]);
      setQualityFilter([]);
      setLanguageFilter([]);
      setSeasonPackFilter('any');
    }
    onOpenChange(v);
  }

  // sortKey persists across opens (the filters reset, sort doesn't), so a prior
  // 'customFormatScore' selection can outlive the CF-score UI when the next
  // search has no scores. Fall back to the default so a hidden key can't sort.
  const activeSortKey: SortKey = sortKey === 'customFormatScore' && !hasCfScores ? 'quality' : sortKey;

  // Apply filters then sort
  const filteredAndSorted = useMemo(() => {
    let result = releases;

    if (textFilter) {
      const lower = textFilter.toLowerCase();
      result = result.filter((r) => r.title.toLowerCase().includes(lower));
    }
    if (indexerFilter.length > 0) {
      result = result.filter((r) => !!r.indexer && indexerFilter.includes(r.indexer));
    }
    if (qualityFilter.length > 0) {
      result = result.filter((r) => {
        const name = r.quality?.quality?.name;
        return !!name && qualityFilter.includes(name);
      });
    }
    if (languageFilter.length > 0) {
      result = result.filter((r) => r.languages?.some((l) => languageFilter.includes(l.name)));
    }
    if (seasonPackFilter === 'seasonPack') {
      result = result.filter((r) => r.fullSeason === true);
    } else if (seasonPackFilter === 'singleEpisode') {
      result = result.filter((r) => !r.fullSeason);
    }

    return [...result].sort((a, b) => {
      let cmp = 0;
      switch (activeSortKey) {
        case 'quality':
          cmp = (b.qualityWeight || 0) - (a.qualityWeight || 0);
          break;
        case 'size':
          cmp = b.size - a.size;
          break;
        case 'seeders':
          cmp = (b.seeders || 0) - (a.seeders || 0);
          break;
        case 'age':
          cmp = (a.age || 0) - (b.age || 0);
          break;
        case 'customFormatScore':
          cmp = (b.customFormatScore || 0) - (a.customFormatScore || 0);
          break;
      }
      return sortAsc ? -cmp : cmp;
    });
  }, [releases, textFilter, indexerFilter, qualityFilter, languageFilter, seasonPackFilter, activeSortKey, sortAsc]);

  const hasActiveFilters = !!textFilter || indexerFilter.length > 0 || qualityFilter.length > 0 || languageFilter.length > 0 || seasonPackFilter !== 'any';

  return (
    <>
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent>
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-base font-semibold truncate pr-2">{title}</h2>
            <button
              onClick={() => handleOpenChange(false)}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full hover:bg-muted shrink-0"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col px-4 pb-4">
            {!searched ? (
              <div className="flex flex-col items-center py-8 gap-4">
                <p className="text-sm text-muted-foreground text-center">
                  Search indexers for available releases.
                </p>
                <Button onClick={doSearch} disabled={loading} className="rounded-full">
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  Search Indexers
                </Button>
              </div>
            ) : loading ? (
              <div className="space-y-2 py-4">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : releases.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No releases found</p>
                <Button variant="ghost" className="mt-2" onClick={doSearch}>
                  Try again
                </Button>
              </div>
            ) : (
              <>
                {/* Filters */}
                <div className="space-y-2 border-b pb-2 mb-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <SearchInput
                        placeholder="Filter releases..."
                        value={textFilter}
                        onChange={setTextFilter}
                        historyKey="interactive-search"
                        className="h-9 pl-8 text-sm"
                      />
                    </div>
                    {/* Filter dropdowns */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent">
                          <ArrowUpDown className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>Indexer</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                          checked={indexerFilter.length === 0}
                          onCheckedChange={() => setIndexerFilter([])}
                          onSelect={(e) => e.preventDefault()}
                        >
                          All Indexers
                        </DropdownMenuCheckboxItem>
                        {indexers.map((idx) => (
                          <DropdownMenuCheckboxItem
                            key={idx}
                            checked={indexerFilter.includes(idx)}
                            onCheckedChange={() => setIndexerFilter((prev) => (
                              prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]
                            ))}
                            onSelect={(e) => e.preventDefault()}
                          >
                            {idx}
                          </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Quality</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem
                          checked={qualityFilter.length === 0}
                          onCheckedChange={() => setQualityFilter([])}
                          onSelect={(e) => e.preventDefault()}
                        >
                          All Qualities
                        </DropdownMenuCheckboxItem>
                        {qualities.map((q) => (
                          <DropdownMenuCheckboxItem
                            key={q}
                            checked={qualityFilter.includes(q)}
                            onCheckedChange={() => setQualityFilter((prev) => (
                              prev.includes(q) ? prev.filter((x) => x !== q) : [...prev, q]
                            ))}
                            onSelect={(e) => e.preventDefault()}
                          >
                            {q}
                          </DropdownMenuCheckboxItem>
                        ))}
                        {languageFacets.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Language</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem
                              checked={languageFilter.length === 0}
                              onCheckedChange={() => setLanguageFilter([])}
                              onSelect={(e) => e.preventDefault()}
                            >
                              All Languages
                            </DropdownMenuCheckboxItem>
                            {languageFacets.map((lang) => (
                              <DropdownMenuCheckboxItem
                                key={lang}
                                checked={languageFilter.includes(lang)}
                                onCheckedChange={() => setLanguageFilter((prev) => (
                                  prev.includes(lang) ? prev.filter((x) => x !== lang) : [...prev, lang]
                                ))}
                                onSelect={(e) => e.preventDefault()}
                              >
                                {lang}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </>
                        )}
                        {showSeasonPackFilter && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Type</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuRadioGroup
                              value={seasonPackFilter}
                              onValueChange={(v) => setSeasonPackFilter(v as typeof seasonPackFilter)}
                            >
                              <DropdownMenuRadioItem value="any" onSelect={(e) => e.preventDefault()}>
                                Any
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="seasonPack" onSelect={(e) => e.preventDefault()}>
                                Season Pack
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="singleEpisode" onSelect={(e) => e.preventDefault()}>
                                Single Episode
                              </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Sort controls + count */}
                  <div className="flex items-center gap-1 flex-wrap text-xs">
                    <span className="text-muted-foreground mr-1">Sort:</span>
                    {(['quality', 'size', 'seeders', 'age', ...(hasCfScores ? ['customFormatScore'] as const : [])] as SortKey[]).map((key) => (
                      <Button
                        key={key}
                        variant={activeSortKey === key ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleSort(key)}
                      >
                        {SORT_LABELS[key]}
                        {activeSortKey === key && (
                          <ArrowUpDown className="ml-1 h-3 w-3" />
                        )}
                      </Button>
                    ))}
                    <span className="ml-auto text-muted-foreground">
                      {hasActiveFilters
                        ? `${filteredAndSorted.length} / ${releases.length}`
                        : `${releases.length} results`}
                    </span>
                  </div>
                </div>

                {/* Release list */}
                <div className="overflow-y-auto flex-1 space-y-1.5">
                  {filteredAndSorted.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No releases match filters
                    </div>
                  ) : (
                    filteredAndSorted.map((release) => {
                      const isRejected = release.rejected;
                      const isTorrent = release.protocol === 'torrent';
                      const infoUrl = release.infoUrl;
                      return (
                        <div
                          key={release.guid}
                          className={`rounded-lg border p-2.5 text-sm space-y-1.5 ${isRejected ? 'opacity-60 border-destructive/30' : ''
                            }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium leading-tight break-all line-clamp-2">
                                {release.title}
                              </p>
                            </div>
                            {/* Action buttons */}
                            <div className="flex items-center gap-1 shrink-0">
                              {/* Copy indexer page URL */}
                              {isTorrent && infoUrl && (
                                <button
                                  className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                  title="Copy indexer page URL"
                                  onClick={() => copyToClipboard(infoUrl)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {/* Open indexer page in new tab */}
                              {isTorrent && infoUrl && (
                                <a
                                  href={infoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                  title="Open indexer page in new tab"
                                  aria-label='Open indexer page in new tab'
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {/* Add to download queue */}
                              <button
                                className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                                title="Add to download queue"
                                onClick={() => handleGrab(release)}
                                disabled={grabbing === release.guid}
                                aria-label="Add to download queue"
                              >
                                {grabbing === release.guid ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                              </button>
                              {/* Override and add to download queue */}
                              <button
                                className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                                title="Override and add to download queue"
                                aria-label="Override and add to download queue"
                                onClick={() => openOverride(release)}
                                disabled={grabbing === release.guid}
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              variant={isRejected ? 'destructive' : 'default'}
                              className="text-[10px]"
                            >
                              {release.quality?.quality?.name || 'Unknown'}
                            </Badge>
                            {protocolBadge(release.protocol)}
                            {hasCfScores && cfScoreBadge(
                              release.customFormatScore ?? 0,
                              release.customFormats?.map((f) => f.name),
                            )}
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <HardDrive className="h-3 w-3" />
                              {formatBytes(release.size)}
                            </span>
                            {release.protocol === 'torrent' && (
                              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                                <Users className="h-3 w-3" />
                                {release.seeders ?? 0}/{release.leechers ?? 0}
                              </span>
                            )}
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {release.age}d
                            </span>
                            {release.indexer && (
                              <span className="text-xs text-muted-foreground">{release.indexer}</span>
                            )}
                            {release.releaseGroup && (
                              <Badge variant="outline" className="text-[10px]">{release.releaseGroup}</Badge>
                            )}
                            {languageChips(release.languages)}
                          </div>
                          {isRejected && release.rejections?.length > 0 && (
                            <div className="flex items-start gap-1 text-xs text-destructive">
                              <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
                              <span className="line-clamp-2">{release.rejections.join('; ')}</span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Override download client dialog */}
      <Dialog open={overrideRelease !== null} onOpenChange={(v) => { if (!v) setOverrideRelease(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Override Download Client</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {overrideRelease && (
              <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{overrideRelease.title}</p>
            )}
            {loadingClients ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : downloadClients.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No download clients found</p>
            ) : (
              <div className="space-y-1.5">
                {downloadClients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${selectedClientId === client.id
                      ? 'border-primary bg-primary/10'
                      : 'hover:bg-accent'
                      }`}
                  >
                    <span className="font-medium">{client.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{client.protocol}</Badge>
                      {selectedClientId === client.id && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOverrideRelease(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleOverrideGrab}
              disabled={overriding || loadingClients || downloadClients.length === 0}
            >
              {overriding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {selectedClientId ? 'Grab with Override' : 'Grab (Default)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
