'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ActiveFilter {
  id: string;
  label: string;
  onRemove: () => void;
}

/**
 * Names the filters narrowing the list below it, so a filtered view is never
 * mistaken for the full list. Renders nothing when no filter is active. Each
 * chip clears its own filter; "Clear all" appears once more than one is active.
 * Only filters that hide items belong here — sort order doesn't.
 */
export function ActiveFilterBar({
  filters,
  onClearAll,
  className,
}: {
  filters: ActiveFilter[];
  onClearAll: () => void;
  className?: string;
}) {
  if (filters.length === 0) return null;

  return (
    <div role="region" aria-label="Active filters" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-xs text-muted-foreground">Filtered by</span>
      {filters.map((filter) => (
        <span
          key={filter.id}
          className="inline-flex max-w-full items-center rounded-full bg-primary/15 pl-2.5 text-xs font-medium text-primary"
        >
          <span className="truncate">{filter.label}</span>
          <button
            type="button"
            onClick={filter.onRemove}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-primary/20"
            aria-label={`Remove ${filter.label} filter`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <button type="button" onClick={onClearAll} className="px-1 text-xs font-medium text-primary">
          Clear all
        </button>
      )}
    </div>
  );
}
