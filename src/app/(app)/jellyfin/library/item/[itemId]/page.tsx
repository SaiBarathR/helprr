'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Heart, ListPlus, Play, RotateCcw, Shuffle, User } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import {
  jellyfinBackdropUrl,
  jellyfinCardImage,
  jellyfinImageUrl,
  jellyfinPersonImageUrl,
} from '@/lib/jellyfin-playback/image';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import { formatCertificate, formatCommunityRating } from '@/lib/jellyfin-playback/metadata';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';
import type { JellyfinMediaStream } from '@/types/jellyfin';
import { FadeInImage } from '@/components/media/fade-in-image';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';

/** Clock time the title would finish if started now — the reference shows this. */
function endsAt(remainingSeconds: number): string | null {
  if (remainingSeconds <= 0) return null;
  const done = new Date(Date.now() + remainingSeconds * 1000);
  return `Ends at ${done.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function streamLabel(stream: JellyfinMediaStream): string {
  return stream.DisplayTitle || stream.Language || `Track ${stream.Index}`;
}

export default function JellyfinItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const playback = useJellyfinPlayback();
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  const query = useQuery({
    queryKey: queryKeys.jellyfinItem(itemId, 'full'),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(`/api/jellyfin/catalog/items/${itemId}?expand=seasons,episodes,similar,specials,segments,instantMix,theme,children,filmography,trailers`),
  });

  const item = query.data?.item;
  const streams = useMemo(() => item?.MediaStreams ?? [], [item]);
  const audioStreams = useMemo(() => streams.filter((s) => s.Type === 'Audio'), [streams]);
  const subtitleStreams = useMemo(() => streams.filter((s) => s.Type === 'Subtitle'), [streams]);
  const videoStream = useMemo(() => streams.find((s) => s.Type === 'Video'), [streams]);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load this title." onRetry={() => void query.refetch()} />;
  if (!item) return <ErrorState message="This title isn't in your Jellyfin library." />;

  const backdrop = jellyfinBackdropUrl(item);
  const logo = item.ImageTags?.Logo ? jellyfinImageUrl(item.Id, 'Logo', 720) : null;
  const runtimeSeconds = ticksToSeconds(item.RunTimeTicks);
  const resumeSeconds = ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  const canResume = resumeSeconds > 0;
  const certificate = formatCertificate(item.OfficialRating);
  const rating = formatCommunityRating(item.CommunityRating);
  const finishes = endsAt(runtimeSeconds - resumeSeconds);
  const people = item.People ?? [];
  const trailers = item.RemoteTrailers ?? [];
  const trackOptions = { audioStreamIndex: audioIndex, subtitleStreamIndex: subtitleIndex };

  const directors = people.filter((p) => p.Type === 'Director').map((p) => p.Name).filter(Boolean);
  const writers = people.filter((p) => p.Type === 'Writer').map((p) => p.Name).filter(Boolean);
  const info: Array<[string, string]> = [
    ['Genres', (item.Genres ?? []).join(', ')],
    ['Director', directors.join(', ')],
    ['Writers', writers.join(', ')],
    ['Studios', (item.Studios ?? []).map((s) => s.Name).filter(Boolean).join(', ')],
  ];

  return (
    <div className="pb-28">
      <section className="relative -mx-4 -mt-4 flex min-h-[68vh] flex-col overflow-hidden md:-mx-6 md:-mt-6">
        {backdrop && (
          <FadeInImage src={backdrop} alt="" fill sizes="100vw" priority unoptimized className="object-cover" />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-background from-28% via-background/80 via-58% to-transparent" />

        <div className="relative z-10 flex flex-1 flex-col items-center justify-end gap-3 p-4 pb-6 text-center md:p-6">
          <div className="absolute top-4 left-4 md:top-6 md:left-6">
            <WatchSubNav />
          </div>

          <HeroTitle
            name={item.Name}
            logoUrl={logo}
            align="center"
            frameClassName="mt-16 h-20 w-64 md:h-28 md:w-96"
            textClassName="mt-16 text-3xl font-semibold tracking-tight text-balance md:text-4xl"
          />

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {certificate && (
              <span className="rounded border border-current px-1.5 py-px text-[11px] font-medium tracking-wide">
                {certificate}
              </span>
            )}
            {item.ProductionYear && <span>{item.ProductionYear}</span>}
            {runtimeSeconds > 0 && <span>{formatClock(runtimeSeconds)}</span>}
            {rating && <span className="font-medium text-foreground">{rating}</span>}
            {typeof item.CriticRating === 'number' && item.CriticRating > 0 && (
              <span className="rounded-full bg-[var(--hpr-rose)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--hpr-rose)]">
                Critics {Math.round(item.CriticRating)}%
              </span>
            )}
            {(item.Genres ?? []).length > 0 && <span>{item.Genres!.slice(0, 3).join(' · ')}</span>}
            {finishes && <span>{finishes}</span>}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button size="lg" className="rounded-full px-6" onClick={() => void playback.playItem(item, trackOptions)}>
              <Play className="fill-current" data-icon="inline-start" />
              {canResume ? `Resume · ${formatClock(resumeSeconds)}` : 'Play'}
            </Button>
            {canResume && (
              <Button
                size="icon-lg"
                variant="secondary"
                className="rounded-full"
                aria-label="Play from start"
                title="Play from start"
                onClick={() => void playback.playItem(item, { ...trackOptions, startTimeTicks: 0 })}
              >
                <RotateCcw />
              </Button>
            )}
            <Button size="icon-lg" variant="secondary" className="rounded-full" aria-label="Add to queue" title="Add to queue" onClick={() => playback.addToQueue([item])}>
              <ListPlus />
            </Button>
            {item.IsFolder && (
              <Button
                size="icon-lg"
                variant="secondary"
                className="rounded-full"
                aria-label="Shuffle"
                title="Shuffle"
                onClick={() => void playback.playItem(item, { ...trackOptions, shuffle: true })}
              >
                <Shuffle />
              </Button>
            )}
            <FavoriteButton itemId={item.Id} favorite={Boolean(item.UserData?.IsFavorite)} />
            <WatchedButton itemId={item.Id} played={Boolean(item.UserData?.Played)} seriesId={item.SeriesId} />
          </div>

          {item.Taglines?.[0] && <p className="text-sm italic text-muted-foreground">{item.Taglines[0]}</p>}
          {item.Overview && (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{item.Overview}</p>
          )}
        </div>
      </section>

      <div className="space-y-6 p-4 md:p-6">
        {(info.some(([, value]) => value) || videoStream || audioStreams.length > 0) && (
          <div className="grid gap-3 md:grid-cols-2">
            <dl className="divide-y divide-border overflow-hidden rounded-xl border bg-card/60">
              {info.filter(([, value]) => value).map(([label, value]) => (
                <div key={label} className="flex gap-3 p-3 text-sm">
                  <dt className="w-24 shrink-0 font-medium">{label}</dt>
                  <dd className="min-w-0 flex-1 text-right text-muted-foreground">{value}</dd>
                </div>
              ))}
            </dl>

            {(videoStream || audioStreams.length > 0) && (
            <div className="space-y-2 rounded-xl border bg-card/60 p-3">
              {videoStream && (
                <p className="text-sm font-medium">
                  {[
                    videoStream.Height ? `${videoStream.Height}p` : null,
                    videoStream.Codec?.toUpperCase(),
                    videoStream.VideoRange && videoStream.VideoRange !== 'SDR' ? videoStream.VideoRange : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {audioStreams.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Audio
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                    value={audioIndex ?? ''}
                    onChange={(event) => setAudioIndex(event.target.value === '' ? null : Number(event.target.value))}
                  >
                    <option value="">Default</option>
                    {audioStreams.map((stream) => (
                      <option key={stream.Index} value={stream.Index}>{streamLabel(stream)}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Subtitles
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                  value={subtitleIndex ?? ''}
                  onChange={(event) => setSubtitleIndex(event.target.value === '' ? null : Number(event.target.value))}
                >
                  <option value="">Default</option>
                  <option value={-1}>Off</option>
                  {subtitleStreams.map((stream) => (
                    <option key={stream.Index} value={stream.Index}>{streamLabel(stream)}</option>
                  ))}
                </select>
              </label>
            </div>
            )}
          </div>
        )}

        {query.data?.seasons && query.data.seasons.length > 0 && (
          <CatalogRail title="Seasons" items={query.data.seasons} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.episodes && query.data.episodes.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Episodes</h2>
            <div className="flex flex-col gap-2">
              {query.data.episodes.map((episode) => {
                const still = jellyfinCardImage(episode, 320, 'landscape');
                const progress = episode.UserData?.PlayedPercentage;
                return (
                  <button
                    key={episode.Id}
                    type="button"
                    onClick={() => void playback.playItem(episode)}
                    className="flex items-center gap-3 rounded-xl border bg-card/60 p-2 text-left transition-colors hover:bg-accent"
                  >
                    <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {still && (
                        <FadeInImage src={still} alt="" fill sizes="128px" unoptimized className="object-cover" />
                      )}
                      {typeof progress === 'number' && progress > 0 && progress < 100 && (
                        <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                          <span className="block h-full bg-[var(--hpr-amber)]" style={{ width: `${progress}%` }} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {episode.IndexNumber != null ? `${episode.IndexNumber}. ` : ''}{episode.Name}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{episode.Overview}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {query.data?.children && query.data.children.length > 0 && (
          <CatalogRail
            title={item.Type === 'MusicAlbum' ? 'Tracks' : 'Titles'}
            shape={item.Type === 'MusicAlbum' ? 'square' : 'portrait'}
            items={query.data.children}
            onPlay={(next) => void playback.playItems(query.data!.children!, query.data!.children!.findIndex((candidate) => candidate.Id === next.Id))}
          />
        )}
        {query.data?.specialFeatures && query.data.specialFeatures.length > 0 && (
          <CatalogRail title="Special features" shape="landscape" items={query.data.specialFeatures} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.localTrailers && query.data.localTrailers.length > 0 && (
          <CatalogRail title="Trailers" shape="landscape" items={query.data.localTrailers} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.themeMedia?.themeVideos && query.data.themeMedia.themeVideos.length > 0 && (
          <CatalogRail title="Theme videos" shape="landscape" items={query.data.themeMedia.themeVideos} onPlay={(next) => void playback.playItem(next)} />
        )}
        {query.data?.instantMix && query.data.instantMix.length > 0 && (
          <CatalogRail
            title="Instant mix"
            shape="square"
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
            <h2 className="text-base font-semibold">Cast &amp; crew</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:-mx-6 md:px-6">
              {people.slice(0, 20).map((person) => (
                person.Id ? (
                  <Link key={`${person.Id}-${person.Role}`} href={`/jellyfin/library/item/${person.Id}`} className="w-24 shrink-0 text-center">
                    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-full bg-muted">
                      {jellyfinPersonImageUrl(person, 160)
                        ? <FadeInImage src={jellyfinPersonImageUrl(person, 160)!} alt={person.Name ?? ''} fill sizes="96px" unoptimized className="object-cover" />
                        : <User className="size-5 text-muted-foreground" />}
                    </div>
                    <p className="mt-1.5 truncate text-xs font-medium">{person.Name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {person.Role ? `as ${person.Role}` : person.Type}
                    </p>
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
      size="icon-lg"
      variant="secondary"
      className="rounded-full"
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      title={favorite ? 'Favorited' : 'Favorite'}
      onClick={async () => {
        await fetch('/api/jellyfin/catalog/favorite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId, favorite: !favorite }),
        });
        await queryClient.invalidateQueries({ queryKey: ['jellyfin', 'catalog'] });
      }}
    >
      <Heart className={favorite ? 'fill-current text-[var(--hpr-rose)]' : undefined} />
    </Button>
  );
}

function WatchedButton({ itemId, played, seriesId }: { itemId: string; played: boolean; seriesId?: string }) {
  const queryClient = useQueryClient();
  return (
    <Button
      size="icon-lg"
      variant="secondary"
      className="rounded-full"
      aria-label={played ? 'Mark unwatched' : 'Mark watched'}
      title={played ? 'Watched' : 'Mark watched'}
      onClick={async () => {
        await fetch('/api/jellyfin/watch-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jellyfinItemId: itemId, played: !played, seriesId }),
        });
        await queryClient.invalidateQueries({ queryKey: ['jellyfin', 'catalog'] });
      }}
    >
      <Check className={played ? 'text-[var(--hpr-green)]' : undefined} strokeWidth={played ? 3 : 2} />
    </Button>
  );
}
