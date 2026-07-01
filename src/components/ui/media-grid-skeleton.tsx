import { Skeleton } from '@/components/ui/skeleton';

// Poster-shaped placeholder grid shown while a media library loads. Mirrors the
// medium poster grid classes used by the movies/series/music pages so the real
// cards mount without layout shift.
export function MediaGridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="aspect-[2/3] w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}
