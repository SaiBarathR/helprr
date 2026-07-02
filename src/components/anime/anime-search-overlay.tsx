'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History, Loader2, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { jsonFetcher } from '@/lib/query-fetch';
import { useSearchHistory } from '@/lib/hooks/use-search-history';
import { AnimeCard, type AnimeItemWithLibrary } from '@/components/anime/anime-card';
import type { AniListPageInfo } from '@/types/anilist';

interface ListResponse {
  mode: 'browse' | 'search';
  items: AnimeItemWithLibrary[];
  pageInfo: AniListPageInfo | null;
}

// Shared with /anime/explore — same key unifies recent searches and reuses the
// TanStack cache so a term searched in either place paints instantly in the other.
const HISTORY_KEY = 'anime-explore';

// In-place anime search for the home page. The bar is a real <input>, so a single
// tap raises the iOS keyboard with no programmatic focus. On focus it expands into
// a results panel. The panel is portaled to <body> because the home content lives
// in an `animate-content-in` subtree whose retained transform (animation fill-mode
// `both`) would otherwise contain a position:fixed panel instead of the viewport.
export function AnimeSearchOverlay({
  onExpandedChange,
}: {
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [panelTop, setPanelTop] = useState(0);
  const [panelLeft, setPanelLeft] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { recent, add, remove } = useSearchHistory(HISTORY_KEY);

  // Debounce the box into the query key; searches at ≥3 chars, empty resets.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = query.trim();
      if (q.length >= 3) setDebouncedQuery(q);
      else if (q.length === 0) setDebouncedQuery('');
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const searchActive = debouncedQuery.length >= 3;

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['anime', 'list', 'search', debouncedQuery],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<ListResponse>(
        `/api/anime?${new URLSearchParams({ mode: 'search', q: debouncedQuery, page: String(pageParam) }).toString()}`,
      )({ signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pageInfo?.hasNextPage ? (last.pageInfo.currentPage || 1) + 1 : undefined),
    enabled: expanded && searchActive,
    staleTime: 5 * 60_000,
  });

  const items = useMemo<AnimeItemWithLibrary[]>(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  // Anchor the panel just under the search field, kept in sync on scroll/resize.
  // Left edge tracks the <main> content area so the fixed panel never covers
  // the desktop sidebar (mobile has no sidebar, so main starts at 0 there).
  useLayoutEffect(() => {
    if (!expanded) return;
    const update = () => {
      const r = wrapperRef.current?.getBoundingClientRect();
      if (r) setPanelTop(r.bottom);
      const main = wrapperRef.current?.closest('main');
      setPanelLeft(main ? Math.max(0, main.getBoundingClientRect().left) : 0);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [expanded]);

  // Lock background scroll while the panel is open.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  // Infinite scroll inside the panel's own scroll container.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage && !isLoading) {
          void fetchNextPage();
        }
      },
      { root: panelRef.current, rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage, items.length]);

  const open = () => {
    setExpanded(true);
    onExpandedChange?.(true);
  };

  const close = () => {
    setExpanded(false);
    onExpandedChange?.(false);
    inputRef.current?.blur();
  };

  const runSearch = (term: string) => {
    const t = term.trim();
    setQuery(t);
    if (t.length >= 3) {
      setDebouncedQuery(t);
      add(t);
    }
  };

  const recentSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? recent.filter((h) => h.toLowerCase().includes(q) && h.toLowerCase() !== q)
      : recent;
  }, [recent, query]);

  const trimmed = query.trim();
  const browseHref = trimmed
    ? `/anime/explore?search=${encodeURIComponent(trimmed)}`
    : '/anime/explore';

  return (
    <>
      <div ref={wrapperRef} className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          placeholder="Search anime..."
          onChange={(e) => setQuery(e.target.value)}
          onFocus={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch(query);
            else if (e.key === 'Escape') close();
          }}
          className="pl-9 pr-9 rounded-full bg-muted/50"
          aria-label="Search anime"
        />
        {(expanded || query) && (
          <button
            type="button"
            aria-label={query ? 'Clear search' : 'Close search'}
            onClick={() => {
              if (query) {
                setQuery('');
                setDebouncedQuery('');
                inputRef.current?.focus();
              } else {
                close();
              }
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {expanded &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: panelTop, left: panelLeft, right: 0, bottom: 0, zIndex: 40 }}
            className="overflow-y-auto bg-background"
            aria-label="Anime search results"
          >
            {searchActive ? (
              isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <p className="py-12 text-center text-muted-foreground">No results found</p>
              ) : (
                <div className="p-3">
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                    {items.map((item, i) => (
                      <AnimeCard
                        key={item.id}
                        item={item}
                        grid
                        imagePriority={i < 4}
                        onNavigate={() => add(debouncedQuery)}
                      />
                    ))}
                  </div>
                  <div ref={sentinelRef} className="h-4" />
                  {isFetchingNextPage && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="p-2">
                {recentSuggestions.length > 0 && (
                  <>
                    <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                      Recent searches
                    </p>
                    {recentSuggestions.map((term) => (
                      <div
                        key={term}
                        role="button"
                        tabIndex={0}
                        onClick={() => runSearch(term)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') runSearch(term);
                        }}
                        className="group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm hover:bg-accent"
                      >
                        <History className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{term}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${term} from recent searches`}
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(term);
                          }}
                          className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-60 hover:text-foreground hover:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </>
                )}
                <Link
                  href={browseHref}
                  onClick={() => {
                    if (trimmed.length >= 3) add(trimmed);
                  }}
                  className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent"
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <span>{trimmed ? `Browse all results for "${trimmed}"` : 'Browse all anime'}</span>
                </Link>
                {trimmed.length > 0 && trimmed.length < 3 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Type at least 3 characters to search.
                  </p>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
