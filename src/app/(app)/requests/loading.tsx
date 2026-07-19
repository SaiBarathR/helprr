import { Skeleton } from '@/components/ui/skeleton';
import { ListSkeleton } from '@/components/ui/list-skeleton';

// Route-level fallback matching the page's toolbar + list rows (same shape as
// torrents/loading.tsx) so navigation paints a continuous skeleton.
export default function RequestsLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-11 w-full rounded-lg" />
      <ListSkeleton />
    </div>
  );
}
