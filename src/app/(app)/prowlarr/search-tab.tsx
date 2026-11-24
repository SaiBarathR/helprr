'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Download, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { formatBytes } from '@/lib/format';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { ApiError, ensureArray, jsonFetcher } from '@/lib/query-fetch';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import {
  compareSearchResults,
  PROWLARR_RESULTS_PER_SORT,
  PROWLARR_SEARCH_ID_FIELDS,
  PROWLARR_SEARCH_ID_LABELS,
  PROWLARR_SEARCH_SORTS as SORTS,
  PROWLARR_SEARCH_TYPES,
  type ProwlarrSearchIdField,
  type ProwlarrSearchSort as SortId,
  type ProwlarrSearchType,
} from '@/lib/prowlarr-search';
import type { ProwlarrSearchResponse, ProwlarrSearchResult } from '@/app/api/prowlarr/search/route';

const CATEGORIES = [
  { id: 2000, label: 'Movies' },
  { id: 5000, label: 'TV' },
  { id: 3000, label: 'Audio' },
  { id: 7000, label: 'Books' },
];

type SearchIds = Partial<Record<ProwlarrSearchIdField, string>>;

const TYPE_PLACEHOLDERS: Record<ProwlarrSearchType, string> = {
  search: 'Search all indexers',
  tvsearch: 'Search TV',
  movie: 'Search movies',
  music: 'Search music',
  book: 'Search books',
};

const ID_PLACEHOLDERS: Record<ProwlarrSearchIdField, string> = {
  tvdbId: '81189',
  imdbId: 'tt0903747',
  tmdbId: '1396',
  season: '1',
  episode: '1',
};

/** The ids the type takes, trimmed; an IMDb id typed without its "tt" gets one. */
function idsForType(type: ProwlarrSearchType, ids: SearchIds): SearchIds {
  const kept: SearchIds = {};
  for (const field of PROWLARR_SEARCH_ID_FIELDS[type]) {
    const value = ids[field]?.trim();
    if (value) kept[field] = field === 'imdbId' && /^\d+$/.test(value) ? `tt${value}` : value;
  }
  return kept;
}

