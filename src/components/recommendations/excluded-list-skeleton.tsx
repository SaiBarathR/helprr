import { Skeleton } from '@/components/ui/skeleton';

/** Rows shaped like the Excluded titles list: poster, two text lines, button. */
export function ExcludedListSkeleton() {
  return (
    <div className="divide-y rounded-xl bg-card">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="aspect-[2/3] w-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}
