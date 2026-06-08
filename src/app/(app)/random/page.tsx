'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Clock, Dices, Film, Loader2, RefreshCw, Star, Tv } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

type FilterType = 'any' | 'movie' | 'series';

interface RandomPick {
  mediaType: 'movie' | 'series';
  id: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  runtime: number | null;
  genres: string[];
  href: string;
  rating: number | null;
}

export default function RandomWatchPage() {
  const [type, setType] = useState<FilterType>('any');
  const [pick, setPick] = useState<RandomPick | null>(null);
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id — if the user clicks "Pick another" while the
  // previous request is still in flight, drop the stale response so it
  // can't overwrite the newer one.
  const requestIdRef = useRef(0);

  const roll = useCallback(
    async (next: FilterType) => {
      const localId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/random-watch?type=${next}`);
        if (localId !== requestIdRef.current) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { pick: RandomPick | null; poolSize: number };
        if (localId !== requestIdRef.current) return;
        setPick(data.pick);
        setPoolSize(data.poolSize);
      } catch (err) {
        if (localId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch a pick');
      } finally {
        if (localId === requestIdRef.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void roll(type);
  }, [type, roll]);

  const poster = pick?.posterUrl
    ? toCachedImageSrc(pick.posterUrl, pick.mediaType === 'movie' ? 'radarr' : 'sonarr') ?? pick.posterUrl
    : null;
  const backdrop = pick?.backdropUrl
    ? toCachedImageSrc(pick.backdropUrl, pick.mediaType === 'movie' ? 'radarr' : 'sonarr') ?? pick.backdropUrl
    : null;

  return (
    <div className="animate-content-in pb-12">
      <div className="px-2 md:px-6 mt-2 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['any', 'movie', 'series'] as FilterType[]).map((t) => {
            const active = type === t;
            const label = t === 'any' ? 'All' : t === 'movie' ? 'Movies' : 'Series';
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? 'border border-primary/40 bg-primary/20 text-primary'
                    : 'bg-accent/40 text-muted-foreground'
                }`}
              >
                {t === 'movie' && <Film className="h-3.5 w-3.5" />}
                {t === 'series' && <Tv className="h-3.5 w-3.5" />}
                {t === 'any' && <Dices className="h-3.5 w-3.5" />}
                {label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            {poolSize !== null && (
              <span className="rounded-full bg-accent/40 px-2.5 py-1 text-[11px] text-muted-foreground">
                Pool: {poolSize}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => roll(type)}
              disabled={loading}
              variant="outline"
            >
              {loading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Pick another
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
            <p className="text-sm">Nothing downloaded matches this filter.</p>
            <p className="text-xs">
              Configure Sonarr/Radarr in Settings and download a few items first.
            </p>
          </div>
        ) : (
          <div className="relative -mx-2 overflow-hidden md:-mx-6 md:rounded-2xl">
            <div className="relative h-[200px] w-full bg-muted sm:h-[260px] md:h-[320px]">
              {backdrop ? (
                <>
                  <Image
                    src={backdrop}
                    alt=""
                    fill
                    sizes="100vw"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(backdrop)}
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-background/50 to-transparent" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-card via-background to-card" />
              )}
            </div>

            <div className="relative -mt-20 flex flex-col gap-4 px-3 md:-mt-28 md:flex-row md:gap-6 md:px-6">
              <div className="relative mx-auto aspect-[2/3] w-[120px] shrink-0 overflow-hidden rounded-xl bg-muted shadow-[0_20px_50px_-15px_rgba(0,0,0,0.7)] ring-1 ring-border md:mx-0 md:w-[180px]">
                {poster ? (
                  <Image
                    src={poster}
                    alt={pick.title}
                    fill
                    sizes="(max-width: 768px) 120px, 180px"
                    className="object-cover"
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

              <div className="space-y-3 md:pt-24">
                <div>
                  <h1 className="text-2xl font-semibold leading-tight">{pick.title}</h1>
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
    </div>
  );
}
