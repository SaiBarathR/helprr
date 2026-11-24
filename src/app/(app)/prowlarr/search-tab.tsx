'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronDown, Download, Loader2, Search, Send, SlidersHorizontal, X } from 'lucide-react';
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
import { useCan } from '@/components/permission-provider';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { formatBytes } from '@/lib/format';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { ApiError, ensureArray, jsonFetcher } from '@/lib/query-fetch';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import {
  compareSearchResults,
  PROWLARR_RESULTS_PER_SORT,
  PROWLARR_SEARCH_ID_FIELDS,
  PROWLARR_RELEASE_FLAGS,
  PROWLARR_SEARCH_ID_LABELS,
  PROWLARR_SEARCH_SORTS as SORTS,
  PROWLARR_SEARCH_TYPES,
  type ProwlarrCategory,
  type ProwlarrSearchIdField,
  type ProwlarrSearchSort as SortId,
  type ProwlarrSearchType,
} from '@/lib/prowlarr-search';
import type { ProwlarrSearchResponse, ProwlarrSearchResult } from '@/app/api/prowlarr/search/route';
import type { ProwlarrDownloadClientSummary } from '@/app/api/prowlarr/downloadclients/route';
import { SendToArrSheet } from './send-to-arr-sheet';

// One tap under the field; the rest of Prowlarr's tree is in Search options.
const CATEGORIES = [
  { id: 2000, label: 'Movies' },
  { id: 5000, label: 'TV' },
  { id: 3000, label: 'Audio' },
  { id: 7000, label: 'Books' },
];
const QUICK_CATEGORY_IDS = new Set(CATEGORIES.map(({ id }) => id));

type SearchIds = Partial<Record<ProwlarrSearchIdField, string>>;

const TYPE_PLACEHOLDERS: Record<ProwlarrSearchType, string> = {
  // Short enough to fit beside the two buttons at 320 px.
  search: 'Search indexers',
  tvsearch: 'Search TV',
  movie: 'Search movies',
  music: 'Search music',
  book: 'Search books',
};

// Marked as examples, so an empty field never reads as one already filled in.
const ID_PLACEHOLDERS: Record<ProwlarrSearchIdField, string> = {
  tvdbId: 'e.g. 81189',
  imdbId: 'e.g. tt0903747',
  tmdbId: 'e.g. 1396',
  season: 'e.g. 1',
  episode: 'e.g. 1',
};

