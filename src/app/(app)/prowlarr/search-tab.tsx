'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Download, Loader2, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatBytes } from '@/lib/format';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { jsonFetcher } from '@/lib/query-fetch';
import type { ProwlarrSearchResult } from '@/app/api/prowlarr/search/route';

const CATEGORIES = [
  { id: 2000, label: 'Movies' },
  { id: 5000, label: 'TV' },
  { id: 3000, label: 'Audio' },
  { id: 7000, label: 'Books' },
];

const SORTS = [
  { id: 'seeders', label: 'Seeders' },
  { id: 'size', label: 'Size' },
  { id: 'age', label: 'Newest' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

function compareResults(a: ProwlarrSearchResult, b: ProwlarrSearchResult, sort: SortId): number {
  if (sort === 'size') return b.size - a.size;
  if (sort === 'age') return Date.parse(b.publishDate ?? '') - Date.parse(a.publishDate ?? '') || 0;
  return (b.seeders ?? 0) - (a.seeders ?? 0);
}

function formatAge(publishDate: string | null): string | null {
  if (!publishDate) return null;
  const days = Math.floor((Date.now() - Date.parse(publishDate)) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return 'today';
  return days < 365 ? `${days}d` : `${Math.floor(days / 365)}y`;
}

/**
 * Search every indexer and send a release to Prowlarr's own download client.
 * This tab is a full page, so the search field's keyboard is safe here. A
 * search can take as long as the slowest indexer, so it can be cancelled.
 */
export function SearchTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useRouteViewState('searchDraft', '');
  const [submitted, setSubmitted] = useRouteViewState('searchSubmitted', '');
  const [categories, setCategories] = useRouteViewState<number[]>('searchCategories', []);
  const [sort, setSort] = useRouteViewState<SortId>('searchSort', 'seeders');
  const [confirm, setConfirm] = useState<ProwlarrSearchResult | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [grabbed, setGrabbed] = useState<ReadonlySet<string>>(() => new Set());

  const categoryParam = [...categories].sort().join(',');
  const queryKey = ['prowlarr', 'search', submitted, categoryParam];
  const searchQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: submitted });
      if (categoryParam) params.set('categories', categoryParam);
      return jsonFetcher<{ results: ProwlarrSearchResult[] }>(`/api/prowlarr/search?${params}`)({ signal });
    },
    enabled: submitted.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const results = useMemo(
    () => [...(searchQuery.data?.results ?? [])].sort((a, b) => compareResults(a, b, sort)),
    [searchQuery.data, sort],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(draft.trim());
  }

  function toggleCategory(id: number) {
    setCategories((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  }

  function cancel() {
    void queryClient.cancelQueries({ queryKey });
    setSubmitted('');
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
          placeholder="Search all indexers"
          aria-label="Search all indexers"
          enterKeyHint="search"
          maxLength={200}
        />
        <Button type="submit" className="shrink-0" disabled={draft.trim().length < 2 || searchQuery.isFetching}>
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
          <p>Searching every indexer. This can take up to a minute.</p>
          <Button variant="ghost" size="sm" className="mt-2 gap-1.5" onClick={cancel}>
            <X className="h-4 w-4" /> Cancel
          </Button>
        </div>
      ) : searchQuery.isError ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">
          Search failed. Try again in a moment.
        </div>
      ) : submitted.length >= 2 && results.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">Nothing found.</div>
      ) : results.length > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">{results.length} result{results.length !== 1 ? 's' : ''}</p>
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
                      {release.seeders !== null && <span>{release.seeders} seeders</span>}
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
