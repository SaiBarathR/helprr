'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { useMe, hasCapability } from '@/components/permission-provider';
import { toCachedImageSrc } from '@/lib/image';
import { SEARCH_MODULE_ORDER, type SearchModule, type SearchResult, type SearchResponse } from '@/lib/search/types';
import { SEARCH_MODULE_DEF } from '@/components/search/registry';
import { useSearchPalette } from '@/components/search/search-store';

const DEBOUNCE_MS = 280;
const MIN_QUERY = 2;

export function CommandPalette() {
  const open = useSearchPalette((s) => s.open);
  const setOpen = useSearchPalette((s) => s.setOpen);
  const me = useMe();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // ⌘K / Ctrl-K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useSearchPalette.getState().open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);

  // Reset transient state whenever the palette closes.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  // Debounced fetch; each keystroke aborts the previous in-flight request so the
  // *arr-backed index is never hammered and stale responses can't clobber fresh ones.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('search failed');
        const data = (await res.json()) as SearchResponse;
        setResults(data.results ?? []);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const select = useCallback(
    (route: string) => {
      setOpen(false);
      router.push(route);
    },
    [router, setOpen]
  );

  // Group by primary module (modules[0]); mirror server gating so a module the user
  // can't see never renders a heading. Order follows SEARCH_MODULE_ORDER.
  const grouped = useMemo(() => {
    const byModule = new Map<SearchModule, SearchResult[]>();
    for (const result of results) {
      const primary = result.modules[0]?.module;
      if (!primary) continue;
      const def = SEARCH_MODULE_DEF[primary];
      if (!def || !hasCapability(me, def.capability)) continue;
      const list = byModule.get(primary);
      if (list) list.push(result);
      else byModule.set(primary, [result]);
    }
    return SEARCH_MODULE_ORDER.flatMap((module) => {
      const list = byModule.get(module);
      return list && list.length ? [{ module, list }] : [];
    });
  }, [results, me]);

  const hasResults = grouped.length > 0;
  const showEmpty = !loading && query.trim().length >= MIN_QUERY && !hasResults;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="overflow-hidden p-0 top-[12%] translate-y-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search across your series, movies, music, and watchlist.
          </DialogDescription>
          <Command shouldFilter={false} className="bg-transparent">
            <div className="relative">
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search series, movies, music, watchlist…"
              />
              {loading && (
                <Loader2 className="absolute right-3 top-3.5 size-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <CommandList className="max-h-[min(60vh,420px)]">
              {showEmpty && <CommandEmpty>No matches found.</CommandEmpty>}
              {grouped.map(({ module, list }) => {
                const def = SEARCH_MODULE_DEF[module];
                return (
                  <CommandGroup key={module} heading={def.label}>
                    {list.map((result) => (
                      <ResultRow key={result.id} result={result} onSelect={select} />
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      {/* Mobile affordance — desktop opens via the sidebar button or ⌘K. A slim tab
          tucked flush to the right edge in the lower third: mostly off-screen so it
          stays out of the navigation path, only a small handle peeks. Pressing pulls
          it flush (feedback) then opens the palette. The Dialog overlay (z-50) covers
          it while open. */}
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="md:hidden fixed right-0 bottom-[22%] z-40 flex h-16 w-9 items-center justify-start rounded-l-xl bg-primary pl-2 text-primary-foreground shadow-lg translate-x-[45%] active:translate-x-0 transition-transform"
      >
        <Search className="size-4" />
      </button>
    </>
  );
}

function ResultRow({ result, onSelect }: { result: SearchResult; onSelect: (route: string) => void }) {
  const poster = toCachedImageSrc(result.poster, result.posterService, { width: 92 });
  const primaryRoute = result.modules[0]?.route;
  if (!primaryRoute) return null;

  return (
    <CommandItem
      value={result.id}
      onSelect={() => onSelect(primaryRoute)}
      className="gap-3"
    >
      <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-muted">
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{result.title}</div>
        {result.subtitle && (
          <div className="truncate text-xs text-muted-foreground">{result.subtitle}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {result.modules.map(({ module }) => {
          const def = SEARCH_MODULE_DEF[module];
          const Icon = def.icon;
          return (
            <span
              key={module}
              title={def.label}
              className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              <Icon className="size-3" />
            </span>
          );
        })}
      </div>
    </CommandItem>
  );
}
