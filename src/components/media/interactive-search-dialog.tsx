'use client';

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Download, Loader2, AlertTriangle, ArrowUpDown, Users, HardDrive,
  Clock, ShieldAlert, Search, Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Release } from '@/types';

interface InteractiveSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  service: 'sonarr' | 'radarr';
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

type SortKey = 'quality' | 'size' | 'seeders' | 'age';

export function InteractiveSearchDialog({
  open,
  onOpenChange,
  title,
  service,
  searchParams,
  showSeasonPackFilter = false,
}: InteractiveSearchDialogProps) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('quality');
  const [sortAsc, setSortAsc] = useState(false);

  // Filters
  const [textFilter, setTextFilter] = useState('');
  const [indexerFilter, setIndexerFilter] = useState('all');
  const [qualityFilter, setQualityFilter] = useState('all');
  const [seasonPackFilter, setSeasonPackFilter] = useState<'any' | 'seasonPack' | 'singleEpisode'>('any');

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

  async function doSearch() {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(searchParams)) {
        params.set(k, String(v));
      }
      const res = await fetch(`/api/${service}/release?${params}`);
      if (res.ok) {
        const data = await res.json();
        setReleases(data);
      } else {
        toast.error('Search failed');
      }
    } catch {
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleGrab(release: Release) {
    setGrabbing(release.guid);
    try {
      const res = await fetch(`/api/${service}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid: release.guid, indexerId: release.indexerId }),
      });
      if (res.ok) {
        toast.success('Release grabbed');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Grab failed');
      }
    } catch {
      toast.error('Grab failed');
    } finally {
      setGrabbing(null);
    }
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
      setReleases([]);
      setSearched(false);
      setTextFilter('');
      setIndexerFilter('all');
      setQualityFilter('all');
      setSeasonPackFilter('any');
    }
    onOpenChange(v);
  }

  // Apply filters then sort
  const filteredAndSorted = useMemo(() => {
    let result = releases;

    if (textFilter) {
      const lower = textFilter.toLowerCase();
      result = result.filter((r) => r.title.toLowerCase().includes(lower));
    }
    if (indexerFilter !== 'all') {
      result = result.filter((r) => r.indexer === indexerFilter);
    }
    if (qualityFilter !== 'all') {
      result = result.filter((r) => r.quality?.quality?.name === qualityFilter);
    }
    if (seasonPackFilter === 'seasonPack') {
      result = result.filter((r) => r.fullSeason === true);
    } else if (seasonPackFilter === 'singleEpisode') {
      result = result.filter((r) => !r.fullSeason);
    }

    return [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
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
      }
      return sortAsc ? -cmp : cmp;
    });
  }, [releases, textFilter, indexerFilter, qualityFilter, seasonPackFilter, sortKey, sortAsc]);

  const hasActiveFilters = textFilter || indexerFilter !== 'all' || qualityFilter !== 'all' || seasonPackFilter !== 'any';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base truncate">Interactive Search: {title}</DialogTitle>
        </DialogHeader>

        {!searched ? (
          <div className="flex flex-col items-center py-8 gap-4">
            <p className="text-sm text-muted-foreground text-center">
              Search indexers for available releases. This may take a moment.
            </p>
            <Button onClick={doSearch} disabled={loading}>
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
            <div className="space-y-2 border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter releases..."
                    value={textFilter}
                    onChange={(e) => setTextFilter(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Select value={indexerFilter} onValueChange={setIndexerFilter}>
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue placeholder="Indexer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Indexers</SelectItem>
                    {indexers.map((idx) => (
                      <SelectItem key={idx} value={idx}>{idx}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={qualityFilter} onValueChange={setQualityFilter}>
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue placeholder="Quality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Qualities</SelectItem>
                    {qualities.map((q) => (
                      <SelectItem key={q} value={q}>{q}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showSeasonPackFilter && (
                  <Select value={seasonPackFilter} onValueChange={(v) => setSeasonPackFilter(v as 'any' | 'seasonPack' | 'singleEpisode')}>
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="seasonPack">Season Pack</SelectItem>
                      <SelectItem value="singleEpisode">Single Episode</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Sort controls + count */}
              <div className="flex items-center gap-1 flex-wrap text-xs">
                <span className="text-muted-foreground mr-1">Sort:</span>
                {(['quality', 'size', 'seeders', 'age'] as SortKey[]).map((key) => (
                  <Button
                    key={key}
                    variant={sortKey === key ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleSort(key)}
                  >
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                    {sortKey === key && (
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
            <div className="overflow-y-auto flex-1 space-y-1.5 -mx-1 px-1">
              {filteredAndSorted.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No releases match filters
                </div>
              ) : (
                filteredAndSorted.map((release) => {
                  const isRejected = release.rejected;
                  return (
                    <div
                      key={release.guid}
                      className={`rounded-lg border p-2.5 text-sm space-y-1.5 ${
                        isRejected ? 'opacity-60 border-destructive/30' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium leading-tight break-all line-clamp-2">
                            {release.title}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={isRejected ? 'outline' : 'default'}
                          className="h-7 px-2 shrink-0"
                          onClick={() => handleGrab(release)}
                          disabled={grabbing === release.guid}
                        >
                          {grabbing === release.guid ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant={isRejected ? 'destructive' : 'default'}
                          className="text-[10px]"
                        >
                          {release.quality?.quality?.name || 'Unknown'}
                        </Badge>
                        {protocolBadge(release.protocol)}
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
      </DialogContent>
    </Dialog>
  );
}
