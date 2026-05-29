'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, AlertTriangle, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';

interface ProtocolRouterProps {
  command: string | null;
  params: Record<string, string>;
}

type Status = 'idle' | 'running' | 'done' | 'error';

export function ProtocolRouter({ command, params }: ProtocolRouterProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('Routing…');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      try {
        if (!command) {
          setStatus('error');
          setMessage('No command supplied.');
          return;
        }
        setStatus('running');

        const mediaType = params.type === 'tv' || params.mediaType === 'tv' ? 'tv' : 'movie';
        // Accept the id from ?tmdbId= or from a positional path segment, so both
        // helprr://watchlist?tmdbId=123 and helprr://watchlist/add/123 work
        // (protocol/page.tsx stashes trailing path segments in params.args).
        const positionalId = params.args?.split('/').find((s) => /^\d+$/.test(s));
        // Number('') is 0 and Number.isFinite(0) is true, so guard on a positive
        // integer to reject empty/zero/fractional tmdbId values.
        const tmdbId = Number(params.tmdbId || positionalId);
        const hasValidTmdbId = Number.isInteger(tmdbId) && tmdbId > 0;

        switch (command) {
          case 'watchlist':
          case 'watchlist/add': {
            if (!hasValidTmdbId) throw new Error('tmdbId is required');
            await addToWatchlist({
              tmdbId,
              mediaType: mediaType === 'tv' ? 'series' : 'movie',
              title: params.title,
              year: params.year ? Number(params.year) : undefined,
            });
            setStatus('done');
            setMessage('Added to watchlist');
            toast.success('Added to watchlist');
            router.replace('/watchlist');
            return;
          }
          case 'request': {
            if (!hasValidTmdbId) throw new Error('tmdbId is required');
            await createSeerrRequest({ tmdbId, mediaType });
            setStatus('done');
            setMessage('Request submitted');
            toast.success('Request submitted to Seerr');
            router.replace('/requests');
            return;
          }
          case 'discover': {
            const target = params.query
              ? `/discover?q=${encodeURIComponent(params.query)}`
              : '/discover';
            setStatus('done');
            setMessage('Opening Discover');
            router.replace(target);
            return;
          }
          default: {
            throw new Error(`Unknown command: ${command}`);
          }
        }
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Action failed');
      }
    })();
  }, [command, params, router]);

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Helprr
        </Link>
      </div>

      <div className="px-6 py-16 flex flex-col items-center text-center gap-3">
        {status === 'error' ? (
          <AlertTriangle className="h-8 w-8 text-rose-400" />
        ) : (
          <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
        )}
        <h1 className="font-display text-2xl">
          {status === 'error' ? 'Couldn’t route' : status === 'done' ? 'Done' : 'Routing…'}
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
        {status === 'error' && (
          <Link
            href="/"
            className="mt-4 text-sm text-primary hover:underline underline-offset-4"
          >
            Go home
          </Link>
        )}
      </div>
    </div>
  );
}

async function addToWatchlist(args: {
  tmdbId: number;
  mediaType: 'movie' | 'series';
  title?: string;
  year?: number;
}): Promise<void> {
  const res = await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'TMDB',
      externalId: String(args.tmdbId),
      mediaType: args.mediaType,
      title: args.title ?? 'Untitled',
      year: args.year,
    }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || `Watchlist add failed (HTTP ${res.status})`);
  }
}

async function createSeerrRequest(args: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
}): Promise<void> {
  const res = await fetch('/api/seerr/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaType: args.mediaType,
      tmdbId: args.tmdbId,
    }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || `Seerr request failed (HTTP ${res.status})`);
  }
}
