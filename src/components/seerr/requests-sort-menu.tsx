'use client';

import { useMemo } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuSortDirection,
} from '@/components/ui/responsive-menu';
import {
  type RequestsSortDirectionPreference,
  type RequestsSortPreference,
} from '@/lib/store';

const SORT_OPTIONS: { value: RequestsSortPreference; label: string }[] = [
  { value: 'added', label: 'Most Recent' },
  { value: 'modified', label: 'Last Modified' },
];

export interface RequestsSortMenuProps {
  sort: RequestsSortPreference;
  onSortChange: (sort: RequestsSortPreference) => void;
  sortDirection: RequestsSortDirectionPreference;
  onSortDirectionChange: (dir: RequestsSortDirectionPreference) => void;
}

export function RequestsSortMenu({
  sort,
  onSortChange,
  sortDirection,
  onSortDirectionChange,
}: RequestsSortMenuProps) {
  const activeSortLabel = useMemo(
    () => SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Most Recent',
    [sort],
  );

  return (
    <ResponsiveMenu
      title="Sort by"
      titleInDropdown
      closeOnPick
      contentClassName="w-48"
      trigger={(
        <Button
          variant="ghost"
          size="icon"
          // Right after the filter button: keep its tap area centred (globals.css).
          className="touch-target-center h-8 w-8"
          aria-label={`Sort: ${activeSortLabel} ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
        >
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      )}
    >
      <ResponsiveMenuSortDirection value={sortDirection} onChange={onSortDirectionChange} />
      {SORT_OPTIONS.map((opt) => (
        <ResponsiveMenuCheckboxItem
          key={opt.value}
          checked={sort === opt.value}
          onCheckedChange={() => onSortChange(opt.value)}
        >
          {opt.label}
        </ResponsiveMenuCheckboxItem>
      ))}
    </ResponsiveMenu>
  );
}
