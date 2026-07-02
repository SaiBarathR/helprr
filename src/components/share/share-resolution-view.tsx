'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bookmark, Send, Search, Loader2, ExternalLink, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Badge } from '@/components/ui/badge';
import type { ResolvedShare, ResolvedTmdbHit } from '@/lib/share/resolve-shared-input';

interface ShareResolutionViewProps {
  resolved: ResolvedShare;
  input: {
    title?: string;
    text?: string;
    url?: string;
  };
}

export function ShareResolutionView({ resolved, input }: ShareResolutionViewProps) {
  return (
    <div>
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Helprr
        </Link>
      </div>

      <div className="px-4 mb-6">
        <h1 className="font-display text-3xl mb-2 hero-title-rise">Add to Helprr</h1>
        <p className="text-sm text-muted-foreground">
          {resolved.kind === 'tmdb' && 'We matched what you shared. Pick an action below.'}
          {resolved.kind === 'multi' && 'Multiple matches — pick which one you meant.'}
          {resolved.kind === 'query' && 'We couldn’t auto-match this. Search in Discover instead.'}
          {resolved.kind === 'unknown' && 'Nothing recognizable was shared. Try opening Discover.'}
        </p>
      </div>

      {resolved.kind === 'tmdb' && <SingleHit hit={resolved.hit} />}

      {resolved.kind === 'multi' && (
        <div>
          <div className="px-4 tracked-caps text-[10px] text-muted-foreground mb-2">
            {resolved.hits.length} TMDB matches for &ldquo;{resolved.query}&rdquo;
          </div>
          <div className="space-y-4">
            {resolved.hits.map((hit) => (
              <SingleHit key={`${hit.mediaType}-${hit.tmdbId}`} hit={hit} />
            ))}
          </div>
        </div>
      )}

      {resolved.kind === 'query' && <QueryFallback query={resolved.query} />}

      {resolved.kind === 'unknown' && (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Search className="h-5 w-5 mx-auto mb-2 opacity-60" />
            Shared content:
            <pre className="mt-2 inline-block font-mono text-[11px] text-foreground/70 whitespace-pre-wrap text-left">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          <Link
            href="/discover"
            className="grouped-row hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
          >
            <span className="text-sm">Open Discover</span>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </Link>
        </GroupedSection>
      )}
    </div>
  );
}

function QueryFallback({ query }: { query: string }) {
  return (
    <GroupedSection>
      <Link
        href={`/discover?q=${encodeURIComponent(query)}`}
        className="grouped-row hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
      >
        <span className="text-sm">Search Discover for &ldquo;{query}&rdquo;</span>
        <Search className="h-4 w-4 text-muted-foreground" />
      </Link>
    </GroupedSection>
  );
}

function SingleHit({ hit }: { hit: ResolvedTmdbHit }) {
  const [busy, setBusy] = useState<'watchlist' | 'request' | null>(null);
  const [watchlistAdded, setWatchlistAdded] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  const mediaTypeLabel = hit.mediaType === 'movie' ? 'Movie' : 'TV';
  const detailHref = hit.mediaType === 'movie'
    ? `/discover/movie/${hit.tmdbId}`
    : `/discover/tv/${hit.tmdbId}`;

  async function addToWatchlist() {
    setBusy('watchlist');
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'TMDB',
          externalId: String(hit.tmdbId),
          mediaType: hit.mediaType === 'tv' ? 'series' : 'movie',
          title: hit.title,
          year: hit.year ?? undefined,
          posterUrl: hit.posterPath ?? undefined,
          overview: hit.overview ?? undefined,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to add to watchlist');
      }
      setWatchlistAdded(true);
      toast.success('Added to watchlist');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add to watchlist');
    } finally {
      setBusy(null);
    }
  }

  async function requestViaSeerr() {
    setBusy('request');
    try {
      const res = await fetch('/api/seerr/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType: hit.mediaType,
          tmdbId: hit.tmdbId,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Seerr request failed');
      }
      setRequestSent(true);
      toast.success('Request submitted to Seerr');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Seerr request failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-4 mb-4 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] p-4">
      <div className="flex gap-3">
        {hit.posterPath ? (
          <div className="relative w-20 h-30 shrink-0 rounded-md overflow-hidden bg-muted">
            <Image
              src={hit.posterPath}
              alt={hit.title}
              fill
              sizes="80px"
              className="object-cover"
            />
          </div>
        ) : (
          <div className="w-20 h-30 shrink-0 rounded-md bg-muted/40 flex items-center justify-center text-[10px] text-muted-foreground">
            No poster
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 tracked-caps text-[10px] text-muted-foreground mb-1">
            {mediaTypeLabel}
            {hit.year && <span>· {hit.year}</span>}
          </div>
          <h2 className="font-display text-xl leading-tight">{hit.title}</h2>
          <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{hit.overview}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => void addToWatchlist()}
          disabled={busy !== null || watchlistAdded}
          className="h-9 flex-1 min-w-[160px] projector-glow"
        >
          {busy === 'watchlist' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Bookmark className="mr-2 h-4 w-4" />
          )}
          {watchlistAdded ? 'Added' : 'Add to Watchlist'}
        </Button>
        <Button
          variant="outline"
          onClick={() => void requestViaSeerr()}
          disabled={busy !== null || requestSent}
          className="h-9 flex-1 min-w-[160px]"
        >
          {busy === 'request' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          {requestSent ? 'Requested' : 'Request via Seerr'}
        </Button>
      </div>

      <Link
        href={detailHref}
        className="mt-3 inline-flex items-center gap-1 text-xs text-primary"
      >
        Open in Discover
        <ExternalLink className="h-3 w-3" />
      </Link>

      {(watchlistAdded || requestSent) && (
        <div className="mt-3">
          <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
            {watchlistAdded && requestSent ? 'Added & Requested' : watchlistAdded ? 'In Watchlist' : 'Requested'}
          </Badge>
        </div>
      )}
    </div>
  );
}
