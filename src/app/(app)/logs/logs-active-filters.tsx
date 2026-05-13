'use client';

import { X } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import type { LogLevel, LogSource } from './logs-filter-menu';

interface LogsActiveFiltersProps {
  levels: Set<LogLevel>;
  sources: Set<LogSource>;
  from: string;
  to: string;
  selectedFile: string;
  query: string;
  onToggleLevel: (value: LogLevel) => void;
  onToggleSource: (value: LogSource) => void;
  onClearDateRange: () => void;
  onClearFile: () => void;
  onClearQuery: () => void;
  onClearAll: () => void;
}

function formatRange(from: string, to: string) {
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  const fromLabel = fromDate && !Number.isNaN(fromDate.getTime())
    ? format(fromDate, 'MMM d, HH:mm')
    : '…';
  const toLabel = toDate && !Number.isNaN(toDate.getTime())
    ? format(toDate, 'MMM d, HH:mm')
    : '…';
  return `${fromLabel} → ${toLabel}`;
}

interface ChipProps {
  label: string;
  onClear: () => void;
}

function FilterChip({ label, onClear }: ChipProps) {
  return (
    <Badge
      variant="outline"
      className="gap-1 pl-2 pr-1 py-1 text-xs font-normal border-primary/30 bg-primary/5"
    >
      <span className="text-foreground/90">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

export function LogsActiveFilters({
  levels,
  sources,
  from,
  to,
  selectedFile,
  query,
  onToggleLevel,
  onToggleSource,
  onClearDateRange,
  onClearFile,
  onClearQuery,
  onClearAll,
}: LogsActiveFiltersProps) {
  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (query) chips.push({ key: 'q', label: `Search: "${query}"`, onClear: onClearQuery });
  for (const level of levels) {
    chips.push({ key: `level-${level}`, label: `Level: ${level}`, onClear: () => onToggleLevel(level) });
  }
  for (const source of sources) {
    chips.push({ key: `source-${source}`, label: `Source: ${source}`, onClear: () => onToggleSource(source) });
  }
  if (from || to) chips.push({ key: 'date', label: formatRange(from, to), onClear: onClearDateRange });
  if (selectedFile !== 'all') chips.push({ key: 'file', label: `File: ${selectedFile}`, onClear: onClearFile });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <FilterChip key={chip.key} label={chip.label} onClear={chip.onClear} />
      ))}
      {chips.length >= 2 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
