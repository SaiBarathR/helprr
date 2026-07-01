import { Skeleton } from '@/components/ui/skeleton';
import { MediaGridSkeleton } from '@/components/ui/media-grid-skeleton';

// Route-level fallback matching the page's toolbar + poster grid, so the RSC
// gap and the client fetch render as one continuous skeleton.
export default function MusicLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <MediaGridSkeleton />
    </div>
  );
}
