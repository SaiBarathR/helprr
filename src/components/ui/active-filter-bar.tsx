'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ActiveFilter {
  id: string;
  label: string;
  onRemove: () => void;
}

/** One chip per picked option of a multi-select filter, each unpicking itself. */
export function multiSelectFilters(
  selected: readonly string[],
  options: readonly { value: string; label: string }[],
  onChange: (next: string[]) => void,
): ActiveFilter[] {
  return selected.map((value) => ({
    id: `option:${value}`,
    label: options.find((option) => option.value === value)?.label ?? value,
    onRemove: () => onChange(selected.filter((other) => other !== value)),
  }));
}

/** A search box's chip: a search narrows the list like any other filter. */
export function searchFilter(query: string, onClear: () => void): ActiveFilter[] {
  const text = query.trim();
  return text ? [{ id: 'search', label: `Search: "${text}"`, onRemove: onClear }] : [];
}

/** The accessible name of a filter trigger, saying when filters are active. */
export function filterButtonLabel(label: string, active: boolean): string {
  return active ? `${label} (filters active)` : label;
}

/**
 * The dot a filter trigger shows while its filters hide items. The trigger
 * needs `relative`; pair it with {@link filterButtonLabel} for screen readers.
 */
export function FilterDot({ active }: { active: boolean }) {
  if (!active) return null;
  return <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary" />;
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
    <div role="region" aria-label="Active filters" className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-2', className)}>
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
            className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full touch-target hover:bg-primary/20"
            aria-label={`Remove ${filter.label} filter`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <button type="button" onClick={onClearAll} className="relative px-1 text-xs font-medium text-primary touch-target">
          Clear all
        </button>
      )}
    </div>
  );
}
