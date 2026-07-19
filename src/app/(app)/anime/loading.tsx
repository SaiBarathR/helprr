import { Skeleton } from '@/components/ui/skeleton';
import { MediaGridSkeleton } from '@/components/ui/media-grid-skeleton';

// Route-level fallback matching the page's hero/rail + poster grid shape.
export default function AnimeLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-48 w-full rounded-xl" />
      <MediaGridSkeleton count={12} />
    </div>
  );
}
