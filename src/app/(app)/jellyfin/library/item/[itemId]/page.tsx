'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Film, HardDrive, Heart, ListPlus, Play, Plus, RotateCcw, Shuffle, User } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { MediaRail } from '@/components/jellyfin-streaming/media-rail';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import {
  jellyfinBackdropUrl,
  jellyfinCardImage,
  jellyfinImageUrl,
  jellyfinPersonImageUrl,
} from '@/lib/jellyfin-playback/image';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import { formatBytes } from '@/lib/format';
import { formatCertificate, formatCommunityRating, formatRuntimeShort } from '@/lib/jellyfin-playback/metadata';
import type { CatalogItemDetailResponse, CatalogItemsResponse } from '@/types/jellyfin-streaming';
import type { JellyfinMediaStream } from '@/types/jellyfin';
import { FadeInImage } from '@/components/media/fade-in-image';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
import { CatalogTrailerRail } from '@/components/jellyfin-streaming/catalog-trailer-rail';
import { CatalogElsewhere } from '@/components/jellyfin-streaming/catalog-elsewhere';
import { CatalogRatingsStrip } from '@/components/jellyfin-streaming/catalog-ratings-strip';
import { PreviewBackdrop } from '@/components/jellyfin-streaming/cinematic/preview-backdrop';
import { MobileDetailTabs } from '@/components/jellyfin-streaming/cinematic/mobile-detail-tabs';
import { mediaBadges } from '@/lib/jellyfin-playback/media-badges';
import { usePreviewSource } from '@/components/jellyfin-streaming/cinematic/use-preview-item';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { cn } from '@/lib/utils';

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
  const skin = useWatchSkin();
  const cinematic = skin === 'cinematic';
  const compact = useCompactViewport();
  // The app's phone detail screen is not a scaled-down billboard: a 16:9 still
  // sits on top and everything else flows beneath it.
  const stacked = cinematic && compact;
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  const query = useQuery({
    queryKey: queryKeys.jellyfinItem(itemId, 'full'),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(`/api/jellyfin/catalog/items/${itemId}?expand=seasons,episodes,similar,specials,segments,instantMix,theme,children,filmography,trailers`),
  });

  const item = query.data?.item;

  // ?play=1 lets other pages hand off straight into playback.
  const searchParams = useSearchParams();
  const autoPlayRequested = searchParams.get('play') === '1';
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (!autoPlayRequested || autoPlayedRef.current) return;
    const target = query.data?.item;
    if (!target || target.IsFolder) return;
    autoPlayedRef.current = true;
    void playback.playItem(target);
  }, [autoPlayRequested, playback, query.data?.item]);

  /**
   * Open at the top, every time.
   *
   * The page mounts as a spinner barely taller than the viewport and then grows
   * by a few thousand pixels once the payload lands. A pending scroll position
   * is resolved against whichever height the browser happens to see first, so
   * arriving here from a scrolled rail could leave the hero already part-way
   * off the top — which is the "opens somewhere in the middle" the owner sees.
   *
   * Reset when the route changes, and once more when the content that changes
   * the height has actually rendered. After that the viewer's own scrolling is
   * never touched: `settled` latches per item id.
   */
  const scrollSettledRef = useRef<string | null>(null);
  useEffect(() => {
    if (scrollSettledRef.current === itemId) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (query.isSuccess) scrollSettledRef.current = itemId;
  }, [itemId, query.isSuccess]);

  // The reference series page leads its sections with Next Up.
  const nextUpQuery = useQuery({
    queryKey: ['jellyfin', 'catalog', 'next-up', itemId],
    // seriesId, not parentId: parentId filters by library, so a series id there
    // matches nothing and this rail was always empty.
    queryFn: jsonFetcher<CatalogItemsResponse>(`/api/jellyfin/catalog/next-up?seriesId=${encodeURIComponent(itemId)}`),
    enabled: query.data?.item?.Type === 'Series',
  });
  // A series has no media source of its own, so the clip is sampled from the
  // episode the viewer would land on rather than from the series id — which
  // could only ever have failed.
  const previewSource = usePreviewSource(item, cinematic);
  const streams = useMemo(() => item?.MediaStreams ?? [], [item]);
  const audioStreams = useMemo(() => streams.filter((s) => s.Type === 'Audio'), [streams]);
  const subtitleStreams = useMemo(() => streams.filter((s) => s.Type === 'Subtitle'), [streams]);
  const videoStream = useMemo(() => streams.find((s) => s.Type === 'Video'), [streams]);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load this title." onRetry={() => void query.refetch()} />;
  if (!item) return <ErrorState message="This title isn't in your Jellyfin library." />;

  // Season and episode pages lead with the *series* identity, as the reference
  // does: series logo and backdrop up top, the specific season or episode as a
  // subtitle beneath it.
  const isChildOfSeries = item.Type === 'Season' || item.Type === 'Episode';
  const seriesId = isChildOfSeries ? (item.SeriesId ?? item.ParentId) : undefined;
  const heroName = isChildOfSeries ? (item.SeriesName ?? item.Name) : item.Name;
  const heroSubtitle = item.Type === 'Season'
    ? item.Name
    : item.Type === 'Episode'
      ? [item.SeasonName ?? (item.ParentIndexNumber != null ? `Season ${item.ParentIndexNumber}` : null),
         item.IndexNumber != null ? `${item.IndexNumber}. ${item.Name}` : item.Name]
          .filter(Boolean).join(' · ')
      : item.OriginalTitle && item.OriginalTitle !== item.Name
        ? item.OriginalTitle
        : null;

  const backdrop = jellyfinBackdropUrl(item);
  // Borrow the series logo for a season or episode — they rarely have their own.
  const logoOwnerId = item.ImageTags?.Logo ? item.Id : (isChildOfSeries ? seriesId : undefined);
  const logo = item.ImageTags?.Logo
    ? jellyfinImageUrl(item.Id, 'Logo', 720)
    : logoOwnerId
      ? jellyfinImageUrl(logoOwnerId, 'Logo', 720)
      : null;
  const runtimeSeconds = ticksToSeconds(item.RunTimeTicks);
  /**
   * What Play acts on, and therefore what "resume" means here.
   *
   * A series carries no PlaybackPositionTicks of its own — progress lives on
   * its episodes — so reading the series' own UserData meant the button on a
   * half-watched show always said "Play" while the same show's episode page
   * said "Resume". The episode a viewer would land on is Jellyfin's Next Up,
   * which is also exactly what playItem(series) starts (see resolvePlayable),
   * so the label and the action cannot disagree.
   */
  const resumeTarget = item.Type === 'Series'
    ? (nextUpQuery.data?.items?.[0] ?? null)
    : item;
  const resumeSeconds = ticksToSeconds(resumeTarget?.UserData?.PlaybackPositionTicks);
  // A series' own RunTimeTicks is not a duration anything can be a fraction of.
  const resumeRuntimeSeconds = ticksToSeconds(resumeTarget?.RunTimeTicks) || runtimeSeconds;
  const canResume = resumeSeconds > 0;
  // `S1:E5`, when the thing being played is an episode of something.
  const resumeCue = resumeTarget?.Type === 'Episode'
    && resumeTarget.ParentIndexNumber != null
    && resumeTarget.IndexNumber != null
    ? `S${resumeTarget.ParentIndexNumber}:E${resumeTarget.IndexNumber}`
    : null;
  const playLabel = canResume
    ? (resumeCue ? `Resume ${resumeCue}` : `Resume · ${formatClock(resumeSeconds)}`)
    : resumeCue ? `Play ${resumeCue}` : 'Play';
  const certificate = formatCertificate(item.OfficialRating);
  const rating = formatCommunityRating(item.CommunityRating);
  const finishes = endsAt(resumeRuntimeSeconds - resumeSeconds);
  const people = item.People ?? [];
  const trailers = item.RemoteTrailers ?? [];
  const trackOptions = { audioStreamIndex: audioIndex, subtitleStreamIndex: subtitleIndex };

  const directors = people.filter((p) => p.Type === 'Director').map((p) => p.Name).filter(Boolean);
  const writers = people.filter((p) => p.Type === 'Writer').map((p) => p.Name).filter(Boolean);
  const actors = people.filter((p) => p.Type === 'Actor').map((p) => p.Name).filter(Boolean);
  // Netflix's phone meta row: season count for a series, then whatever the file
  // actually is. `HD` for everything above 700 lines meant a 4K HDR Atmos title
  // and a stereo 720p one advertised themselves identically.
  const seasonCount = item.Type === 'Series' ? (item.ChildCount ?? 0) : 0;
  const badges = mediaBadges(streams);
  // Both meta rows advertise the same capabilities; only the chrome around each
  // badge differs, because the phone row sits on artwork and the wide one sits
  // on the page, where a hardcoded white border would vanish in the light theme.
  const capabilityBadges = [badges.resolution, badges.dynamicRange, badges.audio, badges.subtitles ? 'CC' : null]
    .filter((badge): badge is string => Boolean(badge));
  const infoRows: Array<[string, string]> = ([
    ['Genres', (item.Genres ?? []).join(', ')],
    ['Director', directors.join(', ')],
    ['Writers', writers.join(', ')],
    ['Studios', (item.Studios ?? []).map((studio) => studio.Name).filter(Boolean).join(', ')],
    ['Released', item.PremiereDate ? new Date(item.PremiereDate).toLocaleDateString() : ''],
  ] as Array<[string, string]>).filter(([, value]) => value);

  // Jellyfin carries provider ids, which is the bridge to Helprr's own TMDB data.
  const providerTmdb = Number(item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb ?? NaN);
  const discoverTmdbId = Number.isFinite(providerTmdb) && providerTmdb > 0 ? providerTmdb : undefined;
  const discoverMediaType = item.Type === 'Movie' ? 'movie' as const : 'tv' as const;
  const supportsElsewhere = item.Type === 'Movie' || item.Type === 'Series';

  const isMusic = item.MediaType === 'Audio' || item.Type === 'MusicAlbum' || item.Type === 'MusicArtist';
  const source = item.MediaSources?.[0];
  const fileLine = [
    source?.Container?.toUpperCase(),
    typeof source?.Size === 'number' && source.Size > 0 ? formatBytes(source.Size) : null,
    typeof source?.Bitrate === 'number' && source.Bitrate > 0
      ? `${(source.Bitrate / 1_000_000).toFixed(1)} Mbps`
      : null,
  ].filter(Boolean).join(' · ');
  const hasMediaDetail = Boolean(videoStream) || audioStreams.length > 0 || subtitleStreams.length > 0 || Boolean(fileLine);

  return (
    <div className="pb-28">
      <section
        className={cn(
          'relative -mx-[var(--main-pad-x)] -mt-[var(--main-pad-top)] flex flex-col overflow-hidden',
          stacked ? 'min-h-0' : 'min-h-[68vh]',
        )}
      >
        {/* `relative` alongside `contents` is for next/image's dev-time check
            only: it reads the *DOM* parent's computed position, and a
            `display: contents` wrapper generates no box, so the fill backdrop
            below already resolves against the positioned section. Positioning
            is not applied to a box that does not exist, so layout is
            unchanged. */}
        <div className={cn('relative', stacked ? 'aspect-video w-full overflow-hidden' : 'contents')}>
        {stacked && resumeSeconds > 0 && resumeRuntimeSeconds > 0 && (
          // The app rules the foot of the hero video in brand red, showing how
          // far into the title you already are.
          <span className="absolute inset-x-0 bottom-0 z-20 h-[3px] bg-white/25">
            <span
              className="block h-full bg-[#e50914]"
              style={{ width: `${Math.min(100, (resumeSeconds / resumeRuntimeSeconds) * 100)}%` }}
            />
          </span>
        )}
        <PreviewBackdrop
          backdropUrl={backdrop}
          itemId={previewSource.itemId}
          runtimeTicks={previewSource.runtimeTicks}
          trailerUrl={trailers[0]?.Url}
          // Autoplay is a cinematic-skin behaviour; classic stays still art.
          enabled={skin === 'cinematic'}
          priority
          // Bottom of the hero, not the top: the top row belongs to the
          // section nav and the Exit link, and the toggle collided with them.
          controlsClassName="absolute right-4 bottom-4 md:right-6 md:bottom-6"
        />
        {/* Cinematic uses the site's left-to-right ramp so the copy column
            always has a dark ground, whatever the artwork happens to be.
            Classic keeps the centred bottom fade it was designed around. */}
        {cinematic ? (
          stacked ? (
            // A phone writes nothing over the still — the title, the meta row
            // and the synopsis all sit *below* it — so the left-to-right ramp
            // the desktop hero needs has nothing to protect here and simply
            // buries the left of the picture under 75% black. Only the bottom
            // edge needs softening, where the still meets the page, plus a
            // light top vignette to hold the back arrow.
            <>
              <span className="absolute inset-0 bg-gradient-to-t from-black from-0% via-black/20 via-25% to-transparent to-55%" />
              <span className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/50 to-transparent" />
            </>
          ) : (
          <>
            <span className="absolute inset-0 bg-gradient-to-r from-black from-5% via-black/75 via-45% to-transparent to-80%" />
            <span className="absolute inset-0 bg-gradient-to-t from-black from-2% via-black/45 via-40% to-transparent to-75%" />
          </>
          )
        ) : (
          <span className="absolute inset-0 bg-gradient-to-t from-background from-28% via-background/80 via-58% to-transparent" />
        )}
        </div>

        <div
          className={cn(
            'relative z-10 flex flex-col gap-3 p-[var(--main-pad-x)] pb-6',
            stacked ? 'pt-4' : 'flex-1 justify-end',
            cinematic ? 'items-start text-left' : 'items-center text-center',
          )}
        >
          <div className="absolute inset-x-4 top-4 md:inset-x-6 md:top-6">
            <WatchTopBar />
          </div>

          <HeroTitle
            name={heroName}
            // The app sets the title in plain type on its phone detail screen;
            // a logo treatment only appears over the desktop billboard.
            logoUrl={stacked ? null : logo}
            align={cinematic ? 'left' : 'center'}
            frameClassName={cn('h-20 w-64 md:h-28 md:w-96', stacked ? 'mt-0' : 'mt-16')}
            textClassName={cn(
              'tracking-tight text-balance',
              stacked ? 'mt-0 text-[28px] font-bold' : 'mt-16',
              cinematic && !stacked ? 'text-4xl font-bold md:text-5xl' : '',
              !cinematic ? 'text-3xl font-semibold md:text-4xl' : '',
            )}
          />

          {heroSubtitle && (
            <p className="text-sm font-medium text-foreground/90">
              {seriesId ? (
                <Link href={`/jellyfin/library/item/${seriesId}`} className="text-muted-foreground hover:text-foreground">
                  {heroName}
                </Link>
              ) : null}
              {seriesId ? <span className="text-muted-foreground"> · </span> : null}
              {heroSubtitle}
            </p>
          )}

          {stacked ? (
            // The app's phone meta row is release year, a filled maturity box,
            // the season count (a series never shows an episode runtime here),
            // then HD and CC. No star rating, no critics score, no genre list
            // and no "Ends at" — none of that appears on a streaming detail
            // screen, and the genres already run under the synopsis.
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-[#b3b3b3]">
              {item.Type === 'Episode' && item.PremiereDate
                ? <span>{new Date(item.PremiereDate).getFullYear()}</span>
                : item.ProductionYear ? <span>{item.ProductionYear}</span> : null}
              {certificate && (
                <span className="bg-[#3a3a3a] px-1.5 py-px text-[12px] text-white">{certificate}</span>
              )}
              {seasonCount > 0
                ? <span>{seasonCount} Season{seasonCount === 1 ? '' : 's'}</span>
                : runtimeSeconds > 0 ? <span>{formatRuntimeShort(runtimeSeconds)}</span> : null}
              {capabilityBadges.map((badge) => (
                <span
                  key={badge}
                  className="border border-white/40 px-1 text-[10px] tracking-wide text-white/90"
                >
                  {badge}
                </span>
              ))}
            </div>
          ) : (
            <div
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground',
                cinematic ? 'justify-start' : 'justify-center',
              )}
            >
              {certificate && (
                <span className="rounded border border-current px-1.5 py-px text-[11px] font-medium tracking-wide">
                  {certificate}
                </span>
              )}
              {item.Type === 'Episode' && item.PremiereDate
                ? <span>{new Date(item.PremiereDate).toLocaleDateString()}</span>
                : item.ProductionYear ? <span>{item.ProductionYear}</span> : null}
              {runtimeSeconds > 0 && <span>{formatClock(runtimeSeconds)}</span>}
              {/* Next to the runtime rather than at the end of the row: these
                  and the duration are the only facts here about the file
                  itself, and after "Ends at" they read as an afterthought. */}
              {capabilityBadges.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {capabilityBadges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded border border-current px-1.5 py-px text-[11px] font-medium tracking-wide"
                    >
                      {badge}
                    </span>
                  ))}
                </span>
              )}
              {rating && <span className="font-medium text-foreground">{rating}</span>}
              {typeof item.CriticRating === 'number' && item.CriticRating > 0 && (
                <span className="rounded-full bg-[var(--hpr-rose)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--hpr-rose)]">
                  Critics {Math.round(item.CriticRating)}%
                </span>
              )}
              {(item.Genres ?? []).length > 0 && <span>{item.Genres!.slice(0, 3).join(' · ')}</span>}
              {finishes && <span>{finishes}</span>}
            </div>
          )}

          {supportsElsewhere && !stacked && (
            <CatalogRatingsStrip tmdbId={discoverTmdbId} mediaType={discoverMediaType} />
          )}

          <div
            className={cn(
              'flex flex-wrap items-center gap-2 pt-1',
              stacked && 'w-full',
              cinematic ? 'justify-start' : 'justify-center',
            )}
          >
            <Button
              size="lg"
              // `flex-1` rather than `w-full` on a phone: at full width this
              // took the whole row and pushed Play-from-start onto a line of
              // its own, where a lone round button sat left-aligned against
              // nothing. Flexing leaves room for it beside the label, and
              // still fills the row on a title that has no resume point.
              className={cn('rounded-full px-6', stacked && 'flex-1 rounded')}
              onClick={() => void playback.playItem(item, trackOptions)}
            >
              <Play className="fill-current" data-icon="inline-start" />
              {playLabel}
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
            {!stacked && (
              <Button size="icon-lg" variant="secondary" className="rounded-full" aria-label="Add to queue" title="Add to queue" onClick={() => playback.addToQueue([item])}>
                <ListPlus />
              </Button>
            )}
            {!stacked && item.IsFolder && (
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
            {!stacked && <FavoriteButton itemId={item.Id} favorite={Boolean(item.UserData?.IsFavorite)} />}
            {!stacked && <WatchedButton itemId={item.Id} played={Boolean(item.UserData?.Played)} seriesId={item.SeriesId} />}
          </div>

          {/* The app spreads its phone actions as icon-above-label columns, not
              a row of bare circles — four unlabelled discs told you nothing
              about what any of them did. */}
          {stacked && (
            <div className="flex w-full items-start gap-8 pt-1">
              <FavoriteButton itemId={item.Id} favorite={Boolean(item.UserData?.IsFavorite)} stacked />
              <WatchedButton itemId={item.Id} played={Boolean(item.UserData?.Played)} seriesId={item.SeriesId} stacked />
              <StackedAction label="Queue" onClick={() => playback.addToQueue([item])}>
                <ListPlus className="size-6" />
              </StackedAction>
              {item.IsFolder && (
                <StackedAction
                  label="Shuffle"
                  onClick={() => void playback.playItem(item, { ...trackOptions, shuffle: true })}
                >
                  <Shuffle className="size-6" />
                </StackedAction>
              )}
            </div>
          )}

          {item.Taglines?.[0] && !stacked && (
            <p className="text-sm italic text-muted-foreground">{item.Taglines[0]}</p>
          )}
          {item.Overview && (
            <p
              className={cn(
                'leading-relaxed',
                // The site keeps its synopsis in a narrow column so it stays
                // inside the scrim rather than running out over bright art.
                cinematic
                  ? 'max-w-[36rem] text-base text-white/90'
                  : 'max-w-3xl text-sm text-muted-foreground',
                // Three lines on a phone, as the app clamps it — an unclamped
                // ten-line synopsis pushed the Episodes tab off the screen.
                stacked && 'line-clamp-3',
              )}
            >
              {item.Overview}
            </p>
          )}

          {/* The app follows the synopsis with cast and creator lines. */}
          {stacked && actors.length > 0 && (
            <p className="text-[13px] leading-snug text-[#777]">
              Starring:{' '}
              <span className="text-white/90">{actors.slice(0, 3).join(', ')}</span>
              {actors.length > 3 && <span className="text-white/90">… more</span>}
            </p>
          )}
          {stacked && (directors.length > 0 || writers.length > 0) && (
            <p className="text-[13px] leading-snug text-[#777]">
              {directors.length > 0 ? 'Director: ' : 'Creator: '}
              <span className="text-white/90">
                {(directors.length > 0 ? directors : writers).slice(0, 2).join(', ')}
              </span>
            </p>
          )}
        </div>
      </section>

      <div className="space-y-6 py-6">
        {/* On a phone these sit *after* the tab strip — the app has no equivalent
            of a spec table or a "where else to stream" card, and putting them
            where its action row and tabs belong was the loudest non-Netflix
            block on the screen. They stay reachable, just at the foot. */}
        {!stacked && (infoRows.length > 0 || hasMediaDetail) && (
          <div className="grid gap-3 md:grid-cols-2">
            {/* Both panels are omitted entirely when empty — an outlined box
                with nothing in it reads as a loading failure. */}
            {infoRows.length > 0 && (
              <dl className="divide-y divide-border overflow-hidden rounded-xl border bg-card/60">
                {infoRows.map(([label, value]) => (
                  <div key={label} className="flex gap-3 p-3 text-sm">
                    <dt className="w-24 shrink-0 font-medium">{label}</dt>
                    <dd className="min-w-0 flex-1 text-right text-muted-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {hasMediaDetail && (
              <div className="space-y-2 rounded-xl border bg-card/60 p-3">
                {videoStream && (
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Film className="size-4 shrink-0 text-muted-foreground" />
                    {[
                      videoStream.DisplayTitle
                        ?? [videoStream.Height ? `${videoStream.Height}p` : null, videoStream.Codec?.toUpperCase()]
                          .filter(Boolean).join(' '),
                      videoStream.AverageFrameRate
                        ? `${Math.round(videoStream.AverageFrameRate * 1000) / 1000} fps`
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
                {fileLine && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <HardDrive className="size-4 shrink-0" />
                    {fileLine}
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
                {subtitleStreams.length > 0 && (
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
                )}
              </div>
            )}
          </div>
        )}

        {supportsElsewhere && !stacked && (
          <CatalogElsewhere tmdbId={discoverTmdbId} mediaType={discoverMediaType} />
        )}

        {item.Type === 'Series' && (nextUpQuery.data?.items.length ?? 0) > 0 && (
          <CatalogRail
            title="Next up"
            shape="landscape"
            items={nextUpQuery.data!.items}
            onPlay={(next) => void playback.playItem(next)}
          />
        )}

        {stacked && (
          <MobileDetailTabs
            episodes={query.data?.episodes ?? []}
            seasons={query.data?.seasons ?? []}
            similar={query.data?.similar ?? []}
            currentSeasonId={item.Type === 'Season' ? item.Id : item.SeasonId}
            onPlay={(next) => void playback.playItem(next)}
          />
        )}

        {/* Helprr's own detail, kept below the tabs on a phone. */}
        {stacked && infoRows.length > 0 && (
          <dl className="divide-y divide-border overflow-hidden rounded-xl border bg-card/60">
            {infoRows.map(([label, value]) => (
              <div key={label} className="flex gap-3 p-3 text-sm">
                <dt className="w-24 shrink-0 font-medium">{label}</dt>
                <dd className="min-w-0 flex-1 text-right text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {stacked && supportsElsewhere && (
          <CatalogElsewhere tmdbId={discoverTmdbId} mediaType={discoverMediaType} />
        )}

        {!stacked && item.Type === 'Series' && query.data?.seasons && query.data.seasons.length > 0 && (
          <CatalogRail title="Seasons" items={query.data.seasons} onPlay={(next) => void playback.playItem(next)} />
        )}

        {/* Season picker on season and episode pages, so you can move sideways
            without going back up to the series. */}
        {!stacked && isChildOfSeries && (query.data?.seasons?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {query.data!.seasons!.map((season) => (
              <Link
                key={season.Id}
                href={`/jellyfin/library/item/${season.Id}`}
                aria-current={season.Id === (item.Type === 'Season' ? item.Id : item.SeasonId) ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  season.Id === (item.Type === 'Season' ? item.Id : item.SeasonId)
                    ? 'border-[var(--hpr-amber)] bg-[var(--hpr-amber)] text-[var(--hpr-ink)]'
                    : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
                )}
              >
                {season.Name}
              </Link>
            ))}
          </div>
        )}
        {!stacked && item.Type !== 'Series' && query.data?.episodes && query.data.episodes.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">
              {item.Type === 'Episode'
                ? `More from ${item.SeasonName ?? 'this season'}`
                : 'Episodes'}
            </h2>
            <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {query.data.episodes.map((episode) => {
                const still = jellyfinCardImage(episode, 320, 'landscape');
                const progress = episode.UserData?.PlayedPercentage;
                return (
                  <button
                    key={episode.Id}
                    type="button"
                    onClick={() => void playback.playItem(episode)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border bg-card/60 p-2 text-left transition-colors hover:bg-accent',
                      episode.Id === item.Id && 'border-[var(--hpr-amber)]',
                    )}
                  >
                    <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {still && (
                        <FadeInImage src={still} alt="" fill sizes="128px" unoptimized className="object-cover" />
                      )}
                      {typeof progress === 'number' && progress > 0 && progress < 100 && (
                        <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                          <span
                            className={cn('block h-full', cinematic ? 'bg-[#e50914]' : 'bg-[var(--hpr-amber)]')}
                            style={{ width: `${progress}%` }}
                          />
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
        {/* Instant mix is a music feature; the route returns it for anything, so
            a TV season was showing a rail of unrelated songs. */}
        {isMusic && query.data?.instantMix && query.data.instantMix.length > 0 && (
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
        {/* The site's More Like This is 16:9 on desktop, and the cinematic card
            swaps back to a poster on phones. Classic keeps portrait. Seasons,
            Filmography and Recordings above stay portrait on purpose: season
            and person art is a poster, and cropping it to 16:9 loses the
            subject. */}
        {!stacked && query.data?.similar && query.data.similar.length > 0 && (
          <CatalogRail
            title="More Like This"
            shape={cinematic ? 'landscape' : 'portrait'}
            items={query.data.similar}
            onPlay={(next) => void playback.playItem(next)}
          />
        )}

        {people.length > 0 && (
          <MediaRail title="Cast & crew" count={Math.min(people.length, 20)}>
              {/* The position is part of the key because id+role is not unique:
                  Jellyfin credits one person once per job, so a director who
                  also wrote the episode arrives twice carrying the same Role
                  and only a differing Type — which React reported as two
                  children with the same key. */}
              {people.slice(0, 20).map((person, position) => (
                person.Id ? (
                  <Link key={`${person.Id}-${person.Role}-${position}`} href={`/jellyfin/library/item/${person.Id}`} className="w-24 shrink-0 text-center">
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
          </MediaRail>
        )}

        <CatalogTrailerRail trailers={trailers} />
      </div>
    </div>
  );
}

/**
 * One phone action: an outline icon with its label beneath, spread across the
 * row. The app labels every one of these; a bare circle is a guess.
 */
function StackedAction({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex min-w-14 flex-col items-center gap-1.5 text-[11px] text-white/85"
    >
      <span className="flex h-7 items-center justify-center">{children}</span>
      {label}
    </button>
  );
}

function FavoriteButton({ itemId, favorite, stacked = false }: { itemId: string; favorite: boolean; stacked?: boolean }) {
  const queryClient = useQueryClient();
  const toggle = async () => {
    await fetch('/api/jellyfin/catalog/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, favorite: !favorite }),
    });
    await queryClient.invalidateQueries({ queryKey: ['jellyfin', 'catalog'] });
  };
  if (stacked) {
    return (
      <StackedAction label="My List" onClick={() => void toggle()} active={favorite}>
        {favorite ? <Check className="size-6" strokeWidth={3} /> : <Plus className="size-6" />}
      </StackedAction>
    );
  }
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

function WatchedButton({ itemId, played, seriesId, stacked = false }: { itemId: string; played: boolean; seriesId?: string; stacked?: boolean }) {
  const queryClient = useQueryClient();
  const toggle = async () => {
    await fetch('/api/jellyfin/watch-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jellyfinItemId: itemId, played: !played, seriesId }),
    });
    await queryClient.invalidateQueries({ queryKey: ['jellyfin', 'catalog'] });
  };
  if (stacked) {
    return (
      <StackedAction label={played ? 'Watched' : 'Mark watched'} onClick={() => void toggle()} active={played}>
        <Check className="size-6" strokeWidth={played ? 3 : 2} />
      </StackedAction>
    );
  }
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
