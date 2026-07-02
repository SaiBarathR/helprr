import { Skeleton } from '@/components/ui/skeleton';

// Default matches the medium poster grid used by the movies/series/music pages.
const DEFAULT_GRID_CLASS = 'grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';

// Poster-shaped placeholder grid shown while a media library loads. Pass the
// page's computed poster grid class so the real cards mount without layout
// shift regardless of the user's poster-size preference.
export function MediaGridSkeleton({ count = 18, gridClassName }: { count?: number; gridClassName?: string }) {
  return (
    <div className={gridClassName ?? DEFAULT_GRID_CLASS}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="aspect-[2/3] w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

// Shared route-level loading fallback for the media library pages (movies,
// series, music): toolbar placeholders + poster grid, so the RSC gap and the
// client fetch render as one continuous skeleton.
export function MediaLibraryLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <MediaGridSkeleton />
    </div>
  );
}
