'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Bookmark,
  Filter,
  Loader2,
  MoreHorizontal,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useCan } from '@/components/permission-provider';

type MediaType = 'movie' | 'series' | 'anime';
type Source = 'TMDB' | 'TVDB' | 'ANILIST' | 'SONARR' | 'RADARR';

interface WatchlistItem {
  id: string;
  source: Source;
  externalId: string;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  rating: number | null;
  addedAt: string;
  href: string | null;
  tags: Array<{ id: string; name: string; color: string | null }>;
}

interface WatchlistTag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

type SortKey = 'addedAt' | 'title' | 'year' | 'rating' | 'mediaType';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'addedAt', label: 'Date Added' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Release Year' },
  { value: 'rating', label: 'Score' },
  { value: 'mediaType', label: 'Type' },
];

const MEDIA_TYPE_OPTIONS: Array<{ value: MediaType; label: string }> = [
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
  { value: 'anime', label: 'Anime' },
];

const SOURCE_OPTIONS: Array<{ value: Source; label: string }> = [
  { value: 'TMDB', label: 'TMDB' },
  { value: 'ANILIST', label: 'AniList' },
  { value: 'TVDB', label: 'TVDB' },
  { value: 'SONARR', label: 'Sonarr' },
  { value: 'RADARR', label: 'Radarr' },
];

const STORAGE_KEY = 'helprr.watchlist.view.v1';

interface ViewState {
  sort: SortKey;
  sortDir: SortDir;
  mediaTypes: MediaType[];
  sources: Source[];
  libraryOnly: 'all' | 'in' | 'out';
}

const DEFAULT_VIEW: ViewState = {
  sort: 'addedAt',
  sortDir: 'desc',
  mediaTypes: [],
  sources: [],
  libraryOnly: 'all',
};