/** The ids the type takes, trimmed; an IMDb id typed without its "tt" gets one. */
function idsForType(type: ProwlarrSearchType, ids: SearchIds): SearchIds {
  const kept: SearchIds = {};
  for (const field of PROWLARR_SEARCH_ID_FIELDS[type]) {
    const value = ids[field]?.trim();
    if (!value) continue;
    // IMDb ids are lower case ("tt…"); a phone may capitalise the first letter.
    const id = field === 'imdbId' ? value.toLowerCase() : value;
    kept[field] = field === 'imdbId' && /^\d+$/.test(id) ? `tt${id}` : id;
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
 * own download client, or (a torrent) to Sonarr or Radarr for one title.
 * prowlarr.search is enough to search; grabbing and sending need
 * prowlarr.manage, so those buttons show only with it. This tab is a full page, so the search field's keyboard
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
  // Null means every enabled indexer; an empty pick means none, and no search
  // starts until one is ticked, so clearing the list never widens it to all
  // (private trackers included).
  const [pickedIndexers, setPickedIndexers] = useRouteViewState<number[] | null>('searchIndexers', null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const isMobile = useIsMobile();
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
  const [sending, setSending] = useState<ProwlarrSearchResult | null>(null);
  // Null leaves the choice to Prowlarr; kept for the next grab.
  const [grabClient, setGrabClient] = useState<number | null>(null);
  const [openCategories, setOpenCategories] = useState<ReadonlySet<number>>(() => new Set());
  const canManage = useCan('prowlarr.manage');
  // What a manual download needs; the server checks it all again, with prowlarr.manage.
  const canAddTorrents = useCan('torrents.add');
  const canManageActivity = useCan('activity.manage');
  const canAddMovies = useCan('movies.add');
  const canAddSeries = useCan('series.add');
  const canSendToArr = canManage && canAddTorrents && canManageActivity && (canAddMovies || canAddSeries);

  // The same list (and cache) as the Indexers tab.
  const indexersQuery = useQuery({
    queryKey: ['prowlarr', 'indexers'],
    queryFn: jsonFetcher<ProwlarrIndexerSummary[]>('/api/prowlarr/indexers'),
    select: ensureArray,
  });
  const categoriesQuery = useQuery({
    queryKey: ['prowlarr', 'categories'],
    queryFn: jsonFetcher<ProwlarrCategory[]>('/api/prowlarr/categories'),
    select: ensureArray,
    staleTime: 10 * 60_000,
  });
  const categoryNames = useMemo(() => new Map(
    (categoriesQuery.data ?? []).flatMap(({ id, name, subCategories }) => [[id, name] as const, ...subCategories.map((sub) => [sub.id, sub.name] as const)]),
  ), [categoriesQuery.data]);
  const enabledIndexers = useMemo(
    () => (indexersQuery.data ?? []).filter((indexer) => indexer.enable).sort((a, b) => a.name.localeCompare(b.name)),
    [indexersQuery.data],
  );
  // Sent as remembered, even when the list hasn't loaded or an indexer has
  // since gone or been disabled: dropping those ids could leave none, which
  // means every indexer, private trackers the user left out included. The
  // server refuses a stale pick and says to pick again.
  const indexerIds = useMemo(() => [...(pickedIndexers ?? [])].sort((a, b) => a - b), [pickedIndexers]);
  const noIndexers = pickedIndexers !== null && pickedIndexers.length === 0;
  const typedIds = idsForType(type, ids);
  const hasId = Boolean(typedIds.tvdbId || typedIds.imdbId || typedIds.tmdbId);
  const optionCount = (type === 'search' ? 0 : 1) + Object.keys(typedIds).length + (pickedIndexers !== null ? 1 : 0);

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
    // With no indexer ticked, a pull-to-refresh or retry that invalidates
    // every query must not run the last search again either.
    enabled: armed && !!submitted && !noIndexers,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });

  // Asked for once there are results to grab, and only with manage, so the
  // picker is there when the grab dialog opens rather than popping in.
  const clientsQuery = useQuery({
    queryKey: ['prowlarr', 'downloadclients'],
    queryFn: jsonFetcher<ProwlarrDownloadClientSummary[]>('/api/prowlarr/downloadclients'),
    select: ensureArray,
    enabled: canManage && (searchQuery.data?.results.length ?? 0) > 0,
    staleTime: 60_000,
  });
  // A pick shows only when there is a choice to make for this release's protocol.
  const clientChoices = (clientsQuery.data ?? []).filter((client) => client.protocol === confirm?.protocol);
  const pickedClient = clientChoices.some((client) => client.id === grabClient) ? grabClient : null;
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
    // Enter in the field submits too; an empty indexer list must not search every one.
    if (noIndexers) return;
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
      // Editing the pick drops any id that is gone.
      const enabledIds = enabledIndexers.map((indexer) => indexer.id);
      const current = pickedIndexers === null ? enabledIds : indexerIds.filter((value) => enabledIds.includes(value));
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      // Every one picked is the same as all; none left stays none.
      return next.length === enabledIndexers.length ? null : next;
    });
  }

  function resetOptions() {
    setType('search');
    setIds({});
    setPickedIndexers(null);
    setCategories([]);
  }

  function toggleCategory(id: number) {
    // A whole category covers its subcategories, so ticking it drops theirs.
    const subIds = categoriesQuery.data?.find((category) => category.id === id)?.subCategories.map((sub) => sub.id) ?? [];
    setCategories((prev) => (prev.includes(id)
      ? prev.filter((value) => value !== id)
      : [...prev.filter((value) => !subIds.includes(value)), id]));
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
        body: JSON.stringify(pickedClient === null ? { id: release.id } : { id: release.id, downloadClientId: pickedClient }),
      });
      if (res.ok) {
        toast.success('Sent to the download client');
        setGrabbed((prev) => new Set(prev).add(release.id));
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Grab failed');
        // A client that has gone or been disabled drops off the list.
        if (res.status === 400) void queryClient.invalidateQueries({ queryKey: ['prowlarr', 'downloadclients'] });
      }
    } catch {
      toast.error('Grab failed');
    } finally {
      setGrabbing(false);
      setConfirm(null);
    }
  }

  // A bottom sheet on phones, a dialog on wider screens, like the Send sheet.
  const optionsBody = (
    <>
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
                  {/* The label is muted; a typed id is not, so it never looks like the placeholder. */}
                  <Input
                    className="text-foreground"
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
          {pickedIndexers !== null && (
            <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setPickedIndexers(null)}>
              Use all
            </Button>
          )}
        </div>
        {noIndexers && <p className="text-xs text-muted-foreground">None ticked: tick one, or Use all.</p>}
        {enabledIndexers.length > 0 ? (
          <div className="rounded-lg bg-muted/30 overflow-hidden divide-y divide-border/40">
            {enabledIndexers.map((indexer) => {
              const on = pickedIndexers === null || indexerIds.includes(indexer.id);
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
            {indexersQuery.isLoading ? 'Loading…' : indexersQuery.isError ? 'Failed to load indexers.' : 'No enabled indexers.'}
          </p>
        )}
      </section>

      <section className="space-y-2" aria-label="Categories">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Categories</p>
          {categories.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setCategories([])}>
              Clear
            </Button>
          )}
        </div>
        {(categoriesQuery.data ?? []).length > 0 ? (
          <div className="rounded-lg bg-muted/30 overflow-hidden divide-y divide-border/40">
            {(categoriesQuery.data ?? []).map((category) => {
              const on = categories.includes(category.id);
              const open = openCategories.has(category.id);
              const subsPicked = category.subCategories.filter((sub) => categories.includes(sub.id)).length;
              return (
                <div key={category.id}>
                  <div className="flex min-h-11 items-center">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleCategory(category.id)}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 pl-3 pr-1 text-left text-sm transition-colors hover:bg-accent/50"
                    >
                      <span className="min-w-0 flex-1 truncate">{category.name}</span>
                      {!on && subsPicked > 0 && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">{subsPicked} picked</span>
                      )}
                      <Check className={`h-4 w-4 shrink-0 ${on ? 'text-primary' : 'invisible'}`} />
                    </button>
                    {category.subCategories.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} ${category.name} subcategories`}
                        onClick={() => setOpenCategories((prev) => {
                          const next = new Set(prev);
                          if (open) next.delete(category.id); else next.add(category.id);
                          return next;
                        })}
                        className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/50"
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                  {open && category.subCategories.map((sub) => {
                    // The whole category already covers each of its subcategories.
                    const subOn = on || categories.includes(sub.id);
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        aria-pressed={subOn}
                        disabled={on}
                        onClick={() => toggleCategory(sub.id)}
                        className="flex min-h-11 w-full items-center gap-3 border-t border-border/40 pl-7 pr-3 text-left text-sm transition-colors hover:bg-accent/50 disabled:opacity-60"
                      >
                        {/* "TV/Anime" under TV reads as "Anime". */}
                        <span className="min-w-0 flex-1 truncate">{sub.name.replace(`${category.name}/`, '')}</span>
                        <Check className={`h-4 w-4 shrink-0 ${subOn ? 'text-primary' : 'invisible'}`} />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {categoriesQuery.isLoading ? 'Loading…' : 'Failed to load categories.'}
          </p>
        )}
      </section>
    </>
  );
  const optionsFooter = (
    <>
      {/* 44 px tall on touch screens; desktop keeps the denser size. */}
      <Button variant="outline" className="flex-1 pointer-coarse:h-11" onClick={resetOptions} disabled={optionCount === 0 && categories.length === 0}>
        Reset
      </Button>
      <Button className="flex-1 pointer-coarse:h-11" onClick={() => setOptionsOpen(false)}>
        Done
      </Button>
    </>
  );

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
          disabled={(draft.trim().length < 2 && !hasId) || noIndexers || searchQuery.isFetching}
        >
          <Search className="h-4 w-4" /> Search
        </Button>
      </form>
      {noIndexers && (
        <p className="text-xs text-muted-foreground">No indexer is ticked. Pick one in Search options to search.</p>
      )}

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
        {/* Picked in Search options; a tap takes one off. */}
        {categories.filter((id) => !QUICK_CATEGORY_IDS.has(id)).map((id) => {
          const label = categoryNames.get(id) ?? `Category ${id}`;
          return (
            <Button
              key={id}
              variant="default"
              size="sm"
              className="h-8 max-w-full gap-1 px-2.5 text-xs"
              aria-label={`Remove ${label}`}
              onClick={() => toggleCategory(id)}
            >
              <span className="truncate">{label}</span>
              <X className="h-3 w-3 shrink-0" />
            </Button>
          );
        })}
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
            ? 'No results came back. Prowlarr skips indexers that can’t search by this type or ID, so the picked ones may not support it. Try Any, or search by name.'
            : 'No results came back. If that looks wrong, an indexer may have failed: History’s Failed filter shows it.'}
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
                      {release.grabs !== null && <span>{release.grabs} grab{release.grabs === 1 ? '' : 's'}</span>}
                      {age && <span>{age}</span>}
                    </div>
                    {(release.flags.length > 0 || release.categories.length > 0) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {release.flags.map((flag) => (
                          <Badge
                            key={flag}
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${flag === 'nuked' ? 'border-destructive/50 text-destructive' : 'border-primary/50 text-primary'}`}
                          >
                            {PROWLARR_RELEASE_FLAGS[flag]}
                          </Badge>
                        ))}
                        {release.categories.length > 0 && (
                          <span className="min-w-0 [overflow-wrap:anywhere]">{release.categories.join(', ')}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {canSendToArr && release.protocol === 'torrent' && (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      aria-label={`Send to Sonarr or Radarr: ${release.title}`}
                      onClick={() => setSending(release)}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                  {canManage && (
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
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {isMobile ? (
        <Drawer open={optionsOpen} onOpenChange={setOptionsOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Search options</DrawerTitle>
              <DrawerDescription>Used by the next search.</DrawerDescription>
            </DrawerHeader>
            <div className="px-4 pb-2 space-y-5 overflow-y-auto flex-1 min-h-0">{optionsBody}</div>
            <DrawerFooter className="flex-row">{optionsFooter}</DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
          {/* A column, so a long indexer list scrolls between the header and the buttons. */}
          <DialogContent className="flex flex-col overflow-hidden sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Search options</DialogTitle>
              <DialogDescription>Used by the next search.</DialogDescription>
            </DialogHeader>
            <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6">{optionsBody}</div>
            <div className="flex gap-2">{optionsFooter}</div>
          </DialogContent>
        </Dialog>
      )}

      <SendToArrSheet
        release={sending}
        defaultService={submitted?.type === 'tvsearch' ? 'SONARR' : submitted?.type === 'movie' ? 'RADARR' : undefined}
        onClose={() => setSending(null)}
      />

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Grab this release?</DialogTitle>
            <DialogDescription className="[overflow-wrap:anywhere]">
              &ldquo;{confirm?.title}&rdquo; goes to Prowlarr&rsquo;s download client. Sonarr and Radarr won&rsquo;t track it.
            </DialogDescription>
          </DialogHeader>
          {clientChoices.length > 1 && (
            <section className="space-y-2" aria-label="Download client">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Download client</p>
              <div className="rounded-lg bg-muted/30 overflow-hidden divide-y divide-border/40">
                {[{ id: null, name: 'Prowlarr’s choice' }, ...clientChoices].map((client) => (
                  <button
                    key={client.id ?? 'default'}
                    type="button"
                    aria-pressed={pickedClient === client.id}
                    onClick={() => setGrabClient(client.id)}
                    className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="min-w-0 flex-1 truncate">{client.name}</span>
                    <Check className={`h-4 w-4 shrink-0 ${pickedClient === client.id ? 'text-primary' : 'invisible'}`} />
                  </button>
                ))}
              </div>
            </section>
          )}
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
