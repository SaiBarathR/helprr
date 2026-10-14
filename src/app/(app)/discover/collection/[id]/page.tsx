import { isAxiosError } from 'axios';
import Image from 'next/image';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Star, Film } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { TMDB_TITLE_PAGE_CAPABILITIES } from '@/lib/capabilities';
import { ConfigurationError } from '@/lib/config-error';
import { getDiscoverCollectionDetail } from '@/lib/discover-collection';
import { assertPageAnyCapability } from '@/lib/page-guard';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type { DiscoverCollectionDetail } from '@/types';

type DiscoverCollectionPageProps = {
  params: Promise<{ id: string }>;
};

async function loadCollection(collectionId: number): Promise<DiscoverCollectionDetail> {
  try {
    return await getDiscoverCollectionDetail(collectionId);
  } catch (error) {
    // Same messages the collection API route gives for these failures.
    if (error instanceof TmdbRateLimitError) throw new Error('TMDB rate limit reached');
    console.error('[discover] Failed to load collection:', error instanceof Error ? error.message : error);
    if (isAxiosError(error) && error.response?.status === 404) throw new Error('Not found');
    if (error instanceof ConfigurationError) throw new Error(error.message);
    throw new Error('Failed to load collection');
  }
}

export default async function DiscoverCollectionPage({ params }: DiscoverCollectionPageProps) {
  // Loads data directly, so it checks access itself rather than relying on the
  // layouts, which render in parallel with the page. Same policy as the
  // collection API route.
  await assertPageAnyCapability(TMDB_TITLE_PAGE_CAPABILITIES);

  const { id } = await params;
  const collectionId = Number(id);

  let collection: DiscoverCollectionDetail | null = null;
  let error: string | null = null;

  if (!Number.isFinite(collectionId) || collectionId <= 0) {
    error = 'Invalid collection ID';
  } else {
    try {
      collection = await loadCollection(collectionId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load collection';
    }
  }

  if (error || !collection) {
    return (
      <>
        <PageHeader title="Collection" />
        <div className="text-center py-12 text-muted-foreground">
          {error || 'Collection not found'}
        </div>
      </>
    );
  }

  const backdropSrc = collection.backdropPath
    ? toCachedImageSrc(collection.backdropPath, 'tmdb', { width: 1280 }) || collection.backdropPath
    : null;

  return (
    <div className="animate-content-in">
      <PageHeader title={collection.name} />

      <div className="space-y-5 pb-8">
        {/* Hero */}
        <div className="relative h-[180px] bg-muted/40 -mx-2 md:-mx-6">
          {backdropSrc && (
            <Image
              src={backdropSrc}
              alt={collection.name}
              fill
              sizes="100vw"
              className="object-cover"
              priority
              unoptimized={isProtectedApiImageSrc(backdropSrc)}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent light:via-background/25" />
          <div className="absolute bottom-0 left-0 right-0 px-2 md:px-6 pb-4">
            <h1 className="text-xl font-bold text-foreground">{collection.name}</h1>
            <p className="text-sm text-muted-foreground">{collection.parts.length} movies</p>
          </div>
        </div>

        {/* Overview */}
        {collection.overview && (
          <div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {collection.overview}
            </p>
          </div>
        )}

        {/* Movies */}
        <div className="space-y-2.5">
          {collection.parts.map((movie) => {
            const posterSrc = movie.posterPath
              ? toCachedImageSrc(movie.posterPath, 'tmdb') || movie.posterPath
              : null;
            return (
              <Link
                key={movie.tmdbId}
                href={`/discover/movie/${movie.tmdbId}`}
                className="flex gap-3 rounded-xl border border-border/50 bg-accent/20 p-3 items-center"
              >
                <div className="relative w-[55px] h-[82px] rounded-lg overflow-hidden bg-muted shrink-0">
                  {posterSrc ? (
                    <Image
                      src={posterSrc}
                      alt={movie.title}
                      fill
                      sizes="55px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(posterSrc)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Film className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold line-clamp-1">{movie.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                    {movie.year && <span>{movie.year}</span>}
                    {movie.rating > 0 && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5">
                          <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                          {movie.rating.toFixed(1)}
                        </span>
                      </>
                    )}
                  </div>
                  {movie.overview && (
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-tight">
                      {movie.overview}
                    </p>
                  )}
                </div>
                {movie.library?.exists && (
                  <Badge className="bg-green-600/90 text-[10px] text-foreground shrink-0">Added</Badge>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