function loadView(): ViewState {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    return {
      sort: SORT_OPTIONS.some((o) => o.value === parsed.sort) ? (parsed.sort as SortKey) : DEFAULT_VIEW.sort,
      sortDir: parsed.sortDir === 'asc' || parsed.sortDir === 'desc' ? parsed.sortDir : DEFAULT_VIEW.sortDir,
      mediaTypes: Array.isArray(parsed.mediaTypes)
        ? parsed.mediaTypes.filter((m): m is MediaType =>
            MEDIA_TYPE_OPTIONS.some((o) => o.value === m)
          )
        : [],
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter((s): s is Source => SOURCE_OPTIONS.some((o) => o.value === s))
        : [],
      libraryOnly:
        parsed.libraryOnly === 'in' || parsed.libraryOnly === 'out' ? parsed.libraryOnly : 'all',
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export default function WatchlistPage() {
  const canEdit = useCan('watchlist.edit');
  const [items, setItems] = useState<WatchlistItem[] | null>(null);
  const [tags, setTags] = useState<WatchlistTag[]>([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WatchlistItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [viewLoaded, setViewLoaded] = useState(false);

  useEffect(() => {
    setView(loadView());
    setViewLoaded(true);
  }, []);

  useEffect(() => {
    if (!viewLoaded || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
    } catch {
      // noop
    }
  }, [view, viewLoaded]);

  const loadItems = useCallback(async () => {
    try {
      const url = new URL('/api/watchlist', window.location.origin);
      if (activeTagId) url.searchParams.set('tag', activeTagId);
      if (appliedSearch) url.searchParams.set('q', appliedSearch);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as WatchlistItem[];
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlist');
    }
  }, [activeTagId, appliedSearch]);

  const loadTags = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist/tags');
      if (!res.ok) return;
      const data = (await res.json()) as WatchlistTag[];
      setTags(data);
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const debouncedApply = useMemo(
    () =>
      debounce((value: string) => {
        setAppliedSearch(value.trim());
      }, 300),
    []
  );

  useEffect(() => {
    debouncedApply(search);
  }, [search, debouncedApply]);

  async function handleRemove(item: WatchlistItem) {
    setRemoving(true);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/watchlist/${item.id}`, { method: 'DELETE' });
      } catch (err) {
        console.error('[Watchlist] remove network error:', err);
        toast.error('Failed to remove (network error)');
        return;
      }
      if (!res.ok) {
        toast.error('Failed to remove');
        return;
      }
      toast.success('Removed from watchlist');
      setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
      void loadTags();
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  }

  async function handleClearAll() {
    setClearingAll(true);
    try {
      let res: Response;
      try {
        res = await fetch('/api/watchlist', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'all' }),
        });
      } catch (err) {
        console.error('[Watchlist] clear-all network error:', err);
        toast.error('Failed to clear watchlist (network error)');
        return;
      }
      if (!res.ok) {
        toast.error('Failed to clear watchlist');
        return;
      }
      const data = (await res.json()) as { count: number };
      toast.success(`Cleared ${data.count} item${data.count === 1 ? '' : 's'}`);
      setItems([]);
      void loadTags();
    } finally {
      setClearingAll(false);
      setClearAllOpen(false);
    }
  }

  const filtered = useMemo(() => {
    if (!items) return null;
    let list = items;
    if (view.mediaTypes.length > 0) {
      list = list.filter((i) => view.mediaTypes.includes(i.mediaType));
    }
    if (view.sources.length > 0) {
      list = list.filter((i) => view.sources.includes(i.source));
    }
    if (view.libraryOnly === 'in') {
      list = list.filter((i) => i.href !== null && /^\/(movies|series)\//.test(i.href));
    } else if (view.libraryOnly === 'out') {
      list = list.filter((i) => !(i.href !== null && /^\/(movies|series)\//.test(i.href)));
    }

    const cmp = (a: WatchlistItem, b: WatchlistItem): number => {
      let r = 0;
      switch (view.sort) {
        case 'title':
          r = a.title.localeCompare(b.title);
          break;
        case 'year': {
          const ay = a.year ?? -Infinity;
          const by = b.year ?? -Infinity;
          r = ay - by;
          break;
        }
        case 'rating': {
          const ar = a.rating ?? -Infinity;
          const br = b.rating ?? -Infinity;
          r = ar - br;
          break;
        }
        case 'mediaType':
          r = a.mediaType.localeCompare(b.mediaType);
          if (r === 0) r = a.title.localeCompare(b.title);
          break;
        case 'addedAt':
        default:
          r = new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
          break;
      }
      return view.sortDir === 'asc' ? r : -r;
    };
    return [...list].sort(cmp);
  }, [items, view]);

  const visibleTags = tags.filter((t) => t.count > 0);
  const totalCount = items?.length ?? 0;
  const filteredCount = filtered?.length ?? 0;
  const hasActiveFilters =
    view.mediaTypes.length > 0 || view.sources.length > 0 || view.libraryOnly !== 'all';

  const activeSortLabel =
    SORT_OPTIONS.find((o) => o.value === view.sort)?.label ?? 'Date Added';

  return (
    <div className="animate-content-in pb-12">
      <div
        className="sticky z-30 -mx-2 space-y-2 bg-background/95 px-2 pt-1 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6"
        style={{ top: 'var(--header-height, 0px)' }}
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search watchlist…"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors relative"
                aria-label="Filter"
              >
                <Filter className="h-5 w-5" />
                {hasActiveFilters && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Media type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {MEDIA_TYPE_OPTIONS.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={view.mediaTypes.includes(opt.value)}
                  onCheckedChange={() =>
                    setView((v) => ({
                      ...v,
                      mediaTypes: v.mediaTypes.includes(opt.value)
                        ? v.mediaTypes.filter((m) => m !== opt.value)
                        : [...v.mediaTypes, opt.value],
                    }))
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Source</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SOURCE_OPTIONS.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={view.sources.includes(opt.value)}
                  onCheckedChange={() =>
                    setView((v) => ({
                      ...v,
                      sources: v.sources.includes(opt.value)
                        ? v.sources.filter((s) => s !== opt.value)
                        : [...v.sources, opt.value],
                    }))
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Library</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={view.libraryOnly}
                onValueChange={(v) =>
                  setView((prev) => ({
                    ...prev,
                    libraryOnly: (v as ViewState['libraryOnly']) ?? 'all',
                  }))
                }
              >
                <DropdownMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
                  All
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="in" onSelect={(e) => e.preventDefault()}>
                  In library
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="out" onSelect={(e) => e.preventDefault()}>
                  Not in library
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {hasActiveFilters && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      setView((v) => ({
                        ...v,
                        mediaTypes: [],
                        sources: [],
                        libraryOnly: 'all',
                      }))
                    }
                  >
                    Reset filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label={`Sort: ${activeSortLabel} ${view.sortDir === 'asc' ? 'ascending' : 'descending'}`}
              >
                <ArrowUpDown className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={view.sort}
                onValueChange={(v) =>
                  setView((prev) => ({ ...prev, sort: v as SortKey }))
                }
              >
                {SORT_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={view.sortDir}
                onValueChange={(v) =>
                  setView((prev) => ({ ...prev, sortDir: v as SortDir }))
                }
              >
                <DropdownMenuRadioItem value="asc" onSelect={(e) => e.preventDefault()}>
                  Ascending
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc" onSelect={(e) => e.preventDefault()}>
                  Descending
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="text-xs text-muted-foreground ml-auto tabular-nums">
            {filteredCount === totalCount
              ? `${totalCount} item${totalCount === 1 ? '' : 's'}`
              : `${filteredCount} of ${totalCount}`}
          </div>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-primary hover:bg-accent active:bg-accent/80 transition-colors"
                  aria-label="Watchlist actions"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setManageOpen(true)}>
                  <Settings className="mr-2 h-4 w-4" />
                  Manage tags
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setClearAllOpen(true)}
                  disabled={totalCount === 0}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear watchlist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="px-2 md:px-6 mt-3 space-y-3">
        {visibleTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTagId(null)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                activeTagId === null ? 'bg-foreground text-background border-foreground' : 'hover:bg-muted'
              }`}
            >
              All · {totalCount}
            </button>
            {visibleTags.map((t) => {
              const active = activeTagId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTagId(active ? null : t.id)}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium hover:opacity-100"
                  style={{
                    backgroundColor: active ? (t.color ?? '#6366f1') : `${t.color ?? '#6366f1'}1f`,
                    borderColor: `${t.color ?? '#6366f1'}55`,
                    color: active ? '#fff' : (t.color ?? undefined),
                  }}
                >
                  {t.name}
                  <span className="opacity-70">· {t.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && <div className="text-sm text-red-400">{error}</div>}

        {filtered === null ? (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          totalCount === 0 ? (
            <div className="py-16 text-center text-muted-foreground space-y-1">
              <Bookmark className="h-8 w-8 mx-auto opacity-60" />
              <p className="text-sm">Your watchlist is empty.</p>
              <p className="text-xs">
                Open any item in Discover, Anime, Movies, or Series to add it here.
              </p>
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground space-y-2">
              <Filter className="h-8 w-8 mx-auto opacity-60" />
              <p className="text-sm">No items match the current filters.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setView((v) => ({
                    ...v,
                    mediaTypes: [],
                    sources: [],
                    libraryOnly: 'all',
                  }))
                }
              >
                Reset filters
              </Button>
            </div>
          )
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {filtered.map((item) => (
              <WatchlistCard key={item.id} item={item} onRemove={() => setRemoveTarget(item)} />
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <ConfirmDialog
          open={removeTarget !== null}
          onOpenChange={(o) => {
            if (!o) setRemoveTarget(null);
          }}
          title={removeTarget ? `Remove "${removeTarget.title}"?` : 'Remove?'}
          description="This won't affect your media library — only the watchlist entry."
          confirmLabel="Remove"
          destructive
          busy={removing}
          onConfirm={() => (removeTarget ? handleRemove(removeTarget) : Promise.resolve())}
        />
      )}

      <ConfirmDialog
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        title="Clear entire watchlist?"
        description={`This will remove all ${totalCount} item${totalCount === 1 ? '' : 's'} from your watchlist. Your media library is not affected.`}
        confirmLabel="Clear all"
        destructive
        busy={clearingAll}
        onConfirm={handleClearAll}
      />

      <ManageTagsDialog
        open={manageOpen}
        onOpenChange={(o) => {
          setManageOpen(o);
          if (!o) {
            void loadTags();
            void loadItems();
          }
        }}
        tags={tags}
      />
    </div>
  );
}

function WatchlistCard({
  item,
  onRemove,
}: {
  item: WatchlistItem;
  onRemove: () => void;
}) {
  const canEdit = useCan('watchlist.edit');
  const poster = item.posterUrl
    ? (toCachedImageSrc(
        item.posterUrl,
        item.source === 'TMDB'
          ? 'tmdb'
          : item.source === 'ANILIST'
          ? 'anilist'
          : item.source === 'SONARR'
          ? 'sonarr'
          : item.source === 'RADARR'
          ? 'radarr'
          : undefined
      ) ?? item.posterUrl)
    : null;
  const content = (
    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted">
      {poster ? (
        <Image
          src={poster}
          alt={item.title}
          fill
          sizes="(max-width: 640px) 33vw, 20vw"
          className="object-cover"
          unoptimized={isProtectedApiImageSrc(poster)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Bookmark className="h-8 w-8" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <p className="text-xs font-semibold text-foreground truncate leading-tight">{item.title}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-foreground/70">
          {item.year !== null && <span>{item.year}</span>}
          {item.rating !== null && (
            <span className="tabular-nums">★ {(item.rating / 10).toFixed(1)}</span>
          )}
        </div>
      </div>
      {item.tags.length > 0 && (
        <div className="absolute top-1.5 right-1.5 flex flex-wrap gap-1 max-w-[70%] justify-end">
          {item.tags.slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{
                backgroundColor: `${t.color ?? '#6366f1'}cc`,
                color: '#fff',
              }}
            >
              {t.name}
            </span>
          ))}
          {item.tags.length > 2 && (
            <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] text-foreground">
              +{item.tags.length - 2}
            </span>
          )}
        </div>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove from watchlist"
          className="absolute top-1.5 left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/70 backdrop-blur-sm hover:bg-background text-foreground"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
  return item.href ? (
    <Link href={item.href} className="group block">
      {content}
    </Link>
  ) : (
    <div className="block">{content}</div>
  );
}

function ManageTagsDialog({
  open,
  onOpenChange,
  tags,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tags: WatchlistTag[];
}) {
  const [edits, setEdits] = useState<Record<string, { name: string; color: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEdits({});
      return;
    }
    const initial: Record<string, { name: string; color: string }> = {};
    for (const t of tags) {
      initial[t.id] = { name: t.name, color: t.color ?? '#6366f1' };
    }
    setEdits(initial);
  }, [open, tags]);

  async function save(t: WatchlistTag) {
    const next = edits[t.id];
    if (!next) return;
    const nameChanged = next.name !== t.name;
    const colorChanged = next.color !== (t.color ?? '#6366f1');
    if (!nameChanged && !colorChanged) return;
    setSaving(t.id);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/watchlist/tags/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(nameChanged ? { name: next.name } : {}),
            ...(colorChanged ? { color: next.color } : {}),
          }),
        });
      } catch (err) {
        console.error('[Watchlist] tag-rename network error:', err);
        toast.error('Failed to update tag (network error)');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error ?? 'Failed to update tag');
        return;
      }
      toast.success('Tag updated');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage tags</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags yet. Add items with tags to create them.</p>
          ) : (
            tags.map((t) => {
              const draft = edits[t.id] ?? { name: t.name, color: t.color ?? '#6366f1' };
              return (
                <div key={t.id} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.color}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [t.id]: { ...draft, color: e.target.value } }))
                    }
                    className="h-9 w-9 rounded border border-border bg-background cursor-pointer"
                    aria-label="Tag color"
                  />
                  <Input
                    value={draft.name}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [t.id]: { ...draft, name: e.target.value } }))
                    }
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                    {t.count}
                  </span>
                  <Button size="sm" onClick={() => save(t)} disabled={saving === t.id}>
                    {saving === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
