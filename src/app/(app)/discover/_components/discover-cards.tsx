'use client';

import { useState } from 'react';
import Link from '@/components/ui/app-link';
import { HeroImage } from '@/components/media/hero-image';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { useCan, useMe, hasCapability } from '@/components/permission-provider';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { DiscoverItem, DiscoverSection } from '@/types';
import type { DiscoverLayoutSection } from '@/lib/discover-layout-config';
import { Star, Tv, Film, ChevronRight, Check, ExternalLink, Plus, Inbox } from 'lucide-react';
import { useRequestedMedia } from '@/components/seerr/requested-media-provider';
import { SeerrRequestModal } from '@/components/seerr/seerr-request-modal';

export function cardTypeIcon(type: 'movie' | 'tv') {
  return (
    <div className="flex items-center justify-center h-5 w-5 rounded-md bg-background/60">
      {type === 'movie'
        ? <Film className="h-3 w-3 text-blue-400" />
        : <Tv className="h-3 w-3 text-violet-400" />}
    </div>
  );
}

export function DiscoverHeroSlide({ item, priority = false }: { item: DiscoverItem; priority?: boolean }) {
  const backdropSrc = item.backdropPath
    ? toCachedImageSrc(item.backdropPath, 'tmdb', { width: 1280 }) || item.backdropPath
    : null;
  const posterSrc = item.posterPath
    ? toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath
    : null;
  const src = backdropSrc ?? posterSrc;

  return (
    <Link
      href={`/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`}
      className="block h-full"
    >
      <div className="relative h-full overflow-hidden">
        {src ? (
          <HeroImage
            src={src}
            alt={item.title}
            fill
            sizes="100vw"
            className={backdropSrc ? 'object-cover animate-hero-zoom' : 'object-cover blur-2xl scale-125 animate-hero-zoom'}
            priority={priority}
            unoptimized={isProtectedApiImageSrc(src)}
          />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent light:via-background/25" />
        {/* Extra bottom padding keeps badges clear of the carousel dots */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pt-4 pb-9 flex flex-col gap-1.5">
          <h2 className="text-xl font-bold leading-tight line-clamp-2 drop-shadow-lg">{item.title}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {item.rating > 0 && (
              <Badge className="bg-background/50 text-foreground text-[10px] gap-0.5 backdrop-blur-sm">
                <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                {item.rating.toFixed(1)}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] border-foreground/30 text-foreground backdrop-blur-sm">
              {item.mediaType === 'movie' ? 'Movie' : 'Show'}
            </Badge>
            {item.year && (
              <Badge variant="outline" className="text-[10px] border-foreground/30 text-foreground backdrop-blur-sm">
                {item.year}
              </Badge>
            )}
            {(item.genreNames ?? []).slice(0, 3).map((genre) => (
              <Badge key={genre} variant="outline" className="text-[10px] border-foreground/30 text-foreground backdrop-blur-sm">
                {genre}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function MediaPoster({
  item,
  onClick,
  variant = 'rail',
  imagePriority,
}: {
  item: DiscoverItem;
  onClick: (item: DiscoverItem) => void;
  variant?: 'rail' | 'grid';
  imagePriority?: boolean;
}) {
  const isGrid = variant === 'grid';
  const me = useMe();
  const canWatchlist = useCan('watchlist.edit');
  const canSchedule = useCan('scheduledAlerts.edit');
  const canAdd = useCan(item.mediaType === 'movie' ? 'movies.add' : 'series.add');
  const seerrMediaType = item.mediaType === 'movie' ? 'movie' as const : 'tv' as const;
  const canRequest = !!me?.seerrConfigured && hasCapability(me, 'requests.create');
  const { isRequested, markRequested } = useRequestedMedia(canRequest && item.tmdbId > 0);
  const requested = isRequested(seerrMediaType, item.tmdbId);
  const showPosterOverlayActions = !item.library?.exists;
  const [requestOpen, setRequestOpen] = useState(false);
  const posterSrc = item.posterPath
    ? (toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath)
    : null;
  const detailHref = `/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`;
  const mediaType = item.mediaType === 'movie' ? 'movie' : 'series';
  const draft = {
    source: 'TMDB' as const,
    externalId: String(item.tmdbId),
    mediaType: mediaType as 'movie' | 'series',
    title: item.title,
    year: item.year ?? null,
    posterUrl: item.posterPath,
    overview: item.overview ?? null,
    rating: typeof item.rating === 'number' ? item.rating * 10 : null,
    releaseDate: item.releaseDate ?? null,
    href: detailHref,
  };
  const libraryInstance = item.library?.instances?.[0]
    ?? (item.library?.id ? {
      id: item.library.id,
      instanceId: item.library.instanceId ?? '',
      instanceLabel: '',
    } : null);
  const libraryHref = libraryInstance
    ? `/${item.mediaType === 'movie' ? 'movies' : 'series'}/${libraryInstance.id}${libraryInstance.instanceId ? `?instance=${libraryInstance.instanceId}` : ''}`
    : null;
  const addHref = (() => {
    const params = new URLSearchParams({ term: item.title, tmdbId: String(item.tmdbId) });
    if (item.mediaType !== 'movie') params.set('seriesType', 'standard');
    return `/${item.mediaType === 'movie' ? 'movies' : 'series'}/add?${params.toString()}`;
  })();
  return (
    <div
      className={isGrid
        ? 'group relative w-full min-w-0'
        : 'group relative min-w-[110px] w-[110px] sm:min-w-[140px] sm:w-[140px] md:min-w-[150px] md:w-[150px] lg:min-w-[164px] lg:w-[164px] xl:min-w-[180px] xl:w-[180px] 2xl:min-w-[196px] 2xl:w-[196px]'}
    >
      <QuickContextMenu
        label={`${item.title} actions`}
        actions={[
          {
            id: 'open',
            label: 'Open details',
            icon: <ExternalLink />,
            onSelect: () => onClick(item),
          },
          ...(libraryHref ? [{
            id: 'library',
            label: 'Open in library',
            icon: <Check />,
            href: libraryHref,
          }] : !item.library?.exists && canAdd ? [{
            id: 'add',
            label: `Add to ${item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'}`,
            icon: <Plus />,
            href: addHref,
          }] : []),
          ...(!item.library?.exists && canRequest ? [{
            id: 'request',
            label: requested ? 'Requested' : 'Request',
            icon: requested ? <Check /> : <Inbox />,
            onSelect: () => setRequestOpen(true),
            disabled: requested,
          }] : []),
        ]}
      >
        <button
          type="button"
          onClick={() => onClick(item)}
          className="block w-full text-left"
        >
          <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted/60 border border-border/40">
          {posterSrc ? (
            <FadeInImage
              src={posterSrc}
              alt={item.title}
              fill
              sizes={isGrid ? '(max-width: 640px) 33vw, (max-width: 1200px) 18vw, 170px' : '(max-width: 640px) 35vw, (max-width: 768px) 140px, (max-width: 1024px) 150px, (max-width: 1280px) 164px, (max-width: 1536px) 180px, 196px'}
              priority={imagePriority}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized={isProtectedApiImageSrc(posterSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              {item.mediaType === 'movie' ? <Film className="h-7 w-7" /> : <Tv className="h-7 w-7" />}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          <div className="absolute top-1.5 left-1.5">{cardTypeIcon(item.mediaType)}</div>
          <div className="absolute bottom-0 left-0 right-0 p-2">
            <p className="text-xs text-white font-medium line-clamp-2 leading-tight">{item.title}</p>
            <div className="mt-1 flex items-center justify-between text-[10px] text-white/80">
              <span>{item.year ?? '----'}</span>
              <span className="inline-flex items-center gap-1">
                <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                {item.rating.toFixed(1)}
              </span>
            </div>
          </div>
          </div>
        </button>
      </QuickContextMenu>
      <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1.5">
        {item.library?.exists ? (
          <div className="flex items-center justify-center h-5 w-5 rounded-md bg-background/60 backdrop-blur-md">
            <Check className="h-3 w-3 text-green-400" strokeWidth={3} />
          </div>
        ) : (
          <>
          {canWatchlist && showPosterOverlayActions && (
            <WatchlistButton
              draft={draft}
              variant="icon"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-background/60 backdrop-blur-md text-foreground hover:bg-background/80"
            />
          )}
          {canSchedule && showPosterOverlayActions && (
          <ScheduledAlertButton
            draft={draft}
            variant="icon"
            className="h-5 w-5"
          />
          )}
          </>
        )}
      </div>
      {!item.library?.exists && canRequest && (
        <SeerrRequestModal
          open={requestOpen}
          onOpenChange={setRequestOpen}
          mode="create"
          mediaType={seerrMediaType}
          tmdbId={item.tmdbId}
          title={item.title}
          onDone={() => markRequested(seerrMediaType, item.tmdbId)}
        />
      )}
    </div>
  );
}

// Cold-load placeholder in the page's own shape (hero, then poster rails at the
// real card widths) instead of a lone spinner, so the content lands in place.
export function DiscoverHomeSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading Discover" className="space-y-5">
      <div aria-hidden="true" className="space-y-5">
        <Skeleton className="-mx-2 h-[280px] rounded-none md:-mx-6 md:h-[380px]" />
        {Array.from({ length: 3 }, (_, row) => (
          <div key={row} className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <div className="rail-bleed flex gap-2.5 overflow-hidden pb-1">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton
                  key={i}
                  className="aspect-[2/3] min-w-[110px] w-[110px] shrink-0 rounded-xl sm:min-w-[140px] sm:w-[140px] md:min-w-[150px] md:w-[150px] lg:min-w-[164px] lg:w-[164px] xl:min-w-[180px] xl:w-[180px] 2xl:min-w-[196px] 2xl:w-[196px]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectionRow({
  section,
  onOpenItem,
  onSeeAll,
  onPickGenre,
  onPickProvider,
}: {
  section: DiscoverSection;
  onOpenItem: (item: DiscoverItem) => void;
  onSeeAll: (section: DiscoverSection) => void;
  onPickGenre: (genreId: number, type: 'movie' | 'show') => void;
  onPickProvider: (providerId: number, type: 'movie' | 'show') => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{section.title}</h2>
        {section.type === 'media' && (
          <button
            onClick={() => onSeeAll(section)}
            className="relative text-xs text-primary font-medium inline-flex items-center gap-1 touch-target"
          >
            See all
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {section.type === 'media' && (
        <div data-scroll-restoration-key={`discover-section:${section.key}:media`} className="rail-bleed flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
          {(section.items as DiscoverItem[]).map((item) => (
            <div key={`${item.mediaType}-${item.tmdbId}`} className="snap-start">
              <MediaPoster item={item} onClick={onOpenItem} />
            </div>
          ))}
        </div>
      )}

      {section.type === 'genre' && (
        <div data-scroll-restoration-key={`discover-section:${section.key}:genre`} className="rail-bleed flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(section.items as Array<{ id: number; name: string; type: 'movie' | 'tv' }>).map((genre) => (
            <button
              key={`${genre.type}-${genre.id}`}
              onClick={() => onPickGenre(genre.id, genre.type === 'movie' ? 'movie' : 'show')}
              className="px-4 py-3 rounded-xl border border-border/50 bg-accent/40 min-w-[150px] text-left"
            >
              <p className="text-sm font-semibold truncate">{genre.name}</p>
            </button>
          ))}
        </div>
      )}

      {section.type === 'provider' && (
        <div data-scroll-restoration-key={`discover-section:${section.key}:provider`} className="rail-bleed flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(section.items as Array<{ id: number; name: string; logoPath: string | null; type: 'movie' | 'tv' }>).map((provider) => {
            const providerLogoPath = provider.logoPath ? `https://image.tmdb.org/t/p/w185${provider.logoPath}` : null;
            const providerLogoSrc = providerLogoPath
              ? (toCachedImageSrc(providerLogoPath, 'tmdb') || providerLogoPath)
              : null;

            return (
              <button
                key={`${provider.type}-${provider.id}`}
                onClick={() => onPickProvider(provider.id, provider.type === 'movie' ? 'movie' : 'show')}
                className="min-w-[160px] rounded-xl border border-border/50 bg-accent/40 p-3 flex items-center gap-3"
              >
                <div className="relative h-8 w-8 rounded bg-background/70 overflow-hidden shrink-0">
                  {providerLogoSrc ? (
                    <FadeInImage
                      src={providerLogoSrc}
                      alt={provider.name}
                      fill
                      sizes="32px"
                      className="object-contain"
                      unoptimized={isProtectedApiImageSrc(providerLogoSrc)}
                    />
                  ) : null}
                </div>
                <p className="text-sm font-semibold text-left truncate">{provider.name}</p>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function CustomCarouselRow({
  layoutSection,
  items,
  loading,
  onOpenItem,
  onSeeAll,
}: {
  layoutSection: DiscoverLayoutSection;
  items: DiscoverItem[];
  loading: boolean;
  onOpenItem: (item: DiscoverItem) => void;
  onSeeAll: (layoutSection: DiscoverLayoutSection) => void;
}) {
  const header = (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-semibold">{layoutSection.label}</h2>
      <div className="flex items-center gap-2">
        {layoutSection.filters && (
          <button
            onClick={() => onSeeAll(layoutSection)}
            className="relative text-xs text-primary font-medium inline-flex items-center gap-1 touch-target"
          >
            See all
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="text-[10px] text-muted-foreground/50 bg-muted/40 px-1.5 py-0.5 rounded">Custom</span>
      </div>
    </div>
  );

  if (loading) {
    return (
      <section className="space-y-2">
        {header}
        <div data-scroll-restoration-key={`discover-custom:${layoutSection.id}:loading`} className="rail-bleed flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="min-w-[110px] w-[110px] sm:min-w-[140px] sm:w-[140px] md:min-w-[150px] md:w-[150px] lg:min-w-[164px] lg:w-[164px] xl:min-w-[180px] xl:w-[180px] 2xl:min-w-[196px] 2xl:w-[196px] aspect-[2/3] rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      {header}
      <div data-scroll-restoration-key={`discover-custom:${layoutSection.id}`} className="rail-bleed flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
        {items.map((item) => (
          <div key={`${item.mediaType}-${item.tmdbId}`} className="snap-start">
            <MediaPoster item={item} onClick={onOpenItem} />
          </div>
        ))}
      </div>
    </section>
  );
}
