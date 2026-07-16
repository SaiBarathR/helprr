'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FadeInImage } from '@/components/media/fade-in-image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Sparkles, Star, Clock, BookOpen, Loader2, ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useQuery } from '@tanstack/react-query';
import {
  getListViewState,
  setListViewState,
  type MediaListKey,
} from '@/lib/media-list-cache';
import type {
  AniListMediaListCollection,
  AniListMediaListEntry,
  AniListMediaListStatus,
  AniListMediaType,
} from '@/lib/anilist-mutations';
import { AnilistStatusDrawer } from '@/components/anime/anilist-status-drawer';
import { QuickContextMenu, type ContextAction } from '@/components/ui/quick-context-menu';

interface ViewerResponse {
  configured: boolean;
  connected: boolean | null;
  requiresReauth: boolean;
  transientError?: boolean;
  user?: {
    id: number;
    name: string;
    avatar: string | null;
    siteUrl: string | null;
    scoreFormat: string | null;
    statistics?: {
      anime: { count: number; meanScore: number; minutesWatched: number; episodesWatched: number };
      manga: { count: number; meanScore: number; chaptersRead: number; volumesRead: number };
    };
  };
}

interface LibraryResponse {
  type: AniListMediaType;
  status: AniListMediaListStatus | null;
  collection: AniListMediaListCollection;
}

const STATUS_TABS: { value: AniListMediaListStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'CURRENT', label: 'Watching' },
  { value: 'PLANNING', label: 'Planning' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'DROPPED', label: 'Dropped' },
  { value: 'REPEATING', label: 'Repeating' },
];

const STATUS_TABS_MANGA: { value: AniListMediaListStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'CURRENT', label: 'Reading' },
  { value: 'PLANNING', label: 'Planning' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'DROPPED', label: 'Dropped' },
  { value: 'REPEATING', label: 'Re-reading' },
];

const VALID_STATUS_VALUES = new Set<string>([
  'ALL',
  'CURRENT',
  'PLANNING',
  'COMPLETED',
  'DROPPED',
  'PAUSED',
  'REPEATING',
]);

const PAGE_SIZE = 30;
const SHARED_VIEW_KEY: MediaListKey = 'anime-library:_shared';

interface SharedExtras {
  type?: AniListMediaType;
  status?: AniListMediaListStatus | 'ALL';
}

interface PerTabExtras {
  renderedCount?: number;
}

function tabKey(type: AniListMediaType, status: AniListMediaListStatus | 'ALL'): MediaListKey {
  return `anime-library:${type}:${status}`;
}

function flattenCollection(collection: AniListMediaListCollection): AniListMediaListEntry[] {
  const seen = new Set<number>();
  const result: AniListMediaListEntry[] = [];
  for (const list of collection.lists) {
    for (const entry of list.entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      result.push(entry);
    }
  }
  return result;
}

function pickTitle(media: AniListMediaListEntry['media']): string {
  return media.title.english || media.title.romaji || media.title.native || `#${media.id}`;
}

function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function ensureHeightReached(targetScrollY: number, timeoutMs = 1200, pollMs = 50) {
  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const maxScroll = Math.max(0, document.body.scrollHeight - window.innerHeight);
      if (maxScroll >= targetScrollY || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, pollMs);
    };
    tick();
  });
}

