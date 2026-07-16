'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dices, GalleryVerticalEnd, Loader2, Popcorn, RefreshCw, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HeroCarousel } from '@/components/hero-carousel';
import { jsonFetcher } from '@/lib/query-fetch';
import { isProtectedApiImageSrc } from '@/lib/image';
import type { RecommendationsResponse, RecItem } from '@/lib/recommendations/rec-types';
import { RecRail } from '@/components/recommendations/rec-rail';
import { RecFeed } from '@/components/recommendations/rec-feed';
import { RandomWatchView } from '@/components/recommendations/random-watch';
import { backdropSrcOf } from '@/components/recommendations/rec-card';
import { useRecEvents } from '@/components/recommendations/use-rec-events';
import { hasCapability, useMe } from '@/components/permission-provider';

type Mode = 'rails' | 'feed' | 'random';

const MODES: Array<{ id: Mode; label: string; icon: typeof Popcorn }> = [
  { id: 'rails', label: 'For You', icon: Popcorn },
  { id: 'feed', label: 'Feed', icon: GalleryVerticalEnd },
  { id: 'random', label: 'Random', icon: Dices },
];

/** One hero slide — same visual language as the Discover home carousel. */
function HeroSlide({ item, railTitle, priority, tracker }: {
  item: RecItem;
  railTitle: string;
  priority: boolean;
  tracker: ReturnType<typeof useRecEvents>;
}) {
  const backdrop = backdropSrcOf(item);
  if (!backdrop) return null;
  return (
    <Link
      href={item.href}
      onClick={() => tracker.event('click', item, 'hero', 'rails')}
      className="block h-full"
    >
      <div className="relative h-full overflow-hidden">
        <Image
          src={backdrop}
          alt={item.title}
          fill
          sizes="100vw"
          className="object-cover animate-hero-zoom"
          unoptimized={isProtectedApiImageSrc(backdrop)}
          priority={priority}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        {/* pb-9 keeps the meta clear of the carousel dots */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 px-4 pt-4 pb-9">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary drop-shadow">
            {item.reason ?? railTitle}
          </p>
          <h1 className="line-clamp-2 text-2xl font-bold leading-tight drop-shadow-lg md:text-3xl">{item.title}</h1>
          <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
            {item.matchPct != null && (
              <span className="font-semibold text-[#46d369]">{item.matchPct}% match</span>
            )}
            {item.year != null && <span>{item.year}</span>}
            {item.rating != null && item.rating > 0 && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                {item.rating.toFixed(1)}
              </span>
            )}
            {item.genres.slice(0, 3).map((g) => (
              <span key={g} className="rounded-full border px-2 py-0.5 text-xs backdrop-blur-sm">{g}</span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Netflix-style loading state: hero block + two poster rows shimmering. */
function RailsSkeleton({ fullBleed }: { fullBleed: string }) {
  return (
    <div className="space-y-6">
      <Skeleton className={`${fullBleed} h-[280px] rounded-none md:h-[380px]`} />
      {[0, 1].map((row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <div className={`${fullBleed} flex gap-2.5 overflow-hidden px-2 md:gap-3 md:px-6`}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="w-[116px] shrink-0 md:w-[150px]">
                <Skeleton className="aspect-[2/3] w-full rounded-lg" />
                <Skeleton className="mt-1.5 h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecommendationsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const tracker = useRecEvents();
  const me = useMe();
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  // The two capabilities gate independently (server-enforced by their APIs):
  // a random.view-only user gets just the Random mode, and vice versa.
  const canRecommendations = hasCapability(me, 'recommendations.view');
  const canRandom = hasCapability(me, 'random.view');
  const availableModes = MODES.filter(({ id }) =>
    id === 'random' ? canRandom : canRecommendations
  );

  const rawMode = searchParams.get('mode');
  const requested: Mode = rawMode === 'feed' || rawMode === 'random' ? rawMode : 'rails';
  const mode: Mode = availableModes.some((m) => m.id === requested)
    ? requested
    : availableModes[0]?.id ?? 'rails';
  const setMode = (next: Mode) => {
    router.replace(next === 'rails' ? '/recommendations' : `/recommendations?mode=${next}`, { scroll: false });
  };

  const railsQuery = useQuery({
    queryKey: ['recommendations'],
    queryFn: jsonFetcher<RecommendationsResponse>('/api/recommendations'),
    staleTime: 5 * 60 * 1000,
    enabled: mode !== 'random' && canRecommendations,
  });

  const onNotInterested = useCallback((itemKey: string) => {
    setHiddenKeys((prev) => new Set(prev).add(itemKey));
    // Flush so the server-side cache bust lands before the next refetch.
    void tracker.flush();
  }, [tracker]);

  const rails = useMemo(() => railsQuery.data?.rails ?? [], [railsQuery.data]);

  // Hero carousel: strongest backdrop-bearing picks across rails, one per rail
  // first (variety), then filling from top-picks. Continue-watching stays a
  // rail — resuming isn't a "discovery moment".
  const heroItems = useMemo(() => {
    const out: Array<{ item: RecItem; railTitle: string }> = [];
    const seen = new Set<string>();
    const take = (item: RecItem, railTitle: string) => {
      if (!item.backdropUrl || seen.has(item.itemKey) || hiddenKeys.has(item.itemKey)) return;
      seen.add(item.itemKey);
      out.push({ item, railTitle });
    };
    for (const rail of rails) {
      if (rail.id === 'continue-watching' || out.length >= 6) continue;
      const first = rail.items.find((i) => i.backdropUrl && !hiddenKeys.has(i.itemKey));
      if (first) take(first, rail.title);
    }
    const topPicks = rails.find((r) => r.id === 'top-picks');
    for (const item of topPicks?.items ?? []) {
      if (out.length >= 6) break;
      take(item, topPicks?.title ?? 'Top pick for you');
    }
    return out;
  }, [rails, hiddenKeys]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
    void queryClient.invalidateQueries({ queryKey: ['recommendations-feed'] });
  };

  // Full-bleed sections cancel the shell's own padding (see globals.css
  // --main-pad-x) so feed media and the hero truly touch the viewport edges.
  const fullBleed = '[margin-inline:calc(-1*var(--main-pad-x))]';

  return (
    <div className="animate-content-in pb-12">
      {/* Sticky glass mode switcher — same page-toolbar convention as the
          library pages, so the chips stay reachable mid-feed. */}
      <div className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {availableModes.map(({ id, label, icon: Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-label={label}
                aria-pressed={active}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${active
                  ? 'border border-primary/40 bg-primary/20 text-primary'
                  : 'bg-accent/40 text-muted-foreground'
                  }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
          {mode !== 'random' && (
            <div className="ml-auto shrink-0 pl-1.5">
              <Button
                size="icon-sm"
                variant="outline"
                onClick={refresh}
                disabled={railsQuery.isFetching}
                aria-label="Refresh recommendations"
              >
                {railsQuery.isFetching
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-4">
        {mode === 'random' ? (
          <RandomWatchView />
        ) : mode === 'feed' ? (
          <div className={fullBleed}>
            <RecFeed tracker={tracker} />
          </div>
        ) : railsQuery.isLoading ? (
          <RailsSkeleton fullBleed={fullBleed} />
        ) : railsQuery.isError ? (
          <div className="py-24 text-center text-sm text-red-400">
            Failed to load recommendations. Try refreshing.
          </div>
        ) : rails.length === 0 ? (
          <div className="space-y-1 py-24 text-center text-muted-foreground">
            <Popcorn className="mx-auto h-10 w-10 opacity-50" />
            <p className="text-sm">Not enough signal yet.</p>
            <p className="text-xs">
              Watch a few things in Jellyfin (or link AniList) and recommendations will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {heroItems.length > 0 && (
              <HeroCarousel
                className={`${fullBleed} h-[280px] md:h-[380px]`}
                slides={heroItems.map(({ item, railTitle }, i) => (
                  <HeroSlide key={item.itemKey} item={item} railTitle={railTitle} priority={i === 0} tracker={tracker} />
                ))}
              />
            )}
            <div className={`${fullBleed} space-y-6`}>
              {rails.map((rail) => (
                <RecRail
                  key={rail.id}
                  rail={rail}
                  tracker={tracker}
                  hiddenKeys={hiddenKeys}
                  onNotInterested={onNotInterested}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecommendationsPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center text-muted-foreground"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>}>
      <RecommendationsPageInner />
    </Suspense>
  );
}