function formatAge(publishDate: string | null): string | null {
  if (!publishDate) return null;
  const days = Math.floor((Date.now() - Date.parse(publishDate)) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return 'today';
  return days < 365 ? `${days}d` : `${Math.floor(days / 365)}y`;
}

/**
 * Search every indexer, or the ones picked, and send a release to Prowlarr's
 * own download client. This tab is a full page, so the search field's keyboard
 * is safe here. A search can take as long as the slowest indexer, so it can be
 * cancelled. The type, ids and indexers sit in one Options sheet, so the
 * toolbar stays one row on a phone.
 */
export function SearchTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useRouteViewState('searchDraft', '');
  const [categories, setCategories] = useRouteViewState<number[]>('searchCategories', []);
  const [type, setType] = useRouteViewState<ProwlarrSearchType>('searchType', 'search');
  const [ids, setIds] = useRouteViewState<SearchIds>('searchIds', {});
  // Empty means every enabled indexer.
  const [pickedIndexers, setPickedIndexers] = useRouteViewState<number[]>('searchIndexers', []);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [submitted, setSubmitted] = useRouteViewState<{
    query: string; categories: string; type?: ProwlarrSearchType; ids?: SearchIds; indexerIds?: string;
  } | null>('searchSubmitted', null);
  // A search hits every indexer and private trackers count them, so only the
  // Search button starts one: not a category chip, and not coming back to the tab.
  const [armed, setArmed] = useState(false);
  const [sort, setSort] = useRouteViewState<SortId>('searchSort', 'seeders');
  const [confirm, setConfirm] = useState<ProwlarrSearchResult | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [grabbed, setGrabbed] = useState<ReadonlySet<string>>(() => new Set());

  // The same list (and cache) as the Indexers tab.
  const indexersQuery = useQuery({
    queryKey: ['prowlarr', 'indexers'],
    queryFn: jsonFetcher<ProwlarrIndexerSummary[]>('/api/prowlarr/indexers'),
    select: ensureArray,
  });
  const enabledIndexers = useMemo(
    () => (indexersQuery.data ?? []).filter((indexer) => indexer.enable).sort((a, b) => a.name.localeCompare(b.name)),
    [indexersQuery.data],
  );
  // A remembered pick can name an indexer that has since gone or been disabled.
  const indexerIds = useMemo(
    () => pickedIndexers.filter((id) => enabledIndexers.some((indexer) => indexer.id === id)).sort((a, b) => a - b),
    [pickedIndexers, enabledIndexers],
  );
  const typedIds = idsForType(type, ids);
  const hasId = Boolean(typedIds.tvdbId || typedIds.imdbId || typedIds.tmdbId);
  const optionCount = (type === 'search' ? 0 : 1) + Object.keys(typedIds).length + (indexerIds.length > 0 ? 1 : 0);

  const queryKey = ['prowlarr', 'search', submitted];
  const searchQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: submitted?.query ?? '' });
      if (submitted?.categories) params.set('categories', submitted.categories);
      if (submitted?.type && submitted.type !== 'search') params.set('type', submitted.type);
      for (const [field, value] of Object.entries(submitted?.ids ?? {})) params.set(field, value);
      if (submitted?.indexerIds) params.set('indexerIds', submitted.indexerIds);
      return jsonFetcher<ProwlarrSearchResponse>(`/api/prowlarr/search?${params}`)({ signal });
    },
    enabled: armed && !!submitted,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });

  // The server keeps each sort's best rows, so this cut matches the one it made.
  const results = useMemo(
    () => [...(searchQuery.data?.results ?? [])]
      .sort((a, b) => compareSearchResults(a, b, sort))
      .slice(0, PROWLARR_RESULTS_PER_SORT),
    [searchQuery.data, sort],
  );
  const total = searchQuery.data?.total ?? results.length;
  // A refused search says why (an indexer gone, an id mistyped); anything else stays generic.
  const searchError = searchQuery.error instanceof ApiError && searchQuery.error.status === 400
    ? searchQuery.error.code
    : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      query: draft.trim(),
      categories: [...categories].sort().join(','),
      type,
      ids: typedIds,
      indexerIds: indexerIds.join(','),
    };
    setArmed(true);
    if (JSON.stringify(next) === JSON.stringify(submitted)) {
      void searchQuery.refetch();
    } else {
      setSubmitted(next);
    }
  }

  function toggleIndexer(id: number) {
    setPickedIndexers(() => {
      const current = indexerIds.length > 0 ? indexerIds : enabledIndexers.map((indexer) => indexer.id);
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      // Every one picked, or none left, is the same as all.
      return next.length === 0 || next.length === enabledIndexers.length ? [] : next;
    });
  }

  function resetOptions() {
    setType('search');
    setIds({});
    setPickedIndexers([]);
  }

  function toggleCategory(id: number) {
    setCategories((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  }

  function cancel() {
    void queryClient.cancelQueries({ queryKey });
    setArmed(false);
    setSubmitted(null);
  }

  async function grab(release: ProwlarrSearchResult) {
    setGrabbing(true);
    try {
      const res = await fetch('/api/prowlarr/search/grab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: release.id }),
      });
      if (res.ok) {
        toast.success('Sent to the download client');
        setGrabbed((prev) => new Set(prev).add(release.id));
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Grab failed');
      }
    } catch {
      toast.error('Grab failed');
    } finally {
      setGrabbing(false);
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={TYPE_PLACEHOLDERS[type]}
          aria-label={TYPE_PLACEHOLDERS[type]}
          enterKeyHint="search"
          maxLength={200}
        />
        <Button
          type="button"
          variant={optionCount > 0 ? 'default' : 'outline'}
          size="icon"
          className="relative shrink-0"
          aria-label={optionCount > 0 ? `Search options, ${optionCount} set` : 'Search options'}
          onClick={() => setOptionsOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {optionCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-background px-1 text-[10px] font-semibold text-foreground ring-1 ring-border">
              {optionCount}
            </span>
          )}
        </Button>
        <Button
          type="submit"
          className="shrink-0"
          disabled={(draft.trim().length < 2 && !hasId) || searchQuery.isFetching}
        >
          <Search className="h-4 w-4" /> Search
        </Button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((category) => (
          <Button
            key={category.id}
            variant={categories.includes(category.id) ? 'default' : 'outline'}
            size="sm"
            className="h-8 px-2.5 text-xs"
            aria-pressed={categories.includes(category.id)}
            onClick={() => toggleCategory(category.id)}
          >
            {category.label}
          </Button>
        ))}
      </div>

      {searchQuery.isFetching ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
          <p>
            {submitted?.indexerIds
              ? `Searching ${submitted.indexerIds.split(',').length === 1 ? 'one indexer' : `${submitted.indexerIds.split(',').length} indexers`}.`
              : 'Searching every indexer.'}{' '}
            This can take up to a minute.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 gap-1.5" onClick={cancel}>
            <X className="h-4 w-4" /> Cancel
          </Button>
        </div>
      ) : searchQuery.isError ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">
          {searchError ?? 'Search failed. Try again in a moment.'}
        </div>
      ) : searchQuery.isFetched && results.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">
          {submitted?.type && submitted.type !== 'search'
            ? 'No results came back. Prowlarr skips indexers that can’t search this way, so try Any, or check the warnings above.'
            : 'No results came back. If that looks wrong, an indexer may have failed: check the warnings above.'}
        </div>
      ) : results.length > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {total > results.length
                ? `Top ${results.length} of ${total}`
                : `${results.length} result${results.length !== 1 ? 's' : ''}`}
            </p>
            <div className="ml-auto flex gap-1" role="group" aria-label="Sort by">
              {SORTS.map((option) => (
                <Button
                  key={option.id}
                  variant={sort === option.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  aria-pressed={sort === option.id}
                  onClick={() => setSort(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
            {results.map((release) => {
              const age = formatAge(release.publishDate);
              const sent = grabbed.has(release.id);
              return (
                <div key={release.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium line-clamp-2 [overflow-wrap:anywhere]">{release.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${release.protocol === 'torrent' ? 'border-green-500/50 text-green-400' : 'border-blue-500/50 text-blue-400'}`}
                      >
                        {release.protocol}
                      </Badge>
                      <span>{release.indexer}</span>
                      <span>{formatBytes(release.size)}</span>
                      {release.seeders !== null && <span>{release.seeders} seeder{release.seeders === 1 ? '' : 's'}</span>}
                      {age && <span>{age}</span>}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label={sent ? `Sent: ${release.title}` : `Grab ${release.title}`}
                    disabled={sent}
                    onClick={() => setConfirm(release)}
                  >
                    {sent ? <Check className="h-4 w-4 text-green-500" /> : <Download className="h-4 w-4" />}
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <Drawer open={optionsOpen} onOpenChange={setOptionsOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Search options</DrawerTitle>
            <DrawerDescription>Used by the next search.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2 space-y-5 overflow-y-auto flex-1 min-h-0">
            <section className="space-y-2" aria-label="Search type">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Search type</p>
              <div className="flex flex-wrap gap-1.5">
                {PROWLARR_SEARCH_TYPES.map((option) => (
                  <Button
                    key={option.id}
                    variant={type === option.id ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    aria-pressed={type === option.id}
                    onClick={() => setType(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {PROWLARR_SEARCH_ID_FIELDS[type].length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {PROWLARR_SEARCH_ID_FIELDS[type].map((field) => (
                      <label key={field} className="space-y-1 text-xs text-muted-foreground">
                        <span>{PROWLARR_SEARCH_ID_LABELS[field]}</span>
                        <Input
                          value={ids[field] ?? ''}
                          onChange={(event) => setIds((prev) => ({ ...prev, [field]: event.target.value }))}
                          placeholder={ID_PLACEHOLDERS[field]}
                          inputMode={field === 'imdbId' ? 'text' : 'numeric'}
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          maxLength={12}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    With an ID the text can stay empty. Prowlarr skips indexers that can&rsquo;t search this way.
                  </p>
                </>
              )}
            </section>

            <section className="space-y-2" aria-label="Indexers">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Indexers</p>
                {indexerIds.length > 0 && (
                  <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setPickedIndexers([])}>
                    Use all
                  </Button>
                )}
              </div>
              {enabledIndexers.length > 0 ? (
                <div className="rounded-lg bg-muted/30 overflow-hidden divide-y divide-border/40">
                  {enabledIndexers.map((indexer) => {
                    const on = indexerIds.length === 0 || indexerIds.includes(indexer.id);
                    return (
                      <button
                        key={indexer.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleIndexer(indexer.id)}
                        className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm transition-colors hover:bg-accent/50"
                      >
                        <span className="min-w-0 flex-1 truncate">{indexer.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {[indexer.protocol, indexer.privacy].filter(Boolean).join(' · ')}
                        </span>
                        <Check className={`h-4 w-4 shrink-0 ${on ? 'text-primary' : 'invisible'}`} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {indexersQuery.isLoading ? 'Loading…' : indexersQuery.isError ? 'Failed to load indexers. Searches use all of them.' : 'No enabled indexers.'}
                </p>
              )}
            </section>
          </div>
          <DrawerFooter className="flex-row">
            <Button variant="outline" className="flex-1" onClick={resetOptions} disabled={optionCount === 0}>
              Reset
            </Button>
            <Button className="flex-1" onClick={() => setOptionsOpen(false)}>
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Grab this release?</DialogTitle>
            <DialogDescription className="[overflow-wrap:anywhere]">
              &ldquo;{confirm?.title}&rdquo; goes to Prowlarr&rsquo;s download client. Sonarr and Radarr won&rsquo;t track it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button className="flex-1" onClick={() => confirm && void grab(confirm)} disabled={grabbing}>
              {grabbing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Grab'}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
