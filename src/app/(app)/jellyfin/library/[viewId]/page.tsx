'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownAZ, ArrowUpAZ, Check, ChevronLeft, Filter, Search, X } from 'lucide-react';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { JellyfinItem, JellyfinLibrary } from '@/types/jellyfin';

const ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;
const PAGE_SIZE = 100;
const POSTER_GAP = 12;
const CAPTION_HEIGHT = 40;

// Typed libraries list their leaf type recursively; anything else lists shallow.
const COLLECTION_ITEM_TYPES: Record<string, string> = {
  movies: 'Movie',
  tvshows: 'Series',
  music: 'MusicAlbum',
  boxsets: 'BoxSet',
};

const SORT_OPTIONS = [
  { value: 'SortName', label: 'Name' },
  { value: 'DateCreated', label: 'Date added' },
  { value: 'PremiereDate', label: 'Release date' },
  { value: 'CommunityRating', label: 'Rating' },
  { value: 'Random', label: 'Random' },
];

const FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'IsUnplayed', label: 'Unplayed' },
  { value: 'IsPlayed', label: 'Played' },
  { value: 'IsFavorite', label: 'Favorites' },
];

function posterColumns(width: number): number {
  if (width < 640) return 3;
  if (width < 1024) return 4;
  if (width < 1280) return 5;
  return 6;
}

function ItemCard({ item, square }: { item: JellyfinItem; square?: boolean }) {
  const [imgFailed, setImgFailed] = useState(false);
  const progress = item.UserData?.PlayedPercentage;
  return (
    <Link
      href={`/jellyfin/library/item/${item.Id}`}
      className="group block min-w-0"
      title={item.Name}
    >
      <div
        className={`relative ${square ? 'aspect-square' : 'aspect-[2/3]'} overflow-hidden rounded-lg border bg-muted/40`}
      >
        {!imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream
          <img
            src={`/api/jellyfin/image?itemId=${item.Id}&type=Primary&maxWidth=300`}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {item.Name}
          </div>
        )}
        {item.UserData?.Played && (
          <div className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
            <Check className="h-3 w-3" aria-hidden />
          </div>
        )}
        {progress !== undefined && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <p className="mt-1 truncate text-xs font-medium">{item.Name}</p>
      <p className="truncate text-[11px] text-muted-foreground">{item.ProductionYear ?? ' '}</p>
    </Link>
  );
}

