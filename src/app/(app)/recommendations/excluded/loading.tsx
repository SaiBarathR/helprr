import { Skeleton } from '@/components/ui/skeleton';
import { ExcludedListSkeleton } from '@/components/recommendations/excluded-list-skeleton';

// Without its own fallback this route would borrow the parent's hero-and-grid one.
export default function ExcludedTitlesLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-11 w-48" />
      <ExcludedListSkeleton />
    </div>
  );
}