export default function AnimeLibraryPage() {
  const urlParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const urlType = urlParams.get('type');
  const urlStatus = urlParams.get('status');

  const [type, setType] = useState<AniListMediaType>('ANIME');
  const [status, setStatus] = useState<AniListMediaListStatus | 'ALL'>('ALL');
  const [hydrated, setHydrated] = useState(false);
  const [editingEntry, setEditingEntry] = useState<AniListMediaListEntry | null>(null);

  // Keep URL in sync with selected tab/type so back navigation lands on the same view
  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    if (type !== 'ANIME') params.set('type', type);
    if (status !== 'ALL') params.set('status', status);
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    const current = `${pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}`;
    if (target !== current) {
      router.replace(target, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, type, status, pathname]);

  const cacheKey = tabKey(type, status);

  const [renderedCount, setRenderedCount] = useState<number>(PAGE_SIZE);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasRestoredScrollRef = useRef(false);

  // Viewer connection/stats. On !ok — or a network rejection (offline PWA) — we
  // treat it as not-configured (parity with the old loadViewer catch) rather than
  // leaving `viewer` null, which would strand the page on an infinite spinner.
  const viewerQuery = useQuery({
    queryKey: ['anilist', 'viewer'],
    queryFn: async ({ signal }): Promise<ViewerResponse> => {
      try {
        const res = await fetch('/api/anilist/viewer', { signal });
        if (!res.ok) return { configured: false, connected: false, requiresReauth: false };
        return (await res.json()) as ViewerResponse;
      } catch (e) {
        if (signal?.aborted) throw e; // a cancelled fetch must stay cancelled, not resolve
        return { configured: false, connected: false, requiresReauth: false };
      }
    },
  });
  const viewer = viewerQuery.data ?? null;

  // Full collection for the active (type, status). Not server-paginated — the
  // page slices it client-side via renderedCount. gcTime keeps each tab warm.
  const libraryQuery = useQuery({
    queryKey: ['anilist', 'library', type, status],
    queryFn: async ({ signal }): Promise<LibraryResponse> => {
      const params = new URLSearchParams({ type });
      if (status !== 'ALL') params.set('status', status);
      const res = await fetch(`/api/anilist/library?${params}`, { signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.requiresReauth
            ? 'Your AniList session expired. Reconnect from Settings.'
            : data.error || 'Failed to load library',
        );
      }
      return res.json() as Promise<LibraryResponse>;
    },
    enabled: hydrated && !!viewer?.connected,
    // No keepPreviousData: switching type/status must show a loading spinner for
    // the newly-selected tab, not the previous tab's stale grid. Already-cached
    // tabs (within gcTime) still render instantly, so back-navigation stays snappy.
  });
  const collection = libraryQuery.data?.collection ?? null;
  // Spinner whenever the *current* tab has no data yet. isPending (no cached data
  // for this key) — not isLoading — covers the idle/paused frames where a freshly
  // keyed query isn't actively fetching; those previously fell through to the
  // empty state on a tab's first visit. The empty state is now only reached once
  // the query has settled with zero entries.
  const loading = !!viewer?.connected && (!hydrated || libraryQuery.isPending);
  const refreshing = libraryQuery.isFetching && !libraryQuery.isPending;
  const errorMessage = !collection && libraryQuery.isError
    ? libraryQuery.error instanceof Error
      ? libraryQuery.error.message
      : 'Failed to load library'
    : null;

  useEffect(() => {
    const sharedView = getListViewState(SHARED_VIEW_KEY);
    const sharedExtras = (sharedView?.extras ?? {}) as SharedExtras;

    const restoredType: AniListMediaType =
      urlType === 'MANGA' || urlType === 'ANIME'
        ? urlType
        : sharedExtras.type === 'MANGA' || sharedExtras.type === 'ANIME'
          ? sharedExtras.type
          : 'ANIME';

    const restoredStatus: AniListMediaListStatus | 'ALL' =
      urlStatus && VALID_STATUS_VALUES.has(urlStatus)
        ? (urlStatus as AniListMediaListStatus | 'ALL')
        : sharedExtras.status && VALID_STATUS_VALUES.has(sharedExtras.status)
          ? sharedExtras.status
          : 'ALL';

    // Collection + viewer now come from the query cache; only restore tab + the
    // client-side renderedCount from the (kept) view-state half.
    const cachedView = getListViewState(tabKey(restoredType, restoredStatus));
    const extras = (cachedView?.extras ?? {}) as PerTabExtras;

    setType(restoredType);
    setStatus(restoredStatus);
    setRenderedCount(extras.renderedCount && extras.renderedCount > 0 ? extras.renderedCount : PAGE_SIZE);
    setHydrated(true);
  }, [urlStatus, urlType]);

  const persistShared = useCallback(
    (nextType: AniListMediaType, nextStatus: AniListMediaListStatus | 'ALL') => {
      setListViewState(SHARED_VIEW_KEY, {
        scrollY: 0,
        search: '',
        extras: { type: nextType, status: nextStatus } satisfies SharedExtras,
      });
    },
    []
  );

  const persistTabView = useCallback(
    (nextRenderedCount: number, scrollY = window.scrollY) => {
      setListViewState(cacheKey, {
        scrollY,
        search: '',
        extras: { renderedCount: nextRenderedCount } satisfies PerTabExtras,
      });
    },
    [cacheKey]
  );

  // On tab/type change: persist the shared tab selection, restore that tab's
  // client-side render count from view-state, and reset scroll-restore. The
  // collection itself is fetched by libraryQuery (keyed on type+status).
  useEffect(() => {
    if (!viewer?.connected) return;
    persistShared(type, status);

    const savedView = getListViewState(cacheKey);
    const extras = (savedView?.extras ?? {}) as PerTabExtras;
    setRenderedCount(extras.renderedCount && extras.renderedCount > 0 ? extras.renderedCount : PAGE_SIZE);

    hasRestoredScrollRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer?.connected, type, status]);

  const flatEntries = useMemo<AniListMediaListEntry[]>(() => {
    if (!collection) return [];
    return flattenCollection(collection);
  }, [collection]);

  const visibleEntries = useMemo(() => flatEntries.slice(0, renderedCount), [flatEntries, renderedCount]);
  const hasMore = renderedCount < flatEntries.length;

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRenderedCount((prev) => {
            const next = Math.min(flatEntries.length, prev + PAGE_SIZE);
            persistTabView(next);
            return next;
          });
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, flatEntries.length, persistTabView]);

  // Restore scroll position after data is rendered
  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) return;
    const saved = getListViewState(cacheKey);
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      await ensureHeightReached(saved.scrollY);
      if (cancelled) return;
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      hasRestoredScrollRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, cacheKey, visibleEntries.length]);

  // Persist scroll position while user scrolls
  useEffect(() => {
    let lastSaved = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastSaved < 150) return;
      lastSaved = now;
      persistTabView(renderedCount, window.scrollY);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [renderedCount, persistTabView]);

  const stats = viewer?.user?.statistics;
  const tabs = type === 'ANIME' ? STATUS_TABS : STATUS_TABS_MANGA;

  const handleSelectType = useCallback(
    (next: AniListMediaType) => {
      if (next === type) return;
      setType(next);
      setStatus('ALL');
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [type]
  );

  const handleSelectStatus = useCallback(
    (next: AniListMediaListStatus | 'ALL') => {
      if (next === status) return;
      setStatus(next);
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [status]
  );

  if (!viewer) {
    return <PageSpinner />;
  }

  if (!viewer.connected) {
    return (
      <div className="animate-content-in pt-8 px-4 max-w-md mx-auto text-center space-y-4">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-pink-500/15 text-pink-400">
          <Sparkles className="h-5 w-5" />
        </span>
        <h1 className="text-xl font-bold">Connect AniList</h1>
        <p className="text-sm text-muted-foreground">
          {viewer.requiresReauth
            ? 'Your AniList session expired. Reconnect from Settings to view your library.'
            : 'Sign in with AniList from Settings to track anime and manga progress here.'}
        </p>
        <Button asChild>
          <Link href="/settings">Open Settings</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <Link
        href="/anime"
        className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors pt-2 pb-1"
      >
        <ChevronLeft className="h-4 w-4" />
        Anime
      </Link>

      <div className="flex items-center justify-between gap-3 pt-1 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          {viewer.user?.avatar && (
            <Image
              src={viewer.user.avatar}
              alt={viewer.user.name}
              width={40}
              height={40}
              className="rounded-full object-cover w-10 h-10"
              unoptimized
            />
          )}
          <div className="min-w-0">
            <p className="tracked-caps text-muted-foreground">My AniList</p>
            <p className="font-display font-semibold text-lg leading-tight truncate">
              {viewer.user?.name}
            </p>
          </div>
        </div>
        {viewer.user?.siteUrl && (
          <a
            href={viewer.user.siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View on AniList
          </a>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-2 pb-3">
          {type === 'ANIME' ? (
            <>
              <StatCard icon={<Sparkles className="h-3.5 w-3.5" />} label="Anime" value={String(stats.anime.count)} />
              <StatCard icon={<Star className="h-3.5 w-3.5" />} label="Avg Score" value={stats.anime.meanScore ? stats.anime.meanScore.toFixed(1) : '—'} />
              <StatCard icon={<Clock className="h-3.5 w-3.5" />} label="Watched" value={formatHours(stats.anime.minutesWatched)} />
            </>
          ) : (
            <>
              <StatCard icon={<BookOpen className="h-3.5 w-3.5" />} label="Manga" value={String(stats.manga.count)} />
                <StatCard icon={<Star className="h-3.5 w-3.5" />} label="Avg Score" value={stats.manga.meanScore ? stats.manga.meanScore.toFixed(1) : '—'} />
              <StatCard icon={<BookOpen className="h-3.5 w-3.5" />} label="Chapters" value={stats.manga.chaptersRead.toLocaleString()} />
            </>
          )}
        </div>
      )}

      {/* Type toggle */}
      <div className="flex gap-2 pb-2">
        {(['ANIME', 'MANGA'] as const).map((t) => {
          const active = type === t;
          return (
            <Button
              key={t}
              size="sm"
              variant={active ? 'default' : 'outline'}
              className="h-8 text-xs px-4"
              onClick={() => handleSelectType(t)}
            >
              {t === 'ANIME' ? 'Anime' : 'Manga'}
            </Button>
          );
        })}
      </div>

      {/* Status tabs */}
      <div className="page-toolbar pt-1 pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const active = status === tab.value;
            return (
              <Button
                key={tab.value}
                size="sm"
                variant={active ? 'default' : 'outline'}
                className="shrink-0 h-8 text-xs"
                onClick={() => handleSelectStatus(tab.value)}
              >
                {tab.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <PageSpinner />
      ) : errorMessage ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {errorMessage}
        </div>
      ) : flatEntries.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          Nothing here yet. Add an anime or manga from the discover page.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 pt-2">
            {visibleEntries.map((entry, i) => (
              <LibraryEntryCard
                key={entry.id}
                entry={entry}
                imagePriority={i < 4}
                onNavigate={() => persistTabView(renderedCount, window.scrollY)}
                onEdit={() => setEditingEntry(entry)}
              />
            ))}
          </div>
          <div ref={sentinelRef} className="h-4" />
          {hasMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {refreshing && !hasMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
            </div>
          )}
        </>
      )}

      {editingEntry ? (
        <AnilistStatusDrawer
          open
          onOpenChange={(open) => {
            if (!open) setEditingEntry(null);
          }}
          mediaId={editingEntry.media.id}
          mediaTitle={pickTitle(editingEntry.media)}
          mediaType={type}
          totalEpisodes={editingEntry.media.episodes}
          totalChapters={editingEntry.media.chapters}
          totalVolumes={editingEntry.media.volumes}
          entry={editingEntry}
          scoreFormat={viewer.user?.scoreFormat}
          onSaved={() => {
            setEditingEntry(null);
            void libraryQuery.refetch();
          }}
          onDeleted={() => {
            setEditingEntry(null);
            void libraryQuery.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="md:px-3 px-2 md:py-2.5 py-2">
      <div className="flex items-center gap-1 md:gap-1.5 text-muted-foreground tracked-caps">
        {icon}
        {label}
      </div>
      <p className="font-semibold text-base mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}

function LibraryEntryCard({
  entry,
  imagePriority,
  onNavigate,
  onEdit,
}: {
  entry: AniListMediaListEntry;
  imagePriority?: boolean;
  onNavigate?: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const media = entry.media;
  const title = pickTitle(media);
  const cover = media.coverImage?.large || media.coverImage?.medium || media.coverImage?.extraLarge || null;
  const imgSrc = cover ? toCachedImageSrc(cover, 'anilist') || cover : null;
  const isManga = media.format === 'MANGA' || media.format === 'NOVEL' || media.format === 'ONE_SHOT';
  const detailHref = isManga ? `/anime/manga/${media.id}` : `/anime/${media.id}`;

  const total = isManga ? media.chapters ?? null : media.episodes ?? null;
  const progressLabel = total != null ? `${entry.progress}/${total}` : `${entry.progress}`;
  const siteUrl = 'siteUrl' in media && typeof media.siteUrl === 'string' ? media.siteUrl : null;
  const actions: ContextAction[] = [
    {
      id: 'open',
      label: 'Open details',
      icon: <BookOpen className="h-4 w-4" />,
      onSelect: () => {
        onNavigate?.();
        router.push(detailHref);
      },
    },
    {
      id: 'edit',
      label: 'Edit score & status…',
      icon: <Pencil className="h-4 w-4" />,
      onSelect: onEdit,
    },
    ...(siteUrl ? [{
      id: 'anilist',
      label: 'View on AniList',
      icon: <ExternalLink className="h-4 w-4" />,
      href: siteUrl,
      external: true,
    }] : []),
  ];

  return (
    <QuickContextMenu label={`Actions for ${title}`} actions={actions}>
      <Link href={detailHref} className="group" onClick={onNavigate}>
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-sm group-hover:shadow-md transition-shadow">
          {imgSrc ? (
            <FadeInImage
              src={imgSrc}
              alt={title}
              fill
              sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"
              priority={imagePriority}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized={isProtectedApiImageSrc(imgSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
              {title}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/70 to-transparent pointer-events-none" />
          {entry.score > 0 && (
            <Badge className="absolute top-1 right-1 text-[9px] bg-background/60 text-foreground gap-0.5">
              <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
              {entry.score}
            </Badge>
          )}
          <Badge className="absolute bottom-1 left-1 text-[9px] bg-background/60 text-foreground">
            {progressLabel}
          </Badge>
        </div>
        <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{title}</p>
      </Link>
    </QuickContextMenu>
  );
}
