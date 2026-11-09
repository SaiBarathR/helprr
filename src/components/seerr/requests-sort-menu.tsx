'use client';

import { useMemo } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuSortDirection,
} from '@/components/ui/responsive-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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

  const toggleDirection = () => {
    onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc');
  };

  const DirectionIcon = sortDirection === 'asc' ? ArrowUp : ArrowDown;

  return (
    // 12px apart, so each 32px button keeps its whole 44px tap area.
    <div className="flex items-center gap-3">
      <ResponsiveMenu
        title="Sort by"
        titleInDropdown
        closeOnPick
        contentClassName="w-48"
        trigger={(
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="touch-target-center h-8 w-8"
            onClick={toggleDirection}
            aria-label={`Sort direction: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
          >
            <DirectionIcon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
