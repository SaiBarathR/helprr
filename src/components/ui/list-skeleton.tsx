import { Skeleton } from '@/components/ui/skeleton';

// Row-shaped placeholder list shown while torrents/activity queues load:
// a name line plus a progress-bar line per row, matching the card rows.
export function ListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
