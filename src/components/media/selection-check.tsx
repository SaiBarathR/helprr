import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared visual checkbox used by the library item components in selection mode.
 *  Purely decorative (aria-hidden) — the surrounding card/row handles the toggle. */
export function SelectionCheck({ selected, className }: { selected: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded-md border-2 shadow-sm transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-white/80 bg-black/40 backdrop-blur-sm',
        className
      )}
    >
      {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}
