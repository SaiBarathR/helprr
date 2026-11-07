'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { isQueryOffline } from '@/lib/network-error';
import { HeroImage } from '@/components/media/hero-image';
import { FadeInImage } from '@/components/media/fade-in-image';
import Link from '@/components/ui/app-link';
import { Clock, Dices, Film, Loader2, RefreshCw, SlidersHorizontal, Sparkles, Star, Tv, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { hasCapability, useMe } from '@/components/permission-provider';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { RandomPick, RandomWatchFilterType as FilterType } from '@/types';
import { QuickContextMenu, type ContextAction } from '@/components/ui/quick-context-menu';
import { isTonightSessionId } from '@/lib/tonight-pick-id';
import { useUIStore } from '@/lib/store';
import { MAX_RANDOM_GENRES, normalizeRandomWatchPrefs, RANDOM_RUNTIME_LABELS, RANDOM_RUNTIMES, type RandomRuntime } from '@/lib/random-watch-filters';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import { TONIGHT_LAST_KEY, TonightPick } from './tonight/tonight-pick';
import { TonightStartSheet } from './tonight/tonight-start-sheet';

type WatchFilter = 'all' | 'unwatched';

function subscribeStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** The last Tonight pick this device opened, while it may still be running. */
function readLastTonightId(): string | null {
  try {
    const raw = localStorage.getItem(TONIGHT_LAST_KEY);
    if (!raw) return null;
    const last = JSON.parse(raw) as { id?: unknown; expiresAt?: unknown };
    return isTonightSessionId(last.id) && typeof last.expiresAt === 'string' && Date.parse(last.expiresAt) > Date.now()
      ? last.id
      : null;
  } catch {
    return null;
  }
}

/** The classic Random Watch experience, now a mode inside /recommendations.
 * Moved verbatim from the old /random page. */
export function RandomWatchView() {
  const me = useMe();
  const canFilterUnwatched = me?.jellyfinLinked === true && hasCapability(me, 'jellyfin.view');

  // This device's last choices (the UI store), read defensively: an imported
  // settings file may carry anything.
  const savedFilters = useUIStore((s) => s.randomFilters);
  // Roll once the saved choice is read, not first with the defaults.
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const setRandomFilters = useUIStore((s) => s.setRandomFilters);
  const { type, unwatched: unwatchedOnly, genres, runtime: savedRuntime } = useMemo(
    () => normalizeRandomWatchPrefs(savedFilters),
    [savedFilters]
  );
  const setType = (next: FilterType) => setRandomFilters({ type: next });
  const setUnwatchedOnly = (next: boolean) => setRandomFilters({ unwatched: next });
  const toggleGenre = (genre: string) => {
    if (genres.includes(genre)) setRandomFilters({ genres: genres.filter((g) => g !== genre) });
    else if (genres.length < MAX_RANDOM_GENRES) setRandomFilters({ genres: [...genres, genre] });
  };

  const watch: WatchFilter = canFilterUnwatched && unwatchedOnly ? 'unwatched' : 'all';
  // The length is for movies only, so it is hidden and set aside when only
  // series are wanted.
  const runtime: RandomRuntime = type === 'series' ? 'any' : savedRuntime;
  const activeFilterCount = genres.length + (runtime === 'any' ? 0 : 1);

  // A Tonight pick opens over Random from ?tonight=<id> (the push and the copied link).
  const searchParams = useSearchParams();
  const router = useRouter();
  const tonightParam = searchParams.get('tonight');
  const tonightId = isTonightSessionId(tonightParam) ? tonightParam : null;
  const lastTonightId = useSyncExternalStore(subscribeStorage, readLastTonightId, () => null);
  const [tonightSheetOpen, setTonightSheetOpen] = useState(false);
  const openTonight = (id: string) => {
    setTonightSheetOpen(false);
    router.replace(`/recommendations?mode=random&tonight=${encodeURIComponent(id)}`, { scroll: false });
  };
  const closeTonight = () => router.replace('/recommendations?mode=random', { scroll: false });

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams({ type, watch });
    if (runtime !== 'any') params.set('runtime', runtime);
    for (const genre of genres) params.append('genre', genre);
    return `/api/random-watch?${params}`;
  }, [type, watch, runtime, genres]);

  // Each fetch returns a fresh random pick; gcTime:0 so we never reuse a stale
  // one. Changing filters (new key) or refetching (manual reroll) rolls again.
  const rollQuery = useQuery({
    queryKey: ['random-watch', type, watch, runtime, genres],
    queryFn: jsonFetcher<{ pick: RandomPick | null; poolSize: number; genres?: string[] }>(apiUrl),
    staleTime: 0,
    gcTime: 0,
    enabled: hasHydrated,
  });
  const pick = rollQuery.data?.pick ?? null;
  const poolSize = rollQuery.data?.poolSize ?? null;

  // The library's genres for this type, kept while the next roll loads; a
  // chosen genre the pool no longer has stays listed so it can be cleared.
  const fetchedGenres = rollQuery.data?.genres;
  const [poolGenreList, setPoolGenreList] = useState<string[]>([]);
  if (fetchedGenres && fetchedGenres !== poolGenreList) setPoolGenreList(fetchedGenres);
  const genreOptions = useMemo(
    () => [...new Set([...poolGenreList, ...genres])].sort((a, b) => a.localeCompare(b)),
    [poolGenreList, genres]
  );
  const loading = rollQuery.isFetching || !hasHydrated;
  const offline = isQueryOffline(rollQuery);
  const error = offline
    ? "You're offline"
    : rollQuery.isError
      ? rollQuery.error instanceof Error
        ? rollQuery.error.message
        : 'Failed to fetch a pick'
      : null;

  const poster = pick?.posterUrl
    ? toCachedImageSrc(pick.posterUrl, pick.mediaType === 'movie' ? 'radarr' : 'sonarr') ?? pick.posterUrl
    : null;
  const backdrop = pick?.backdropUrl
    ? toCachedImageSrc(pick.backdropUrl, pick.mediaType === 'movie' ? 'radarr' : 'sonarr', { width: 1280 }) ?? pick.backdropUrl
    : null;
  const resultActions: ContextAction[] = pick ? [
    {
      id: 'open',
      label: 'Open details',
      icon: pick.mediaType === 'movie' ? <Film className="h-4 w-4" /> : <Tv className="h-4 w-4" />,
      href: pick.href,
    },
    {
      id: 'reroll',
      label: 'Pick another',
      icon: <RefreshCw className="h-4 w-4" />,
      pending: loading,
      onSelect: () => void rollQuery.refetch(),
    },
  ] : [];

  return (
    // Embedded in /recommendations, which owns page padding/animation; the
    // -mx heroes below now bleed into the shell padding = true full-bleed.
    <div className="space-y-4">
        <TonightStartSheet
          open={tonightSheetOpen}
          onOpenChange={setTonightSheetOpen}
          filters={{ type, watch, genres, runtime }}
          onStarted={openTonight}
        />
        {tonightId && <TonightPick key={tonightId} id={tonightId} onClose={closeTonight} onOpenPick={openTonight} />}
        {/* Single-row control bar: never wraps; overflows into horizontal scroll
            on very narrow screens instead of breaking onto a second line. */}
        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {(['any', 'movie', 'series'] as FilterType[]).map((t) => {
            const active = type === t;
            const label = t === 'any' ? 'All' : t === 'movie' ? 'Movies' : 'Series';
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-label={label}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${active
                  ? 'border border-primary/40 bg-primary/20 text-primary'
                  : 'bg-accent/40 text-muted-foreground'
                  }`}
              >
                {t === 'movie' && <Film className="h-3.5 w-3.5" />}
                {t === 'series' && <Tv className="h-3.5 w-3.5" />}
                {t === 'any' && <Dices className="h-3.5 w-3.5" />}
                {t === 'any' ? label : null}
              </button>
            );
          })}
          {canFilterUnwatched && (
            <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
              <span>Unwatched</span>
              <Switch
                size="sm"
                checked={unwatchedOnly}
                onCheckedChange={setUnwatchedOnly}
                aria-label="Unwatched only"
              />
            </label>
          )}
          <ResponsiveMenu
            title="Filters"
            trigger={(
              <button
                type="button"
                className={`touch-target inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${activeFilterCount > 0
                  ? 'border border-primary/40 bg-primary/20 text-primary'
                  : 'bg-accent/40 text-muted-foreground'
                  }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {activeFilterCount > 0 ? `Filters · ${activeFilterCount}` : 'Filters'}
              </button>
            )}
          >
            {type !== 'series' && (
              <>
                <ResponsiveMenuLabel>Movie length</ResponsiveMenuLabel>
                {RANDOM_RUNTIMES.map((preset) => (
                  <ResponsiveMenuCheckboxItem
                    key={preset}
                    checked={runtime === preset}
                    onCheckedChange={() => setRandomFilters({ runtime: preset })}
                  >
                    {RANDOM_RUNTIME_LABELS[preset]}
                  </ResponsiveMenuCheckboxItem>
                ))}
                <ResponsiveMenuSeparator />
              </>
            )}
            <ResponsiveMenuLabel>Genres</ResponsiveMenuLabel>
            <ResponsiveMenuCheckboxItem checked={genres.length === 0} onCheckedChange={() => setRandomFilters({ genres: [] })}>
              Any genre
            </ResponsiveMenuCheckboxItem>
            {genreOptions.map((genre) => (
              <ResponsiveMenuCheckboxItem key={genre} checked={genres.includes(genre)} onCheckedChange={() => toggleGenre(genre)}>
                {genre}
              </ResponsiveMenuCheckboxItem>
            ))}
          </ResponsiveMenu>
          <button
            type="button"
            onClick={() => (lastTonightId ? openTonight(lastTonightId) : setTonightSheetOpen(true))}
            className="touch-target relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            <Users className="h-3.5 w-3.5" />
            {lastTonightId ? 'Back to pick' : 'Pick together'}
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1.5">
            {poolSize !== null && (
              <span className="whitespace-nowrap rounded-full bg-accent/40 px-2.5 py-1 text-[11px] tabular-nums text-muted-foreground">
                Pool: {poolSize}
              </span>
            )}
            <Button
              size="icon-sm"
              onClick={() => rollQuery.refetch()}
              disabled={loading}
              variant="outline"
              aria-label="Pick another"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}

        {loading && !pick ? (
          <div className="py-24 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </div>
        ) : !pick ? (
          <div className="py-24 text-center text-muted-foreground space-y-1">
            <Dices className="h-10 w-10 mx-auto opacity-50" />
            {offline ? (
              <p className="text-sm">A pick loads when the connection returns.</p>
            ) : (
              <>
                <p className="text-sm">Nothing downloaded matches this filter.</p>
                <p className="text-xs">
                  {activeFilterCount > 0
                    ? 'Try other genres or another length.'
                    : watch === 'unwatched'
                      ? 'Try turning off Unwatched only, or mark something unwatched in Jellyfin.'
                      : 'Configure Sonarr/Radarr in Settings and download a few items first.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="relative -mx-2 overflow-hidden md:-mx-6 md:rounded-2xl">
            <div className="relative h-[200px] w-full bg-muted sm:h-[260px] md:h-[320px]">
              {backdrop ? (
                <>
                  <HeroImage
                    src={backdrop}
                    alt=""
                    fill
                    sizes="100vw"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(backdrop)}
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent light:via-background/25" />
                  <div className="absolute inset-0 bg-gradient-to-r from-background/50 to-transparent light:from-background/30" />
                  <div className="absolute top-1.5 right-1.5 md:top-5 md:right-6 hero-meta-fade flex flex-col items-end gap-2">
                    <Link
                      className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-lg text-foreground px-3 py-1.5 text-[14px] font-medium hover:bg-background/70 transition-colors"
                      href={pick.href}>
                      <Sparkles className="h-3.5 w-3.5" />
                      Open in {pick.mediaType === 'movie' ? 'Movies' : 'Series'}
                    </Link>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-card via-background to-card" />
              )}
            </div>

            <div className="relative -mt-20 flex flex-col gap-4 px-3 md:-mt-28 md:flex-row md:gap-6 md:px-6">
              <QuickContextMenu label={`Actions for ${pick.title}`} actions={resultActions}>
                <div className="relative mx-auto aspect-[2/3] w-[120px] shrink-0 overflow-hidden rounded-xl bg-muted shadow-[0_20px_50px_-15px_rgba(0,0,0,0.7)] ring-1 ring-border md:mx-0 md:w-[180px]">
                  {poster ? (
                    <FadeInImage
                      src={poster}
                      alt={pick.title}
                      width={360}
                      height={540}
                      className="absolute inset-0 h-full w-full object-cover"
                      unoptimized={isProtectedApiImageSrc(poster)}
                      priority
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      {pick.mediaType === 'movie' ? (
                        <Film className="h-12 w-12" />
                      ) : (
                        <Tv className="h-12 w-12" />
                      )}
                    </div>
                  )}
                </div>
              </QuickContextMenu>

              <div className="space-y-3 md:pt-24">
                <div>
                  <h2 className="text-2xl font-semibold leading-tight">{pick.title}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {pick.year !== null && <span>{pick.year}</span>}
                    {pick.runtime !== null && pick.runtime > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {pick.runtime}m
                      </span>
                    )}
                    {pick.rating !== null && pick.rating > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                        {pick.rating.toFixed(1)}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      {pick.mediaType === 'movie' ? (
                        <Film className="h-3.5 w-3.5" />
                      ) : (
                        <Tv className="h-3.5 w-3.5" />
                      )}
                      {pick.mediaType === 'movie' ? 'Movie' : 'Series'}
                    </span>
                  </div>
                </div>
                {pick.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pick.genres.slice(0, 6).map((g) => (
                      <span
                        key={g}
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}
                {pick.overview && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{pick.overview}</p>
                )}
                <div className="pt-2">
                  <Button asChild>
                    <Link href={pick.href}>Open details</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
