import { Skeleton } from '@/components/ui/skeleton';
import { ListSkeleton } from '@/components/ui/list-skeleton';

// Route-level fallback matching the page's toolbar + torrent rows, so the RSC
// gap and the client fetch render as one continuous skeleton.
export default function TorrentsLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-11 w-full rounded-lg" />
      <ListSkeleton />
    </div>
  );
}
