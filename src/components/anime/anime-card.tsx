import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { FadeInImage } from '@/components/media/fade-in-image';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import { ScheduledAlertButton } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { Check, Star } from 'lucide-react';
import type { AniListListItem } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

export type AnimeItemWithLibrary = AniListListItem & { library?: DiscoverLibraryStatus };

export function AnimeCard({
  item,
  grid,
  imagePriority,
  onNavigate,
}: {
  item: AnimeItemWithLibrary;
  grid?: boolean;
  imagePriority?: boolean;
  onNavigate?: () => void;
}) {
  const imgSrc = item.coverImage
    ? toCachedImageSrc(item.coverImage, 'anilist') || item.coverImage
    : null;

  return (
    <div className={`${grid ? '' : 'flex-shrink-0 w-[110px]'} group relative`}>
      <Link
        href={`/anime/${item.id}`}
        className="block"
        onClick={onNavigate}
      >
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-sm group-hover:shadow-md transition-shadow">
          {imgSrc ? (
            <FadeInImage
              src={imgSrc}
              alt={item.title}
              fill
              sizes={grid ? '(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw' : '110px'}
              priority={imagePriority}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized={isProtectedApiImageSrc(imgSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
              {item.title}
            </div>
          )}
          {/* Bottom gradient for readability */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/60 to-transparent pointer-events-none" />
          {item.averageScore != null && item.averageScore > 0 && (
            <Badge className="absolute top-1 right-1 text-[9px] bg-background/60 text-foreground gap-0.5">
              <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
              {item.averageScore}%
            </Badge>
          )}
          {item.library?.exists && (
            <Badge className="absolute top-1 left-1 text-[9px] bg-background/60 backdrop-blur-md text-green-400">
              <Check className="h-2 w-2" strokeWidth={3} />
            </Badge>
          )}
          {item.format && (
            <Badge className="absolute bottom-1 left-1 text-[9px] bg-background/60 text-foreground">
              {item.format.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {item.year && <span>{item.year}</span>}
          {item.episodes != null && (
            <>
              {item.year && <span>·</span>}
              <span>{item.episodes} eps</span>
            </>
          )}
        </div>
      </Link>
      {!item.library?.exists && (
        <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
          <WatchlistButton
            draft={{
              source: 'ANILIST',
              externalId: String(item.id),
              mediaType: 'anime',
              title: item.title,
              year: item.year ?? item.seasonYear ?? null,
              posterUrl: item.coverImage ?? null,
              overview: null,
              rating: item.averageScore ?? null,
              releaseDate: null,
            }}
            variant="icon"
            className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-background/60 backdrop-blur-md text-foreground hover:bg-background/80"
          />
          <ScheduledAlertButton
            draft={{
              source: 'ANILIST',
              externalId: String(item.id),
              mediaType: 'anime',
              title: item.title,
              year: item.year ?? item.seasonYear ?? null,
              posterUrl: item.coverImage ?? null,
              href: `/anime/${item.id}`,
            }}
            variant="icon"
            className="h-5 w-5"
          />
        </div>
      )}
    </div>
  );
}
