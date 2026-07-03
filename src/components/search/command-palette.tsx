'use client';

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Clock, History, X } from 'lucide-react';
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
import { suggestScopes } from '@/lib/search/parse-query';
import { resolveProviderFromAlias } from '@/lib/search/provider-defs';
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

  const trimmedQuery = query.trim();

  // Scope suggestions for short alias-like input. Suggestions only — typing
  // never activates a scope, so titles starting with an alias stay searchable.
  const scopeSuggestions = useMemo(() => {
    if (activeScope || !trimmedQuery) return [];
    return suggestScopes(trimmedQuery)
      .map((def) => SEARCH_PROVIDER_UI[def.id])
      .filter((def) => providerAvailable(me, def));
  }, [activeScope, trimmedQuery, me]);

  // The scope Tab commits: exact alias match, or the only remaining suggestion.
  const tabTarget = useMemo(() => {
    const exact = scopeSuggestions.find((def) => def.alias === trimmedQuery.toLowerCase());
    return exact ?? (scopeSuggestions.length === 1 ? scopeSuggestions[0] : undefined);
  }, [scopeSuggestions, trimmedQuery]);

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

  // Debounced fetch — scoped when a scope chip is active, local otherwise.
  useEffect(() => {
    const q = query.trim();

    if (activeScope) {
      setLocalResults([]);
      if (!providerAvailable(me, activeScope) || q.length < activeScope.minQuery) {
        setProviderResults([]);
        setRateLimited(undefined);
        setLoading(false);
        return;
      }
      setLoading(true);
      const controller = new AbortController();
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/search/providers/${activeScope.id}?q=${encodeURIComponent(q)}&limit=20`,
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
      }, activeScope.debounceMs);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }

    setProviderResults([]);
    setRateLimited(undefined);
    if (q.length < MIN_LOCAL_QUERY) {
      setLocalResults([]);
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
  }, [query, activeScope, me]);

  const select = useCallback(
    (route: string, term?: string) => {
      if (term?.trim()) addHistory(term.trim());
      setOpen(false);
      router.push(route);
    },
    [router, setOpen, addHistory]
  );

  const applyScope = useCallback((def: SearchProviderUiDef) => {
    setActiveScope(def);
    setQuery('');
  }, []);

  // Scoped history is stored as `alias: query` — the colon keeps it
  // distinguishable from a literal search that happens to start with an alias.
  const selectRecent = useCallback(
    (term: string) => {
      const scoped = term.match(/^([a-z]{2,3}):\s*(.*)$/i);
      const def = scoped ? resolveProviderFromAlias(scoped[1]) : undefined;
      if (def && providerAvailable(me, SEARCH_PROVIDER_UI[def.id])) {
        setActiveScope(SEARCH_PROVIDER_UI[def.id]);
        setQuery(scoped![2]);
      } else {
        setQuery(term);
      }
    },
    [me]
  );

  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab' && !e.shiftKey && tabTarget) {
        e.preventDefault();
        applyScope(tabTarget);
      } else if (e.key === 'Backspace' && activeScope && query === '') {
        setActiveScope(null);
      }
    },
    [tabTarget, applyScope, activeScope, query]
  );

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

  const showRateLimit = !!rateLimited && !!activeScope && !loading;

  const showEmptyLocal =
    !loading &&
    !activeScope &&
    trimmedQuery.length >= MIN_LOCAL_QUERY &&
    !hasLocalResults;

  const showEmptyScoped =
    !loading &&
    !!activeScope &&
    trimmedQuery.length >= (activeScope?.minQuery ?? MIN_LOCAL_QUERY) &&
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
            Search your library, or type a scope alias like tm and press Tab to search a specific source.
          </DialogDescription>
          <Command shouldFilter={false} className="bg-transparent">
            <div className="relative border-b border-border">
              {activeScope && (
                <div className="flex items-center gap-2 px-3 pt-2">
                  <button
                    type="button"
                    aria-label={`Clear ${activeScope.label} scope`}
                    onClick={() => setActiveScope(null)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <activeScope.icon className="size-3" />
                    {activeScope.label}
                    {activeScope.cost === 'remote' && (
                      <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        remote
                      </span>
                    )}
                    <X className="size-3" />
                  </button>
                </div>
              )}
              <CommandInput
                value={query}
                onValueChange={setQuery}
                onKeyDown={onInputKeyDown}
                placeholder={placeholder}
              />
              {loading && (
                <Loader2 className="absolute right-3 top-3.5 size-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <CommandList className="max-h-[min(60vh,420px)]">
              {!activeScope && !trimmedQuery && (
                <>
                  {recent.length > 0 && (
                    <CommandGroup heading="Recent">
                      {recent.map((term) => (
                        <CommandItem key={term} value={`recent-${term}`} onSelect={() => selectRecent(term)}>
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

              {scopeSuggestions.length > 0 && (
                <CommandGroup heading="Search scopes">
                  {scopeSuggestions.map((def) => (
                    <ScopeHelpItem
                      key={def.id}
                      def={def}
                      onSelect={() => applyScope(def)}
                      hint={def.id === tabTarget?.id ? 'Press Tab to search this scope' : undefined}
                    />
                  ))}
                </CommandGroup>
              )}

              {activeScope && !trimmedQuery && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Type to search {activeScope.label}. Backspace or tap the chip to clear the scope.
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
                          onSelect={(route) => select(route, trimmedQuery)}
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
                      onSelect={(route) => select(route, `${activeScope.alias}: ${trimmedQuery}`)}
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
