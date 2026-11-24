'use client';

import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterDot, filterButtonLabel, type ActiveFilter } from '@/components/ui/active-filter-bar';
import {
  ResponsiveMenu,
  ResponsiveMenuActionItem,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import { formatDate } from '@/lib/date-format';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import type { Tag } from '@/types/arr';
import { NO_STATS_FILTERS, endOfLocalDay, hasStatsFilters, type StatsFilters } from './prowlarr-stats-query';

const PROTOCOLS: { value: StatsFilters['protocol']; label: string }[] = [
  { value: '', label: 'Any protocol' },
  { value: 'torrent', label: 'Torrent' },
  { value: 'usenet', label: 'Usenet' },
];

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function toggle(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

function endDateLabel(day: string): string {
  const end = endOfLocalDay(day);
  if (!end) return `Up to ${day}`;
  const thisYear = end.getFullYear() === new Date().getFullYear();
  return `Up to ${formatDate(end, thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * The Stats tab's filters beyond the range pills, in the menu shape the library
 * pages use: a dropdown from md up, a bottom sheet on a phone. Every pick
 * applies at once, as the range pills do.
 */
export function StatsFilterMenu({
  filters,
  onChange,
  indexers,
  tags,
}: {
  filters: StatsFilters;
  onChange: (filters: StatsFilters) => void;
  indexers: ProwlarrIndexerSummary[];
  tags: Tag[];
}) {
  const active = hasStatsFilters(filters);
  return (
    <ResponsiveMenu
      title="Filters"
      titleInDropdown
      align="end"
      contentClassName="w-64 max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
      trigger={(
        <Button
          variant="outline"
          size="icon"
          className="relative h-auto self-stretch aspect-square rounded-lg bg-card"
          aria-label={filterButtonLabel('Filters', active)}
        >
          <Filter className="h-4 w-4" />
          <FilterDot active={active} />
        </Button>
      )}
    >
      <ResponsiveMenuLabel>Up to</ResponsiveMenuLabel>
      {/* Keys stay in the field: the dropdown would read them as a search of its items. */}
      <div className="flex items-center gap-1 px-2 pb-1" onKeyDown={(event) => event.stopPropagation()}>
        <Input
          type="date"
          aria-label="Last day counted"
          value={filters.endDate}
          max={todayLocal()}
          onChange={(event) => onChange({ ...filters, endDate: endOfLocalDay(event.target.value) ? event.target.value : '' })}
          className="h-9 min-w-0 flex-1 text-sm"
        />
        {filters.endDate && (
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Count up to now" onClick={() => onChange({ ...filters, endDate: '' })}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <ResponsiveMenuSeparator />
      <ResponsiveMenuLabel>Protocol</ResponsiveMenuLabel>
      {PROTOCOLS.map((protocol) => (
        <ResponsiveMenuCheckboxItem
          key={protocol.value || 'any'}
          checked={filters.protocol === protocol.value}
          onCheckedChange={() => onChange({ ...filters, protocol: protocol.value })}
        >
          {protocol.label}
        </ResponsiveMenuCheckboxItem>
      ))}
      {tags.length > 0 && (
        <>
          <ResponsiveMenuSeparator />
          <ResponsiveMenuLabel>Tags</ResponsiveMenuLabel>
          {tags.map((tag) => (
            <ResponsiveMenuCheckboxItem
              key={tag.id}
              checked={filters.tags.includes(tag.id)}
              onCheckedChange={() => onChange({ ...filters, tags: toggle(filters.tags, tag.id) })}
            >
              <span className="truncate">{tag.label}</span>
            </ResponsiveMenuCheckboxItem>
          ))}
        </>
      )}
      {indexers.length > 0 && (
        <>
          <ResponsiveMenuSeparator />
          <ResponsiveMenuLabel>Indexers</ResponsiveMenuLabel>
          {indexers.map((indexer) => (
            <ResponsiveMenuCheckboxItem
              key={indexer.id}
              checked={filters.indexers.includes(indexer.id)}
              onCheckedChange={() => onChange({ ...filters, indexers: toggle(filters.indexers, indexer.id) })}
            >
              <span className="truncate">{indexer.name}</span>
            </ResponsiveMenuCheckboxItem>
          ))}
        </>
      )}
      {active && (
        <>
          <ResponsiveMenuSeparator />
          <ResponsiveMenuActionItem onSelect={() => onChange(NO_STATS_FILTERS)}>Reset filters</ResponsiveMenuActionItem>
        </>
      )}
    </ResponsiveMenu>
  );
}

/** One chip per filter for the active-filter bar, each clearing itself. */
export function statsActiveFilters(
  filters: StatsFilters,
  onChange: (filters: StatsFilters) => void,
  indexers: ProwlarrIndexerSummary[],
  tags: Tag[],
): ActiveFilter[] {
  const indexerNames = new Map(indexers.map((indexer) => [indexer.id, indexer.name]));
  const tagLabels = new Map(tags.map((tag) => [tag.id, tag.label]));
  return [
    ...(filters.endDate ? [{ id: 'end', label: endDateLabel(filters.endDate), onRemove: () => onChange({ ...filters, endDate: '' }) }] : []),
    ...(filters.protocol
      ? [{ id: 'protocol', label: PROTOCOLS.find((p) => p.value === filters.protocol)?.label ?? filters.protocol, onRemove: () => onChange({ ...filters, protocol: '' }) }]
      : []),
    ...filters.tags.map((id) => ({
      id: `tag:${id}`,
      label: tagLabels.get(id) ?? `Tag ${id}`,
      onRemove: () => onChange({ ...filters, tags: filters.tags.filter((other) => other !== id) }),
    })),
    ...filters.indexers.map((id) => ({
      id: `indexer:${id}`,
      label: indexerNames.get(id) ?? `Indexer ${id}`,
      onRemove: () => onChange({ ...filters, indexers: filters.indexers.filter((other) => other !== id) }),
    })),
  ];
}
