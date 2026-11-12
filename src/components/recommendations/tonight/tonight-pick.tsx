'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Film, Link2, Loader2, Play, Tv, X } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { Button } from '@/components/ui/button';
import { FadeInImage } from '@/components/media/fade-in-image';
import { hasCapability, useMe } from '@/components/permission-provider';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { haptic } from '@/lib/haptics';
import type { TonightTitle, TonightView } from '@/types/tonight';
import { TonightSwipeCard } from './tonight-swipe-card';

export const TONIGHT_POLL_MS = 2_000;
/** localStorage: the last pick this device opened, so Random can offer the way back. */
export const TONIGHT_LAST_KEY = 'helprr:tonight:last';

const subscribeToNothing = () => () => {};

function isGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

function tonightQueryKey(id: string) {
  return ['tonight', id] as const;
}

function Participants({ view }: { view: TonightView }) {
  return (
    <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-hide" aria-label="Who is in this pick">
      {view.participants.map((p) => {
        const done = p.voted >= view.titles.length;
        return (
          <li
            key={p.id}
            // Long names shrink to an ellipsis before the row scrolls.
            className={`inline-flex min-w-16 max-w-28 items-center justify-center gap-1 sm:max-w-40 whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${p.joined
              ? 'border border-primary/40 bg-primary/15 text-primary'
              : 'bg-accent/40 text-muted-foreground'
              }`}
          >
            {done && <Check className="h-3 w-3 shrink-0" aria-hidden />}
            <span className="min-w-0 truncate">{p.name}</span>
            <span className="sr-only">
              {p.joined ? `, ${p.voted} of ${view.titles.length} voted` : ', not here yet'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function WinnerActions({ title }: { title: TonightTitle }) {
  const me = useMe();
  const externalUrls = useExternalUrls();
  const canJellyfin = hasCapability(me, 'jellyfin.view');
  const params = new URLSearchParams();
  if (title.imdbId) params.set('imdbId', title.imdbId);
  if (title.tmdbId) params.set('tmdbId', String(title.tmdbId));
  if (title.tvdbId) params.set('tvdbId', String(title.tvdbId));
  const lookup = useQuery({
    queryKey: ['tonight-jellyfin-item', params.toString()],
    queryFn: jsonFetcher<{ itemId: string | null }>(`/api/jellyfin/lookup?${params}`),
    enabled: canJellyfin && params.size > 0,
    staleTime: 5 * 60_000,
  });
  const itemId = lookup.data?.itemId ?? null;
  const canPlay = itemId && me?.jellyfinConnected === true;

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {canPlay && (
        <Button asChild size="lg" className="h-11">
          <Link href={title.mediaType === 'movie' ? `/jellyfin/library/watch/${itemId}` : `/jellyfin/library/item/${itemId}`}>
            <Play className="h-4 w-4" />
            {title.mediaType === 'movie' ? 'Play' : 'Choose an episode'}
          </Link>
        </Button>
      )}
      {itemId && externalUrls.JELLYFIN && (
        <Button asChild size="lg" variant={canPlay ? 'outline' : 'default'} className="h-11">
          <a href={`${externalUrls.JELLYFIN}/web/index.html#!/details?id=${encodeURIComponent(itemId)}`} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open in Jellyfin
          </a>
        </Button>
      )}
      {lookup.isFetching && <Loader2 className="h-4 w-4 self-center animate-spin text-muted-foreground" aria-label="Finding it in Jellyfin" />}
      <Button asChild size="lg" variant="outline" className="h-11">
        <Link href={title.href}>Open details</Link>
      </Button>
    </div>
  );
}

function TitlePoster({ title, className }: { title: TonightTitle; className: string }) {
  const poster = title.posterUrl
    ? toCachedImageSrc(title.posterUrl, title.mediaType === 'movie' ? 'radarr' : 'sonarr') ?? title.posterUrl
    : null;
  const MediaIcon = title.mediaType === 'movie' ? Film : Tv;
  return (
    <div className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border ${className}`}>
      {poster ? (
        <FadeInImage src={poster} alt="" fill sizes="200px" className="object-cover" unoptimized={isProtectedApiImageSrc(poster)} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <MediaIcon className="h-10 w-10" />
        </div>
      )}
    </div>
  );
}

/**
 * The full-screen pick: joins on open, polls every ~2 s while it is open on
 * screen (TanStack pauses polling while the app is in the background), and
 * shows the winner, the no-match summary or the ended notice.
 */
export function TonightPick({ id, onClose, onOpenPick }: { id: string; onClose: () => void; onOpenPick: (id: string) => void }) {
  const queryClient = useQueryClient();
  const isClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  // Votes this device sent: shown at once, and never undone by an older poll.
  const [localVotes, setLocalVotes] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const joinedRef = useRef(false);
  const sentRef = useRef(new Set<number>());
  const dialogRef = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: tonightQueryKey(id),
    queryFn: async ({ signal }) => {
      // The first load joins (idempotent, answers with the view); later ones only read.
      const path = `/api/tonight/${encodeURIComponent(id)}`;
      const res = joinedRef.current
        ? await fetch(path, { signal })
        : await fetch(`${path}/join`, { method: 'POST', signal });
      if (!res.ok) throw new ApiError(res.status, 'Tonight pick unavailable');
      joinedRef.current = true;
      return (await res.json()) as TonightView;
    },
    refetchInterval: (q) => (!isGone(q.state.error) && q.state.data?.status === 'open' ? TONIGHT_POLL_MS : false),
    refetchIntervalInBackground: false,
    retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 403)) && count < 2,
  });
  // Expired, ended long ago, or access taken away: a cached view must not keep looking live.
  const gone = isGone(query.error);
  const view = gone ? undefined : query.data;

  const setView = useCallback(async (next: TonightView) => {
    // A poll that left before this write could land after it with older state.
    await queryClient.cancelQueries({ queryKey: tonightQueryKey(id) });
    queryClient.setQueryData(tonightQueryKey(id), next);
  }, [id, queryClient]);

  // Random offers "Back to pick" only while this pick is still being voted on.
  const expiresAt = view?.expiresAt;
  const status = view?.status;
  useEffect(() => {
    try {
      if (status === 'open' && expiresAt) {
        localStorage.setItem(TONIGHT_LAST_KEY, JSON.stringify({ id, expiresAt }));
      } else if (status || gone) {
        const last = JSON.parse(localStorage.getItem(TONIGHT_LAST_KEY) ?? 'null') as { id?: string } | null;
        if (last?.id === id) localStorage.removeItem(TONIGHT_LAST_KEY);
      }
    } catch {
      // Storage blocked: the push and the copied link still lead back here.
    }
  }, [id, expiresAt, status, gone]);

  // The dialog mounts after hydration (see isClient), so focus it then.
  useEffect(() => {
    if (isClient) dialogRef.current?.focus();
  }, [isClient]);

  const votes = { ...(view?.myVotes ?? {}), ...localVotes };
  const nextIndex = view ? view.titles.findIndex((_, i) => votes[String(i)] === undefined) : -1;

  const submitVote = useCallback(async (index: number, yes: boolean) => {
    // A button tap and an arrow key on the same card count once.
    if (sentRef.current.has(index)) return;
    sentRef.current.add(index);
    setLocalVotes((prev) => ({ ...prev, [String(index)]: yes }));
    try {
      const res = await fetch(`/api/tonight/${encodeURIComponent(id)}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, yes }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await setView((await res.json()) as TonightView);
    } catch {
      sentRef.current.delete(index);
      setLocalVotes((prev) => {
        const next = { ...prev };
        delete next[String(index)];
        return next;
      });
      toast.error('That vote didn’t go through. Try again.');
    }
  }, [id, setView]);

  useEffect(() => {
    if (status === 'matched') haptic('success');
  }, [status]);

  // Arrow keys vote too (desktop).
  useEffect(() => {
    if (status !== 'open' || nextIndex < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') void submitVote(nextIndex, true);
      else if (e.key === 'ArrowLeft') void submitVote(nextIndex, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, nextIndex, submitVote]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/recommendations?mode=random&tonight=${encodeURIComponent(id)}`);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn’t copy the link');
    }
  }

  async function endPick() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tonight/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      await setView((await res.json()) as TonightView);
    } catch {
      toast.error('Couldn’t end the pick');
    } finally {
      setBusy(false);
    }
  }

  // Same people, same filters, 20 new titles.
  async function startAgain(current: TonightView) {
    setBusy(true);
    try {
      const res = await fetch('/api/tonight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...current.filters,
          inviteeIds: current.participants.filter((p) => !p.isStarter).map((p) => p.id),
        }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) throw new Error(data?.error ?? 'Couldn’t start another round');
      onOpenPick(data.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t start another round');
    } finally {
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  } else if (!view) {
    const missing = gone;
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-medium">{missing ? 'This pick isn’t available' : 'Couldn’t open this pick'}</p>
        <p className="text-sm text-muted-foreground">
          {missing ? 'It may have ended, or it wasn’t shared with you.' : 'Check your connection and try again.'}
        </p>
        {!missing && <Button variant="outline" className="h-11" onClick={() => void query.refetch()}>Try again</Button>}
      </div>
    );
  } else if (view.status === 'matched' && view.winnerIndex !== null) {
    const winner = view.titles[view.winnerIndex];
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-4 text-center">
        <p className="tracked-caps text-xs text-primary">Everyone said yes</p>
        <TitlePoster title={winner} className="w-40 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)]" />
        <div>
          <p className="text-2xl font-semibold leading-tight">{winner.title}</p>
          {winner.year !== null && <p className="mt-1 text-sm text-muted-foreground">{winner.year}</p>}
        </div>
        <WinnerActions title={winner} />
      </div>
    );
  } else if (view.status === 'noMatch') {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-4 text-center">
        <p className="text-base font-medium">No match tonight</p>
        <p className="text-sm text-muted-foreground">Every title got a no from someone.</p>
        {view.nearMisses.length > 0 && (
          <ul className="w-full max-w-sm divide-y divide-border/50 overflow-hidden rounded-xl bg-card text-left">
            {view.nearMisses.map((m) => {
              const t = view.titles[m.index];
              return (
                <li key={m.index}>
                  <Link href={t.href} className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {m.yes} of {view.participants.filter((p) => p.joined).length} yes
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {view.isStarter ? (
          <Button size="lg" className="h-11" disabled={busy} onClick={() => void startAgain(view)}>Try 20 more</Button>
        ) : (
          <p className="text-xs text-muted-foreground">Ask {view.starterName} to start another round.</p>
        )}
      </div>
    );
  } else if (view.status === 'ended') {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-medium">{view.isStarter ? 'You ended this pick' : `${view.starterName} ended this pick`}</p>
        <Button variant="outline" className="h-11" onClick={onClose}>Close</Button>
      </div>
    );
  } else if (nextIndex < 0) {
    const waiting = view.participants.filter((p) => !p.joined || p.voted < view.titles.length);
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-base font-medium">You’re done</p>
        <p className="text-sm text-muted-foreground">
          {waiting.length > 0
            ? `Waiting for ${waiting.map((p) => p.name).join(', ')}.`
            : 'Waiting for the others.'}
        </p>
      </div>
    );
  } else {
    const title = view.titles[nextIndex];
    body = (
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <p className="mb-2 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {nextIndex + 1} of {view.titles.length}
        </p>
        <TonightSwipeCard key={nextIndex} title={title} onVote={(yes) => void submitVote(nextIndex, yes)} />
      </div>
    );
  }

  // The portal needs document.body: render nothing on the server and in the
  // first (hydrating) browser render too, so a pick opened from a link hydrates
  // the same markup the server sent.
  if (!isClient) return null;
  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Tonight pick"
      className="fixed inset-0 z-50 flex flex-col bg-background outline-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex shrink-0 items-center gap-2 px-2 py-2">
        <Button variant="ghost" size="icon" className="size-11" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" />
        </Button>
        {view ? <Participants view={view} /> : <div className="flex-1" />}
        {view && view.status !== 'ended' && (
          <Button variant="ghost" size="icon" className="size-11" onClick={() => void copyLink()} aria-label="Copy link to this pick">
            <Link2 className="h-5 w-5" />
          </Button>
        )}
        {view?.isStarter && (view.status === 'open' || view.status === 'noMatch') && (
          <Button variant="ghost" size="sm" className="h-11" onClick={() => void endPick()} disabled={busy}>
            End
          </Button>
        )}
      </div>
      {view?.narrowed && view.status === 'open' && (
        <p className="shrink-0 px-4 pb-2 text-center text-xs text-muted-foreground">
          {view.filters.watch === 'unwatched'
            ? 'Only titles everyone here can see, and nobody has watched, are in this pick.'
            : 'Only titles everyone here can see are in this pick.'}
        </p>
      )}
      {body}
    </div>,
    document.body,
  );
}
