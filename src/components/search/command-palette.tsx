'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Clock, History } from 'lucide-react';
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
import { parseSearchQuery } from '@/lib/search/parse-query';
import {
  SEARCH_MODULE_ORDER,
  type SearchModule,
  type SearchProviderResult,
  type SearchProviderResponse,
  type SearchResult,
  type SearchResponse,
} from '@/lib/search/types';
import {
  SEARCH_MODULE_DEF,
  SEARCH_PROVIDER_ORDER,
  SEARCH_PROVIDER_UI,
  type SearchProviderUiDef,
} from '@/components/search/registry';
import { useSearchPalette } from '@/components/search/search-store';
import { useSearchHistory } from '@/lib/hooks/use-search-history';

const LOCAL_DEBOUNCE_MS = 280;
const MIN_LOCAL_QUERY = 2;

function providerAvailable(me: ReturnType<typeof useMe>, def: SearchProviderUiDef): boolean {
  if (!me || !hasCapability(me, def.capability)) return false;
  if (def.requiresTmdb && !me.tmdbConfigured) return false;
  if (def.requiresSeerr && !me.seerrConfigured) return false;
  return true;
}

export function CommandPalette() {
  const open = useSearchPalette((s) => s.open);
  const setOpen = useSearchPalette((s) => s.setOpen);
  const me = useMe();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [localResults, setLocalResults] = useState<SearchResult[]>([]);
  const [providerResults, setProviderResults] = useState<SearchProviderResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState<SearchProviderResponse['rateLimited']>(undefined);
  const [activeScope, setActiveScope] = useState<SearchProviderUiDef | null>(null);

  const { recent, add: addHistory } = useSearchHistory('global');

  const parsed = useMemo(() => parseSearchQuery(query), [query]);

  const availableProviders = useMemo(
    () => SEARCH_PROVIDER_ORDER.map((id) => SEARCH_PROVIDER_UI[id]).filter((def) => providerAvailable(me, def)),
    [me]
  );

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
      setLocalResults([]);
      setProviderResults([]);
      setLoading(false);
      setRateLimited(undefined);
      setActiveScope(null);
    }
  }, [open]);

  // Track active scope chip from parsed input.
  useEffect(() => {
    if (
      parsed.mode === 'scoped' ||
      parsed.mode === 'scoped-empty' ||
      parsed.mode === 'scope-help'
    ) {
      setActiveScope(SEARCH_PROVIDER_UI[parsed.provider]);
    } else {
      setActiveScope(null);
    }
  }, [parsed]);

  // Debounced fetch for local and scoped searches.
  useEffect(() => {
    if (parsed.mode === 'empty' || parsed.mode === 'scope-help' || parsed.mode === 'scope-suggest') {
      setLocalResults([]);
      setProviderResults([]);
      setRateLimited(undefined);
      setLoading(false);
      return;
    }

    if (parsed.mode === 'scoped-empty') {
      setLocalResults([]);
      setProviderResults([]);
      setRateLimited(undefined);
      setLoading(false);
      return;
    }

    if (parsed.mode === 'local') {
      const q = parsed.query;
      if (q.length < MIN_LOCAL_QUERY) {
        setLocalResults([]);
        setProviderResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setProviderResults([]);
      setRateLimited(undefined);
      const controller = new AbortController();
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
          if (!res.ok) throw new Error('search failed');
          const data = (await res.json()) as SearchResponse;
          if (!controller.signal.aborted) setLocalResults(data.results ?? []);
        } catch {
          if (!controller.signal.aborted) setLocalResults([]);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      }, LOCAL_DEBOUNCE_MS);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }

    // scoped
    const def = SEARCH_PROVIDER_UI[parsed.provider];
    if (!providerAvailable(me, def)) {
      setProviderResults([]);
      setLocalResults([]);
      setLoading(false);
      return;
    }

    const q = parsed.query;
    if (q.length < def.minQuery) {
      setProviderResults([]);
      setLocalResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLocalResults([]);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/providers/${parsed.provider}?q=${encodeURIComponent(q)}&limit=20`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('provider search failed');
        const data = (await res.json()) as SearchProviderResponse;
        if (!controller.signal.aborted) {
          setProviderResults(data.results ?? []);
          setRateLimited(data.rateLimited);
        }
      } catch {
        if (!controller.signal.aborted) {
          setProviderResults([]);
          setRateLimited(undefined);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, def.debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [parsed, me]);

  const select = useCallback(
    (route: string, term?: string) => {
      if (term?.trim()) addHistory(term.trim());
      setOpen(false);
      router.push(route);
    },
    [router, setOpen, addHistory]
  );

  const applyScope = useCallback((def: SearchProviderUiDef) => {
    setQuery(`${def.alias} `);
  }, []);

  const grouped = useMemo(() => {
    const byModule = new Map<SearchModule, SearchResult[]>();
    for (const result of localResults) {
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
  }, [localResults, me]);

  const hasLocalResults = grouped.length > 0;
  const hasProviderResults = providerResults.length > 0;
  const placeholder = activeScope
    ? `Search ${activeScope.label}…`
    : 'Search or type a scope (tm, ani, tor…)';

  const showRateLimit =
    rateLimited &&
    (parsed.mode === 'scoped' || parsed.mode === 'scoped-empty') &&
    !loading;

  const showEmptyLocal =
    !loading &&
    parsed.mode === 'local' &&
    parsed.query.length >= MIN_LOCAL_QUERY &&
    !hasLocalResults;

  const showEmptyScoped =
    !loading &&
    parsed.mode === 'scoped' &&
    parsed.query.length >= (activeScope?.minQuery ?? MIN_LOCAL_QUERY) &&
    !hasProviderResults &&
    !showRateLimit;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="overflow-hidden p-0 top-[12%] translate-y-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search your library or use a scope prefix like tm for TMDB.
          </DialogDescription>
          <Command shouldFilter={false} className="bg-transparent">
            <div className="relative border-b border-border">
              {activeScope && (
                <div className="flex items-center gap-2 px-3 pt-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    <activeScope.icon className="size-3" />
                    {activeScope.label}
                    {activeScope.cost === 'remote' && (
                      <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        remote
                      </span>
                    )}
                  </span>
                </div>
              )}
              <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} />
              {loading && (
                <Loader2 className="absolute right-3 top-3.5 size-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <CommandList className="max-h-[min(60vh,420px)]">
              {parsed.mode === 'empty' && (
                <>
                  {recent.length > 0 && (
                    <CommandGroup heading="Recent">
                      {recent.map((term) => (
                        <CommandItem key={term} value={`recent-${term}`} onSelect={() => setQuery(term)}>
                          <History className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{term}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  <CommandGroup heading="Search scopes">
                    {availableProviders.map((def) => (
                      <ScopeHelpItem key={def.id} def={def} onSelect={() => applyScope(def)} />
                    ))}
                  </CommandGroup>
                </>
              )}

              {(parsed.mode === 'scope-help' || parsed.mode === 'scope-suggest') && (
                <CommandGroup heading="Search scopes">
                  {(parsed.mode === 'scope-suggest'
                    ? parsed.suggestions
                    : [SEARCH_PROVIDER_UI[parsed.provider]]
                  )
                    .filter((def) => providerAvailable(me, SEARCH_PROVIDER_UI[def.id]))
                    .map((def) => (
                      <ScopeHelpItem
                        key={def.id}
                        def={SEARCH_PROVIDER_UI[def.id]}
                        onSelect={() => applyScope(SEARCH_PROVIDER_UI[def.id])}
                        hint={parsed.mode === 'scope-help' ? 'Press Space to search' : undefined}
                      />
                    ))}
                </CommandGroup>
              )}

              {parsed.mode === 'scoped-empty' && activeScope && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Type to search {activeScope.label}. Results use the {activeScope.alias} scope.
                </div>
              )}

              {showRateLimit && (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <Clock className="size-4 shrink-0" />
                  <span>
                    {activeScope?.label} is rate-limited — try again in ~{rateLimited!.retryAfterSeconds}s
                  </span>
                </div>
              )}

              {showEmptyLocal && <CommandEmpty>No matches found.</CommandEmpty>}
              {showEmptyScoped && <CommandEmpty>No matches in this scope.</CommandEmpty>}

              {hasLocalResults &&
                grouped.map(({ module, list }) => {
                  const def = SEARCH_MODULE_DEF[module];
                  return (
                    <CommandGroup key={module} heading={def.label}>
                      {list.map((result) => (
                        <LocalResultRow
                          key={result.id}
                          result={result}
                          onSelect={(route) => select(route, parsed.mode === 'local' ? parsed.query : undefined)}
                        />
                      ))}
                    </CommandGroup>
                  );
                })}

              {hasProviderResults && activeScope && (
                <CommandGroup heading={activeScope.label}>
                  {providerResults.map((result) => (
                    <ProviderResultRow
                      key={result.id}
                      result={result}
                      onSelect={(route) =>
                        select(route, parsed.mode === 'scoped' ? `${parsed.def.alias} ${parsed.query}` : undefined)
                      }
                    />
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

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

function ScopeHelpItem({
  def,
  onSelect,
  hint,
}: {
  def: SearchProviderUiDef;
  onSelect: () => void;
  hint?: string;
}) {
  const Icon = def.icon;
  return (
    <CommandItem value={`scope-${def.id}`} onSelect={onSelect} className="gap-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{def.label}</span>
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
            {def.alias}
          </kbd>
        </div>
        <div className="truncate text-xs text-muted-foreground">{hint ?? def.description}</div>
      </div>
    </CommandItem>
  );
}

function LocalResultRow({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (route: string) => void;
}) {
  const poster = toCachedImageSrc(result.poster, result.posterService, { width: 92 });
  const primaryRoute = result.modules[0]?.route;
  if (!primaryRoute) return null;

  return (
    <CommandItem value={result.id} onSelect={() => onSelect(primaryRoute)} className="gap-3">
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

function ProviderResultRow({
  result,
  onSelect,
}: {
  result: SearchProviderResult;
  onSelect: (route: string) => void;
}) {
  const def = SEARCH_PROVIDER_UI[result.provider];
  const Icon = def.icon;
  const poster = toCachedImageSrc(result.poster, result.posterService, { width: 92 });

  return (
    <CommandItem value={result.id} onSelect={() => onSelect(result.route)} className="gap-3">
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
        {result.badge && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {result.badge}
          </span>
        )}
        <span
          title={def.label}
          className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          <Icon className="size-3" />
        </span>
      </div>
    </CommandItem>
  );
}
