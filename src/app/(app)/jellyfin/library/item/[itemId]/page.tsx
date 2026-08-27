'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Heart, ListPlus, Play, RotateCcw, Shuffle } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { jellyfinBackdropUrl, jellyfinImageUrl, jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';
import { FadeInImage } from '@/components/media/fade-in-image';

export default function JellyfinItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const playback = useJellyfinPlayback();
  const query = useQuery({
    queryKey: queryKeys.jellyfinItem(itemId, 'full'),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(`/api/jellyfin/catalog/items/${itemId}?expand=seasons,episodes,similar,specials,segments,instantMix,theme,children,filmography,trailers`),
  });

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load this title." onRetry={() => void query.refetch()} />;
  const item = query.data?.item;
  if (!item) return <ErrorState message="This title isn't in your Jellyfin library." />;

  const backdrop = jellyfinBackdropUrl(item);
  const poster = jellyfinPosterUrl(item, 480);
  const runtime = formatClock(ticksToSeconds(item.RunTimeTicks));
  const canResume = Boolean(item.UserData?.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0);
  const people = item.People ?? [];
  const trailers = item.RemoteTrailers ?? [];

  return (
    <div className="pb-28">
      <div className="relative min-h-[18rem] overflow-hidden">
        {backdrop && <FadeInImage src={backdrop} alt="" fill sizes="100vw" unoptimized className="object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
        <div className="relative z-10 space-y-4 p-4 pt-6">
          <WatchSubNav />
          <div className="flex gap-4">
            {poster && (
              <div className="relative hidden aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg sm:block">
                <FadeInImage src={poster} alt="" fill sizes="128px" unoptimized className="object-cover" />
              </div>
            )}
            <div className="min-w-0 space-y-3">
              <h1 className="text-2xl font-semibold tracking-tight">{item.Name}</h1>
              <p className="text-sm text-muted-foreground">
                {[item.ProductionYear, item.OfficialRating, runtime !== '0:00' ? runtime : null, item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null, item.Genres?.slice(0, 3).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {item.Taglines?.[0] && <p className="text-sm italic text-muted-foreground">{item.Taglines[0]}</p>}
              {item.Overview && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{item.Overview}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void playback.playItem(item)}>
                  <Play className="fill-current" data-icon="inline-start" />
                  {canResume ? `Resume · ${formatClock(ticksToSeconds(item.UserData?.PlaybackPositionTicks))}` : 'Play'}
                </Button>
                {canResume && (
                  <Button variant="outline" onClick={() => void playback.playItem(item, { startTimeTicks: 0 })}>
                    <RotateCcw data-icon="inline-start" />
                    From start
                  </Button>
                )}
                <Button variant="outline" onClick={() => playback.addToQueue([item])}>
                  <ListPlus data-icon="inline-start" />
                  Queue
                </Button>
                <Button variant="outline" onClick={() => void playback.playItem(item, { shuffle: true })}>
                  <Shuffle data-icon="inline-start" />
                  Shuffle
                </Button>
                <FavoriteButton itemId={item.Id} favorite={Boolean(item.UserData?.IsFavorite)} />
                <WatchedButton
                  itemId={item.Id}
                  played={Boolean(item.UserData?.Played)}
                  seriesId={item.SeriesId}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-4">
        {query.data?.seasons && query.data.seasons.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Seasons</h2>
            <div className="flex flex-wrap gap-3">
              {query.data.seasons.map((season) => (
                <CatalogPosterCard key={season.Id} item={season} onPlay={(next) => void playback.playItem(next)} />
              ))}
            </div>
          </section>
        )}
        {query.data?.episodes && query.data.episodes.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Episodes</h2>
            <div className="flex flex-col gap-2">
              {query.data.episodes.map((episode) => (
                <button
                  key={episode.Id}
                  type="button"
                  onClick={() => void playback.playItem(episode)}
                  className="flex items-center gap-3 rounded-lg border bg-card p-2 text-left hover:bg-accent"
                >
                  <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded bg-muted">
                    {jellyfinPosterUrl(episode, 240) && (
                      <FadeInImage src={jellyfinPosterUrl(episode, 240)!} alt="" fill sizes="112px" unoptimized className="object-cover" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {episode.IndexNumber != null ? `${episode.IndexNumber}. ` : ''}{episode.Name}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{episode.Overview}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
        {query.data?.children && query.data.children.length > 0 && (
          <CatalogRail
            title={item.Type === 'MusicAlbum' ? 'Tracks' : 'Titles'}
            items={query.data.children}
            onPlay={(next) => void playback.playItems(query.data!.children!, query.data!.children!.findIndex((candidate) => candidate.Id === next.Id))}
          />
        )}
        {query.data?.specialFeatures && query.data.specialFeatures.length > 0 && (
          <CatalogRail title="Special features" items={query.data.specialFeatures} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.localTrailers && query.data.localTrailers.length > 0 && (
          <CatalogRail title="Trailers" items={query.data.localTrailers} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.themeMedia?.themeVideos && query.data.themeMedia.themeVideos.length > 0 && (
          <CatalogRail title="Theme videos" items={query.data.themeMedia.themeVideos} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.instantMix && query.data.instantMix.length > 0 && (
          <CatalogRail
            title="Instant mix"
            items={query.data.instantMix}
            onPlay={(next) => void playback.playItems(query.data!.instantMix!, query.data!.instantMix!.findIndex((candidate) => candidate.Id === next.Id))}
          />
        )}
        {query.data?.filmography && query.data.filmography.length > 0 && (
          <CatalogRail title="Filmography" items={query.data.filmography} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.similar && query.data.similar.length > 0 && (
          <CatalogRail title="More like this" items={query.data.similar} onPlay={(next) => void playback.playItem(next)} />
        )}
        {people.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Cast & crew</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
              {people.slice(0, 20).map((person) => (
                person.Id ? (
                  <Link key={`${person.Id}-${person.Role}`} href={`/jellyfin/library/item/${person.Id}`} className="w-24 shrink-0">
                    <div className="relative aspect-square overflow-hidden rounded-full bg-muted">
                      {jellyfinImageUrl(person.Id, 'Primary', 160) && (
                        <FadeInImage src={jellyfinImageUrl(person.Id, 'Primary', 160)!} alt="" fill sizes="96px" unoptimized className="object-cover" />
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs font-medium">{person.Name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{person.Role || person.Type}</p>
                  </Link>
                ) : null
              ))}
            </div>
          </section>
        )}
        {trailers.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Trailers</h2>
            <ul className="space-y-1 text-sm">
              {trailers.map((trailer) => (
                trailer.Url ? (
                  <li key={trailer.Url}>
                    <a href={trailer.Url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {trailer.Name || 'Trailer'}
                    </a>
                  </li>
                ) : null
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function FavoriteButton({ itemId, favorite }: { itemId: string; favorite: boolean }) {
  const queryClient = useQueryClient();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        await fetch('/api/jellyfin/catalog/favorite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId, favorite: !favorite }),
        });
        await queryClient.invalidateQueries({ queryKey: ['jellyfin', 'catalog'] });
      }}
    >
      <Heart className={favorite ? 'fill-current' : undefined} data-icon="inline-start" />
      {favorite ? 'Favorited' : 'Favorite'}
    </Button>
  );
}

function WatchedButton({ itemId, played, seriesId }: { itemId: string; played: boolean; seriesId?: string }) {
  const queryClient = useQueryClient();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        await fetch('/api/jellyfin/watch-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jellyfinItemId: itemId, played: !played, seriesId }),
        });
        await queryClient.invalidateQueries({ queryKey: ['jellyfin', 'catalog'] });
      }}
    >
      <Check data-icon="inline-start" />
      {played ? 'Watched' : 'Mark watched'}
    </Button>
  );
}
