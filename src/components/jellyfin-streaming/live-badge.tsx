import { cn } from '@/lib/utils';

/** What a broadcast shows where a file has its scrubber and clocks. */
export function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider', className)}>
      <span className="size-2 rounded-full bg-red-500" aria-hidden="true" />
      LIVE
    </span>
  );
}
