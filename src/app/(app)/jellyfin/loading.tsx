import { Skeleton } from '@/components/ui/skeleton';
import { ListSkeleton } from '@/components/ui/list-skeleton';

// Route-level fallback matching the page's tab bar + session/library rows.
export default function JellyfinLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-64 rounded-lg" />
      <ListSkeleton />
    </div>
  );
}