export default function JellyfinLibraryViewPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const validId = Boolean(viewId && ID_PATTERN.test(viewId));

  const [view, setView] = useState<JellyfinLibrary | null>(null);
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('SortName');
  const [sortOrder, setSortOrder] = useState<'Ascending' | 'Descending'>('Ascending');
  const [filter, setFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Query identity: bumped on any reset so stale page responses are dropped.
  const queryIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const [containerWidth, setContainerWidth] = useState(0);
  const [contentOffsetTop, setContentOffsetTop] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      setContainerWidth(el.clientWidth);
      setContentOffsetTop(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Debounced search.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    fetch('/api/jellyfin/views')
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { views?: JellyfinLibrary[] };
        if (!cancelled) {
          setView(data.views?.find((v) => v.Id === viewId) ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [validId, viewId]);

  const itemType = view ? COLLECTION_ITEM_TYPES[view.CollectionType ?? ''] ?? null : null;
  // Album covers are square; movie/series posters are 2:3.
  const squarePosters = view?.CollectionType === 'music';

  const buildUrl = useCallback(
    (startIndex: number) => {
      const params = new URLSearchParams({
        parentId: viewId,
        startIndex: String(startIndex),
        limit: String(PAGE_SIZE),
        sortBy,
        sortOrder,
      });
      if (itemType) params.set('includeItemTypes', itemType);
      if (filter) params.set('filter', filter);
      if (search) params.set('search', search);
      return `/api/jellyfin/items?${params}`;
    },
    [viewId, sortBy, sortOrder, itemType, filter, search]
  );

  // Reset the listing whenever the query identity changes (sort/filter/search/
  // view) — state is adjusted during render so the fetch effect stays pure.
  const queryKey = `${viewId}|${view?.Id ?? 'pending'}|${itemType ?? 'none'}|${sortBy}|${sortOrder}|${filter}|${search}`;
  const [loadedQueryKey, setLoadedQueryKey] = useState(queryKey);
  if (loadedQueryKey !== queryKey) {
    setLoadedQueryKey(queryKey);
    setItems([]);
    setTotal(null);
    setError(null);
  }

  // First page — refetched from scratch whenever the query changes. Waits for
  // the view lookup so the item-type mapping is known before the first fetch.
  useEffect(() => {
    if (!validId || view === null) return;
    const queryId = ++queryIdRef.current;
    fetch(buildUrl(0))
      .then(async (res) => {
        const data = (await res.json()) as {
          items?: JellyfinItem[];
          total?: number;
          linked?: boolean;
          error?: string;
        };
        if (queryIdRef.current !== queryId) return;
        if (!res.ok) {
          setError(data.error ?? 'Failed to load items');
          return;
        }
        if (data.linked === false) {
          setError("Your Helprr account isn't linked to a Jellyfin user.");
          return;
        }
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => {
        if (queryIdRef.current === queryId) setError('Failed to load items');
      });
  }, [validId, view, buildUrl]);

  const loadMore = useCallback(
    (startIndex: number) => {
      if (loadingMoreRef.current) return;
      const queryId = queryIdRef.current;
      loadingMoreRef.current = true;
      fetch(buildUrl(startIndex))
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { items?: JellyfinItem[] };
          if (queryIdRef.current !== queryId) return;
          const next = data.items ?? [];
          if (next.length > 0) setItems((prev) => [...prev, ...next]);
        })
        .catch(() => {})
        .finally(() => {
          loadingMoreRef.current = false;
        });
    },
    [buildUrl]
  );

  const columns = posterColumns(containerWidth || (typeof window !== 'undefined' ? window.innerWidth : 1024));
  const rowHeight = useMemo(() => {
    const width = containerWidth > 0 ? containerWidth : 360;
    const cardWidth = Math.max(1, (width - POSTER_GAP * (columns - 1)) / columns);
    return cardWidth * (squarePosters ? 1 : 1.5) + CAPTION_HEIGHT + POSTER_GAP;
  }, [containerWidth, columns, squarePosters]);

  const rowCount = Math.ceil(items.length / columns);
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    enabled: items.length > 0,
    overscan: 3,
    scrollMargin: contentOffsetTop,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows[virtualRows.length - 1];

  // Fetch the next page once scrolling approaches the loaded tail.
  useEffect(() => {
    if (!lastRow || total === null) return;
    const lastLoadedRow = rowCount - 1;
    if (items.length < total && lastRow.index >= lastLoadedRow - 2) {
      loadMore(items.length);
    }
  }, [lastRow, rowCount, items.length, total, loadMore]);

  if (!validId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Invalid library
      </div>
    );
  }

  const firstRow = virtualRows[0];
  const startIndex = (firstRow?.index ?? 0) * columns;
  const endIndex = Math.min(items.length, ((lastRow?.index ?? 0) + 1) * columns);
  const topSpacer = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
  const bottomSpacer = lastRow
    ? Math.max(0, virtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
    : 0;

  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? 'Name';

  return (
    <div className="animate-content-in space-y-3">
      <div
        className="sticky z-30 -mx-2 space-y-2 bg-background/95 px-2 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6"
        style={{ top: 'var(--header-height, 0px)' }}
      >
        <div className="flex items-center gap-1">
          <Link
            href="/jellyfin/library"
            aria-label="Back to libraries"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-accent"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">{view?.Name ?? 'Library'}</h1>
            {total !== null && (
              <p className="text-[11px] text-muted-foreground">{total} items</p>
            )}
          </div>
          {searchOpen ? (
            <div className="flex flex-1 items-center gap-1">
              <input
                autoFocus
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search this library"
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                aria-label="Close search"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-accent"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchInput('');
                }}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                aria-label="Search"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-accent"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="h-5 w-5" aria-hidden />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Filter: ${FILTER_OPTIONS.find((o) => o.value === filter)?.label}`}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-accent"
                  >
                    <Filter className="h-5 w-5" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Filter</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {FILTER_OPTIONS.map((opt) => (
                    <DropdownMenuCheckboxItem
                      key={opt.value}
                      checked={filter === opt.value}
                      onCheckedChange={() => setFilter(opt.value)}
                    >
                      {opt.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Sort: ${sortLabel}`}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-accent"
                  >
                    {sortOrder === 'Ascending' ? (
                      <ArrowDownAZ className="h-5 w-5" aria-hidden />
                    ) : (
                      <ArrowUpAZ className="h-5 w-5" aria-hidden />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {SORT_OPTIONS.map((opt) => (
                    <DropdownMenuCheckboxItem
                      key={opt.value}
                      checked={sortBy === opt.value}
                      onCheckedChange={() => setSortBy(opt.value)}
                    >
                      {opt.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={sortOrder === 'Descending'}
                    onCheckedChange={() =>
                      setSortOrder((o) => (o === 'Ascending' ? 'Descending' : 'Ascending'))
                    }
                  >
                    Descending
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground">{error}</div>
      ) : total === null ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <div className="px-2 py-8 text-center text-sm text-muted-foreground">
          {search || filter ? 'No items match.' : 'This library is empty.'}
        </div>
      ) : (
        <div ref={contentRef} className="px-2 md:px-0">
          {topSpacer > 0 && <div style={{ height: topSpacer }} />}
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: POSTER_GAP,
            }}
          >
            {items.slice(startIndex, endIndex).map((item) => (
              <ItemCard key={item.Id} item={item} square={squarePosters} />
            ))}
          </div>
          {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
        </div>
      )}
    </div>
  );
}
